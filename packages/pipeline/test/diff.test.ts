import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { decide, readCalls } from '@ledger/gemini';
import { loadPlanFixture, type DiffItem, type Finding, type Frame, type IssueType } from '@ledger/shared';
import {
  QUADRANT_BOX,
  decisionsChangeAsker,
  decisionsQuadrantAsker,
  decisionsSameRegionAsker,
  diffWalkthroughs,
  independentPairs,
  type ChangeAnswer,
  type DiffDeps,
  type PairContext,
  type Quadrant,
  type SurfaceCoverage,
  type WalkthroughEvidence,
} from '../src/diff.js';
import { isCharged } from '../src/statement.js';

const plan = loadPlanFixture('demo-table');
const S = 'living-room.wall-n'; // 3 m × 2.5 m − window 1.2 × 1.2 = 6.06 m²
const PH = ['0000000000000000', 'ffffffffffffffff', '00000000ffffffff', 'ffffffff00000000'];

const frame = (wid: string, i: number, phash = PH[i % PH.length]!, path = '/nonexistent.jpg'): Frame => ({
  id: `${wid}.f${String(i).padStart(5, '0')}`,
  walkthroughId: wid,
  tMs: i * 500,
  path,
  sharpness: 100 - i,
  phash,
});

const finding = (wid: string, type: IssueType, severity: Finding['severity'], frameIds: string[], surfaceId = S): Finding => ({
  id: `${wid}.${surfaceId}.${type}`,
  walkthroughId: wid,
  surfaceId,
  type,
  confidence: 0.9,
  severity,
  frameIds,
  decidedBy: 'decisions-api',
});

/** Every plan surface covered (3 frames); S's coverage lists this walkthrough's frames. */
function evidence(wid: string, frames: Frame[], findings: Finding[], over: Record<string, Partial<SurfaceCoverage>> = {}): WalkthroughEvidence {
  const coverage: Record<string, SurfaceCoverage> = {};
  for (const s of plan.surfaces) {
    coverage[s.id] = { frames: 3, frameIds: s.id === S ? frames.map((f) => f.id) : [], notVisible: false, ...over[s.id] };
  }
  return { walkthroughId: wid, findings, frames, coverage };
}

const B = [1, 2, 3].map((i) => frame('base', i));
const A = [1, 2, 3].map((i) => frame('out', i));
const ids = (fs: Frame[]) => fs.map((f) => f.id);
const idx = (f: Frame) => Number(f.id.slice(-5));

interface Fakes {
  same?: (b: number, a: number) => number;
  quad?: (b: number, a: number) => Record<Quadrant, number>;
  change?: (b: number, a: number) => Partial<ChangeAnswer>;
  reason?: string;
}

function fakes(f: Fakes = {}) {
  const calls = { same: [] as string[], quad: [] as string[], change: [] as { pair: string; quadrant?: Quadrant }[], reason: 0 };
  const key = (c: PairContext) => `${idx(c.before)}-${idx(c.after)}`;
  const deps: DiffDeps = {
    askSameRegion: async (c) => {
      calls.same.push(key(c));
      return f.same ? f.same(idx(c.before), idx(c.after)) : 0.9;
    },
    askQuadrants: async (c) => {
      calls.quad.push(key(c));
      return f.quad ? f.quad(idx(c.before), idx(c.after)) : { tl: 0.1, tr: 0.1, bl: 0.1, br: 0.1 };
    },
    askChange: async (c) => {
      calls.change.push({ pair: key(c), quadrant: c.quadrant });
      return { newDamage: 0.9, worse: 0.1, movedOnly: 0.05, ...f.change?.(idx(c.before), idx(c.after)) };
    },
    writeReason: async ({ fallback }) => {
      calls.reason++;
      return f.reason ?? fallback;
    },
  };
  return { deps, calls };
}

const itemFor = (items: DiffItem[], type: IssueType): DiffItem => items.find((i) => i.surfaceId === S && i.issueType === type)!;

describe('two-pair proof rule', () => {
  it('1 supporting pair → not provable, verdict not-visible, $0', async () => {
    const { deps, calls } = fakes({ same: (b, a) => (b === 1 && a === 1 ? 0.9 : 0.1) });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'stain') as (typeof r.items)[number];
    expect(item.verdict).toBe('not-visible');
    expect(item.reason).toMatch(/^Not provable:/);
    expect(item.reason).toContain('only 1 of the 2');
    expect(item.costUsd).toBe(0);
    expect(isCharged(item)).toBe(false);
    expect(r.evidence[0]!.supportingPairs).toBe(1);
    expect(calls.change.map((c) => c.pair)).toEqual(['1-1']);
    expect(calls.reason).toBe(0);
  });

  it('2 independent pairs → new-damage, priced in code, both pairs kept', async () => {
    const { deps, calls } = fakes({ reason: 'The new stain on the north wall costs $72.72 to repaint.' });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'stain') as (typeof r.items)[number];
    expect(item.verdict).toBe('new-damage');
    expect(item.costUsd).toBe(72.72); // 6.06 m² × $12/m²
    expect(item.areaM2).toBe(6.06);
    expect(item.reason).toBe('The new stain on the north wall costs $72.72 to repaint.');
    const ev = r.evidence[0]!;
    expect(ev.reasonSource).toBe('carbon');
    expect(ev.proof!.map((p) => `${p.beforeFrameId}|${p.afterFrameId}`)).toEqual([
      'base.f00001|out.f00001',
      'base.f00002|out.f00002',
    ]);
    expect(item.beforeFrameId).toBe('base.f00001');
    expect(item.afterFrameId).toBe('out.f00001');
    // Diagonal first: proof after exactly 2 pairs, then stop.
    expect(calls.same).toEqual(['1-1', '2-2']);
    expect(calls.change).toHaveLength(2);
  });

  it('pairs sharing one BEFORE frame count once → not provable', async () => {
    const { deps } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', [B[0]!], []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'stain') as (typeof r.items)[number];
    expect(item.reason).toMatch(/^Not provable:/);
    expect(r.evidence[0]!.pairs.filter((p) => p.role === 'supports')).toHaveLength(3);
    expect(r.evidence[0]!.supportingPairs).toBe(1);
  });

  it('near-identical frames (same dHash, different IDs) count as one frame', async () => {
    const { deps } = fakes();
    const twins = [frame('base', 1, PH[0]), frame('base', 2, PH[0]), frame('base', 3, '0000000000000001')];
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', twins, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    expect(r.evidence[0]!.beforeFrameIds).toEqual(['base.f00001']);
    expect((itemFor(r.items, 'stain') as { reason: string }).reason).toMatch(/^Not provable:/);
  });

  it('independentPairs needs distinct BEFORE and distinct AFTER frames', () => {
    const frames = new Map([...B, ...A].map((f) => [f.id, f]));
    const p = (b: number, a: number) => ({ beforeFrameId: `base.f0000${b}`, afterFrameId: `out.f0000${a}` });
    expect(independentPairs([p(1, 1), p(1, 2)], frames)).toBeUndefined();
    expect(independentPairs([p(1, 1), p(2, 1)], frames)).toBeUndefined();
    expect(independentPairs([p(1, 1), p(2, 2)], frames)).toHaveLength(2);
  });
});

describe('verdicts', () => {
  it('moved chair → moved, $0', async () => {
    const { deps } = fakes({ change: () => ({ newDamage: 0.2, movedOnly: 0.92 }) });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'other', 3, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'other') as (typeof r.items)[number];
    expect(item.verdict).toBe('moved');
    expect(item.costUsd).toBe(0);
    expect(item.reason).toContain('never charged');
  });

  it('missing baseline → not-visible, $0, no model calls', async () => {
    const { deps, calls } = fakes();
    const r = await diffWalkthroughs({ plan, moveOut: evidence('out', A, [finding('out', 'hole', 4, ids(A))]), deps });
    const item = itemFor(r.items, 'hole') as (typeof r.items)[number];
    expect(item.verdict).toBe('not-visible');
    expect(item.reason).toMatch(/^Not visible at move-in/);
    expect(item.costUsd).toBe(0);
    expect(calls.same).toHaveLength(0);
  });

  it('failed baseline (no coverage) → not-visible, $0', async () => {
    const { deps, calls } = fakes();
    const failed: WalkthroughEvidence = { ...evidence('base', B, []), coverage: undefined };
    const r = await diffWalkthroughs({ plan, baseline: failed, moveOut: evidence('out', A, [finding('out', 'hole', 4, ids(A))]), deps });
    expect((itemFor(r.items, 'hole') as { verdict: string }).verdict).toBe('not-visible');
    expect(calls.same).toHaveLength(0);
  });

  it('surface not covered at move-in → not-visible, $0', async () => {
    const { deps, calls } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [], { [S]: { frames: 1, notVisible: true } }),
      moveOut: evidence('out', A, [finding('out', 'hole', 4, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'hole') as (typeof r.items)[number];
    expect(item.verdict).toBe('not-visible');
    expect(item.reason).toContain('1 move-in keyframe');
    expect(calls.same).toHaveLength(0);
  });

  it('same-region fail skips the pair (no change questions for it)', async () => {
    const { deps, calls } = fakes({ same: (b, a) => (b === 1 && a === 1 ? 0.1 : 0.9) });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const ev = r.evidence[0]!;
    expect(ev.pairs[0]).toMatchObject({ beforeFrameId: 'base.f00001', afterFrameId: 'out.f00001', status: 'skipped' });
    expect(calls.change.map((c) => c.pair)).not.toContain('1-1');
    expect(ev.verdict).toBe('new-damage'); // proven by 2-2 and 3-3
  });

  it('unsure (0.3–0.7) → 2×2 quadrants; the matching quadrant gives the box and the pair counts once', async () => {
    const { deps, calls } = fakes({
      same: (b, a) => (b === 1 && a === 1 ? 0.5 : 0.1),
      quad: () => ({ tl: 0.2, tr: 0.88, bl: 0.3, br: 0.1 }),
    });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const ev = r.evidence[0]!;
    expect(calls.quad).toEqual(['1-1']);
    expect(calls.change).toEqual([{ pair: '1-1', quadrant: 'tr' }]);
    expect(ev.pairs[0]!.bbox).toEqual(QUADRANT_BOX.tr);
    expect(ev.bbox).toEqual(QUADRANT_BOX.tr);
    expect(ev.supportingPairs).toBe(1);
    expect((itemFor(r.items, 'stain') as { reason: string }).reason).toMatch(/^Not provable:/);
  });

  it('unsure with no matching quadrant → pair skipped', async () => {
    const { deps, calls } = fakes({ same: () => 0.5 });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    expect(calls.quad).toHaveLength(9);
    expect(calls.change).toHaveLength(0);
    expect(r.evidence[0]!.pairs.every((p) => p.status === 'skipped')).toBe(true);
  });

  it('same issue type, severity +1 → pre-existing without model calls', async () => {
    const { deps, calls } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [finding('base', 'stain', 2, ids(B))]),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    expect((itemFor(r.items, 'stain') as { verdict: string }).verdict).toBe('pre-existing');
    expect(calls.same).toHaveLength(0);
  });

  it('same issue type, severity +2 → judged on "worse", still needs 2 pairs', async () => {
    const worse = fakes({ change: () => ({ newDamage: 0.1, worse: 0.9 }) });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [finding('base', 'stain', 1, ids(B))]),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps: worse.deps,
    });
    expect(r.evidence[0]!.signal).toBe('worse');
    expect((itemFor(r.items, 'stain') as { verdict: string }).verdict).toBe('new-damage');

    const one = fakes({ same: (b, a) => (b === a && b === 1 ? 0.9 : 0.1), change: () => ({ worse: 0.9 }) });
    const r2 = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [finding('base', 'stain', 1, ids(B))]),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps: one.deps,
    });
    expect((itemFor(r2.items, 'stain') as { reason: string }).reason).toMatch(/^Not provable:/);
  });

  it('severity is per issue type: a move-in scuff does not cover a move-out stain', async () => {
    const { deps } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [finding('base', 'scuff', 4, ids(B))]),
      moveOut: evidence('out', A, [finding('out', 'stain', 2, ids(A))]),
      deps,
    });
    expect(r.evidence[0]!.signal).toBe('newDamage');
    expect((itemFor(r.items, 'stain') as { verdict: string }).verdict).toBe('new-damage');
  });

  it('proven small scuff → wear, $0', async () => {
    const { deps } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'scuff', 2, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'scuff') as (typeof r.items)[number];
    expect(item.verdict).toBe('wear');
    expect(item.costUsd).toBe(0);
  });

  it('a model-written reason with a different dollar figure is replaced by the template', async () => {
    const { deps } = fakes({ reason: 'Charged $99.00 for the stain.' });
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, []),
      moveOut: evidence('out', A, [finding('out', 'stain', 3, ids(A))]),
      deps,
    });
    const item = itemFor(r.items, 'stain') as (typeof r.items)[number];
    expect(item.costUsd).toBe(72.72);
    expect(item.reason).toMatch(/^New stain on the Living room north wall: 2 independent/);
    expect(item.reason).toContain('= $72.72');
    expect(r.evidence[0]!.reasonSource).toBe('template');
  });

  it('every plan surface gets a verdict: hidden → not-visible, seen → no-change', async () => {
    const { deps } = fakes();
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', B, [], { 'bedroom.wall-e': { frames: 0, notVisible: true } }),
      moveOut: evidence('out', A, []),
      deps,
    });
    expect(r.items).toHaveLength(plan.surfaces.length);
    expect(r.items.find((i) => i.surfaceId === 'bedroom.wall-e')!.verdict).toBe('not-visible');
    expect(r.items.find((i) => i.surfaceId === S)!.verdict).toBe('no-change');
    expect(r.items.every((i) => i.costUsd === 0)).toBe(true);
  });

  it('Hydrogen object on a different surface → moved, $0', async () => {
    const { deps } = fakes();
    const base = evidence('base', B, []);
    const out = evidence('out', A, []);
    base.localizations = B.map((f) => ({ frameId: f.id, roomId: 'living-room', surfaceId: 'living-room.wall-s', confidence: 0.9, visible: {} }));
    out.localizations = A.map((f) => ({ frameId: f.id, roomId: 'living-room', surfaceId: S, confidence: 0.9, visible: {} }));
    base.captions = B.map((f) => ({ frameId: f.id, landmarks: [], objects: ['chair'] }));
    out.captions = A.map((f) => ({ frameId: f.id, landmarks: [], objects: ['chair'] }));
    const r = await diffWalkthroughs({ plan, baseline: base, moveOut: out, deps });
    const moved = r.items.find((i) => i.verdict === 'moved')!;
    expect(moved.surfaceId).toBe(S);
    expect(moved.reason).toContain('chair');
    expect(moved.costUsd).toBe(0);
  });
});

describe('default Decisions askers (GEMINI_MODE=mock)', () => {
  let root: string;
  let jpgs: string[];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ledger-diff-'));
    jpgs = [];
    for (const [i, color] of ['#806040', '#406080', '#608040', '#804060'].entries()) {
      const p = join(root, `f${i}.jpg`);
      await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).jpeg().toFile(p);
      jpgs.push(p);
    }
  });

  function mockEnv(rules: Record<string, { match: string; noul: number }[]>): NodeJS.ProcessEnv {
    const dir = mkdtempSync(join(root, 'env-'));
    mkdirSync(join(dir, 'fixtures', 'decide'), { recursive: true });
    for (const [tag, r] of Object.entries(rules)) writeFileSync(join(dir, 'fixtures', 'decide', `${tag}.json`), JSON.stringify({ rules: r }));
    return { GEMINI_MODE: 'mock', DATA_DIR: join(dir, 'data'), GEMINI_FIXTURES_DIR: join(dir, 'fixtures'), GEMINI_CACHE: '0' };
  }

  it('BEFORE/AFTER as two labeled image blocks; 3 change questions in one request; logged; Carbon text rejected → template', async () => {
    const env = mockEnv({
      'diff.same-region': [{ match: 'same region', noul: 0.9 }],
      'diff.change': [
        { match: 'not present at that spot', noul: 0.9 },
        { match: 'clearly worse', noul: 0.1 },
        { match: 'only difference', noul: 0.05 },
      ],
    });
    const seen: Parameters<typeof decide>[0][] = [];
    const spy: typeof decide = (args) => {
      seen.push(args);
      return decide(args);
    };
    const b = [0, 1].map((i) => frame('base', i + 1, PH[i], jpgs[i]));
    const a = [0, 1].map((i) => frame('out', i + 1, PH[i + 2], jpgs[i + 2]));
    const r = await diffWalkthroughs({
      plan,
      baseline: evidence('base', b, []),
      moveOut: evidence('out', a, [finding('out', 'stain', 3, ids(a))]),
      deps: {
        askSameRegion: decisionsSameRegionAsker({ env, decideFn: spy }),
        askQuadrants: decisionsQuadrantAsker({ env, decideFn: spy }),
        askChange: decisionsChangeAsker({ env, decideFn: spy }),
      },
      env,
    });
    const same = seen.find((s) => s.tag === 'diff.same-region')!;
    const input = same.input as { type: string; text?: string }[];
    expect(input.map((c) => c.type)).toEqual(['text', 'image', 'text', 'image']);
    expect(input[0]!.text).toMatch(/^BEFORE/);
    expect(input[2]!.text).toMatch(/^AFTER/);
    const change = seen.find((s) => s.tag === 'diff.change')!;
    expect(Object.keys(change.questions)).toEqual(['new_damage', 'worse', 'moved_only']);

    const item = itemFor(r.items, 'stain') as (typeof r.items)[number];
    expect(item.verdict).toBe('new-damage');
    expect(item.costUsd).toBe(72.72);
    expect(r.evidence[0]!.reasonSource).toBe('template'); // mock Carbon text has no "$72.72"

    const rows = readCalls(env).filter((c) => c.tag.startsWith('diff.'));
    expect(rows.filter((c) => c.tag === 'diff.same-region').map((c) => c.questions)).toEqual([1, 1]);
    expect(rows.filter((c) => c.tag === 'diff.change').map((c) => c.questions)).toEqual([3, 3]);
    expect(rows.filter((c) => c.tag === 'diff.reason')).toHaveLength(1);
  });

  it('unsure same-region → one quadrant request with 8 labeled crops and 4 questions', async () => {
    const env = mockEnv({
      'diff.same-region': [{ match: 'same region', noul: 0.5 }],
      'diff.quadrants': [
        { match: '"BEFORE top-right"', noul: 0.9 },
        { match: '.', noul: 0.1 },
      ],
    });
    const seen: Parameters<typeof decide>[0][] = [];
    const spy: typeof decide = (args) => {
      seen.push(args);
      return decide(args);
    };
    const ctx: PairContext = {
      plan,
      surface: plan.surfaces.find((s) => s.id === S)!,
      issueType: 'stain',
      before: frame('base', 1, PH[0], jpgs[0]),
      after: frame('out', 1, PH[1], jpgs[1]),
    };
    expect(await decisionsSameRegionAsker({ env, decideFn: spy })(ctx)).toBe(0.5);
    const q = await decisionsQuadrantAsker({ env, decideFn: spy })(ctx);
    expect(q.tr).toBe(0.9);
    expect(q.tl).toBe(0.1);
    const req = seen.find((s) => s.tag === 'diff.quadrants')!;
    const input = req.input as { type: string; text?: string }[];
    expect(input.filter((c) => c.type === 'image')).toHaveLength(8);
    expect(input.filter((c) => c.text?.startsWith('BEFORE ')).map((c) => c.text)).toEqual([
      'BEFORE top-left:',
      'BEFORE top-right:',
      'BEFORE bottom-left:',
      'BEFORE bottom-right:',
    ]);
    expect(Object.keys(req.questions)).toEqual(['tl', 'tr', 'bl', 'br']);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decide, readCalls, type DecisionQuestion } from '@ledger/gemini';
import { FindingSchema, loadPlanFixture, type Frame, type Localization } from '@ledger/shared';
import {
  CHECKLIST_ISSUES,
  CarbonFindingSchema,
  decisionsDamageAsker,
  detectFindings,
  noisyOr,
  selectEvidenceFrames,
  severityFromScore,
  type CarbonFindingAsker,
  type CarbonFindingContext,
  type ChecklistIssue,
  type FindingsCoverage,
  type FrameDamageAnswer,
  type FrameDamageAsker,
} from '../src/findings.js';

const plan = loadPlanFixture('demo-table');
const WALL_N = 'living-room.wall-n';
const WALL_E = 'living-room.wall-e';
const WT = 'wt-test';

// Paths are fixed at load time (frames are built while tests are collected); the JPEGs are written in beforeAll.
const root = mkdtempSync(join(tmpdir(), 'ledger-findings-'));
const grayJpg = join(root, 'gray.jpg');
const darkJpg = join(root, 'dark.jpg');

beforeAll(async () => {
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).jpeg().toFile(grayJpg);
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#202020' } }).jpeg().toFile(darkJpg);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Mock-mode env with its own DATA_DIR and fixtures dir, so tests never touch the repo's .data/. */
function mockEnv(fixtures: { decide?: Record<string, unknown>; generate?: Record<string, unknown> } = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(root, 'env-'));
  const fx = join(dir, 'fixtures');
  for (const kind of ['decide', 'generate'] as const) {
    mkdirSync(join(fx, kind), { recursive: true });
    for (const [tag, body] of Object.entries(fixtures[kind] ?? {})) writeFileSync(join(fx, kind, `${tag}.json`), JSON.stringify(body));
  }
  return { GEMINI_MODE: 'mock', MODEL_DECIDE: 'test-decision', MODEL_DEEP: 'test-carbon', DATA_DIR: join(dir, 'data'), GEMINI_FIXTURES_DIR: fx, GEMINI_CACHE: '0' };
}

const frame = (i: number, sharpness = 100, path = grayJpg): Frame => ({
  id: `${WT}.f${String(i).padStart(5, '0')}`,
  walkthroughId: WT,
  tMs: (i - 1) * 500,
  path,
  sharpness,
  phash: '0123456789abcdef',
});

const loc = (f: Frame, visible: Record<string, number>): Localization => ({
  frameId: f.id,
  roomId: 'living-room',
  surfaceId: Object.keys(visible)[0] ?? 'none',
  confidence: 0.9,
  visible,
});

/** Coverage with the given surfaces covered by the given frames; every other plan surface notVisible. */
function coverage(covered: Record<string, Frame[]>): FindingsCoverage {
  const out: FindingsCoverage = {};
  for (const s of plan.surfaces) {
    const fs = covered[s.id] ?? [];
    out[s.id] = { frames: fs.length, frameIds: fs.map((f) => f.id), notVisible: fs.length < 2 };
  }
  return out;
}

const zeros = () => Object.fromEntries(CHECKLIST_ISSUES.map((i) => [i, 0])) as Record<ChecklistIssue, number>;
function ans(visible: number, issues: Partial<Record<ChecklistIssue, number>> = {}, severity: Partial<Record<ChecklistIssue, number>> = {}): FrameDamageAnswer {
  return { visible, issues: { ...zeros(), ...issues }, severity: { ...zeros(), ...severity } };
}

/** Scripted asker: answers[surfaceId][frameId]. Records every call. */
function scripted(answers: Record<string, Record<string, FrameDamageAnswer>>) {
  const calls: { surfaceId: string; frameId: string }[] = [];
  const askFrame: FrameDamageAsker = async ({ surface, frame }) => {
    calls.push({ surfaceId: surface.id, frameId: frame.id });
    const a = answers[surface.id]?.[frame.id];
    if (!a) throw new Error(`unscripted ${surface.id} ${frame.id}`);
    return a;
  };
  return { askFrame, calls };
}

function carbonSpy(answer: (ctx: CarbonFindingContext) => ReturnType<CarbonFindingAsker> | Awaited<ReturnType<CarbonFindingAsker>>) {
  const calls: CarbonFindingContext[] = [];
  const askCarbon: CarbonFindingAsker = async (ctx) => {
    calls.push(ctx);
    return answer(ctx);
  };
  return { askCarbon, calls };
}

const noCarbon: CarbonFindingAsker = async () => {
  throw new Error('Carbon must not be called');
};

// ---------------------------------------------------------------------------------------------

describe('severityFromScore', () => {
  it('maps the zero-based score to 1-5 with round + 1, clamped', () => {
    expect([0, 0.49, 0.5, 1.2, 2.5, 3.49, 4].map(severityFromScore)).toEqual([1, 1, 2, 2, 4, 4, 5]);
    expect(severityFromScore(-0.3)).toBe(1);
    expect(severityFromScore(4.7)).toBe(5);
  });
  it('throws on non-finite scores instead of inventing a severity', () => {
    expect(() => severityFromScore(Number.NaN)).toThrow(RangeError);
    expect(() => severityFromScore(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('noisyOr', () => {
  it('is 1 − Π(1 − p_i)', () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([0.5])).toBeCloseTo(0.5);
    expect(noisyOr([0.5, 0.5])).toBeCloseTo(0.75);
    expect(noisyOr([0.35, 0.35, 0.35])).toBeCloseTo(1 - 0.65 ** 3);
    expect(noisyOr([0.2, 0.2, 0.1])).toBeCloseTo(1 - 0.8 * 0.8 * 0.9);
    expect(noisyOr([1, 0.1])).toBe(1);
  });
});

describe('bbox schema', () => {
  const ok = { present: true, type: 'hole', severity: 3, note: 'small hole left of the window' };
  it('accepts normalized [ymin, xmin, ymax, xmax]', () => {
    expect(CarbonFindingSchema.safeParse({ ...ok, bbox: [0.1, 0.2, 0.4, 0.5] }).success).toBe(true);
    expect(CarbonFindingSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects inverted, out-of-range, non-finite and wrong-length boxes', () => {
    for (const bbox of [[0.5, 0.2, 0.4, 0.5], [0.1, 0.6, 0.4, 0.5], [0.1, 0.2, 1.4, 0.5], [-0.1, 0.2, 0.4, 0.5], [0.1, 0.2, 0.4], [0.1, 0.2, Number.NaN, 0.5]]) {
      expect(CarbonFindingSchema.safeParse({ ...ok, bbox }).success).toBe(false);
      expect(
        FindingSchema.safeParse({ id: 'x', walkthroughId: WT, surfaceId: WALL_N, type: 'hole', confidence: 0.5, severity: 3, frameIds: ['a'], bbox, decidedBy: 'carbon' }).success,
      ).toBe(false);
    }
  });
});

describe('selectEvidenceFrames', () => {
  it('takes the top 3 by P(visible) × relative sharpness', () => {
    const fs = [frame(1, 100), frame(2, 50), frame(3, 100), frame(4, 90), frame(5, 100)];
    const locs = [loc(fs[0]!, { [WALL_N]: 0.75 }), loc(fs[1]!, { [WALL_N]: 0.99 }), loc(fs[2]!, { [WALL_N]: 0.95 }), loc(fs[3]!, { [WALL_N]: 0.95 }), loc(fs[4]!, { [WALL_N]: 0.9 })];
    // scores: f1 0.75, f2 0.495, f3 0.95, f4 0.855, f5 0.9
    expect(selectEvidenceFrames(WALL_N, fs, locs, 3).map((f) => f.id)).toEqual([fs[2]!.id, fs[4]!.id, fs[3]!.id]);
  });
});

describe('detectFindings with injected askers', () => {
  const f = [frame(1, 100), frame(2, 90), frame(3, 80), frame(4, 10)];
  const locs = f.map((x) => loc(x, { [WALL_N]: 0.9, [WALL_E]: 0.9 }));

  it('skips notVisible surfaces: zero calls for them, they are listed in notVisible', async () => {
    const { askFrame, calls } = scripted({ [WALL_N]: Object.fromEntries(f.map((x) => [x.id, ans(0.9)])) });
    const res = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f }) }, { deps: { askFrame, askCarbon: noCarbon } });
    expect(new Set(calls.map((c) => c.surfaceId))).toEqual(new Set([WALL_N]));
    // the blurriest frame (f4) is not selected
    expect(calls.map((c) => c.frameId).sort()).toEqual([f[0]!.id, f[1]!.id, f[2]!.id]);
    expect(res.notVisible).toEqual(plan.surfaces.map((s) => s.id).filter((id) => id !== WALL_N));
    expect(res.surfaces[WALL_E]!.status).toBe('not-visible');
    expect(res.findings).toEqual([]);
  });

  it('a surface with fewer than 2 frames passing the gate is notVisible, and gated frames never count', async () => {
    const { askFrame } = scripted({
      [WALL_N]: { [f[0]!.id]: ans(0.9, { crack: 0.99 }), [f[1]!.id]: ans(0.2, { crack: 0.99 }), [f[2]!.id]: ans(0.1, { crack: 0.99 }) },
    });
    const res = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f.slice(0, 3) }) }, { deps: { askFrame, askCarbon: noCarbon } });
    expect(res.findings).toEqual([]);
    expect(res.notVisible).toContain(WALL_N);
    expect(res.surfaces[WALL_N]!.reason).toMatch(/gate passed on 1 of 3/);
  });

  it('applies the thresholds to the noisy-OR: ≥0.7 finding, ≤0.3 none, between -> Carbon', async () => {
    const { askFrame } = scripted({
      [WALL_N]: {
        // crack: 3 × 0.35 -> 0.725 (finding from combined weak evidence); stain 3 × 0.1 -> 0.271 (none);
        // scuff 0.2, 0.2, 0.1 -> 0.424 (Carbon); hole 0.9 on one frame -> 0.9 (finding)
        [f[0]!.id]: ans(0.9, { crack: 0.35, stain: 0.1, scuff: 0.2, hole: 0.9 }, { crack: 1, hole: 3.6 }),
        [f[1]!.id]: ans(0.8, { crack: 0.35, stain: 0.1, scuff: 0.2, hole: 0.05 }, { crack: 1, hole: 0 }),
        [f[2]!.id]: ans(0.7, { crack: 0.35, stain: 0.1, scuff: 0.1, hole: 0.05 }, { crack: 1, hole: 0 }),
      },
    });
    const { askCarbon, calls } = carbonSpy(({ issueType }) => ({ present: false, type: issueType, severity: 1, note: 'no scuff' }));
    const res = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f.slice(0, 3) }) }, { deps: { askFrame, askCarbon } });

    const t = res.surfaces[WALL_N]!;
    expect(t.issues.crack).toMatchObject({ outcome: 'finding' });
    expect(t.issues.crack!.p).toBeCloseTo(0.725375);
    expect(t.issues.stain!.outcome).toBe('none');
    expect(t.issues.scuff!.outcome).toBe('carbon-absent');
    expect(t.issues['missing-fixture']!.outcome).toBe('none');
    expect(calls.map((c) => c.issueType)).toEqual(['scuff']);

    expect(res.findings.map((x) => [x.type, x.decidedBy])).toEqual([
      ['crack', 'decisions-api'],
      ['hole', 'decisions-api'],
    ]);
    const crack = res.findings[0]!;
    expect(crack.id).toBe(`${WT}.${WALL_N}.crack`);
    expect(crack.confidence).toBeCloseTo(0.725375);
    // no single frame reaches SUPPORT_MIN, so every accepted frame supports it, strongest first
    expect(crack.frameIds).toHaveLength(3);
    // hole: only the frame that saw it supports it; severity from the hole's own score (p-weighted ≈ 3.27 -> 4)
    const hole = res.findings[1]!;
    expect(hole.frameIds).toEqual([f[0]!.id]);
    expect(hole.severity).toBe(4);
    expect(crack.severity).toBe(2);
    for (const x of res.findings) expect(FindingSchema.parse(x)).toEqual(x);
  });

  it('gives each issue its own severity on the same surface', async () => {
    const both = ans(0.9, { scuff: 0.9, hole: 0.9 }, { scuff: 0.1, hole: 3.8 });
    const { askFrame } = scripted({ [WALL_N]: { [f[0]!.id]: both, [f[1]!.id]: both } });
    const res = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f.slice(0, 2) }) }, { deps: { askFrame, askCarbon: noCarbon } });
    expect(Object.fromEntries(res.findings.map((x) => [x.type, x.severity]))).toEqual({ hole: 5, scuff: 1 });
  });

  it('caps Carbon calls per walkthrough, asks the most uncertain first, and the rest abstain', async () => {
    // Uncertain P per (surface, issue), two frames each: p_i chosen so noisy-OR = 1 − (1 − p)^2.
    const two = (p: number) => 1 - Math.sqrt(1 - p);
    const n = ans(0.9, { crack: two(0.5), stain: two(0.65) });
    const e = ans(0.9, { hole: two(0.45), scuff: two(0.35) });
    const { askFrame } = scripted({
      [WALL_N]: { [f[0]!.id]: n, [f[1]!.id]: n },
      [WALL_E]: { [f[0]!.id]: e, [f[1]!.id]: e },
    });
    const { askCarbon, calls } = carbonSpy(({ issueType, frames }) =>
      issueType === 'crack'
        ? { present: true, type: 'crack', severity: 3, bbox: [0.1, 0.2, 0.4, 0.5], note: 'hairline crack under the window' }
        : { present: false, type: issueType, severity: 1, note: `no ${issueType} on ${frames.length} frames` },
    );
    const cov = coverage({ [WALL_N]: f.slice(0, 2), [WALL_E]: f.slice(0, 2) });
    const res = await detectFindings(plan, f, { localizations: locs, coverage: cov }, { config: { MAX_CARBON_CALLS: 2 }, deps: { askFrame, askCarbon } });

    expect(calls.map((c) => `${c.surface.id}:${c.issueType}`)).toEqual([`${WALL_N}:crack`, `${WALL_E}:hole`]);
    expect(calls[0]!.frames).toHaveLength(2);
    expect(res.surfaces[WALL_N]!.issues.stain!.outcome).toBe('carbon-cap');
    expect(res.surfaces[WALL_E]!.issues.scuff!.outcome).toBe('carbon-cap');
    expect(res.surfaces[WALL_E]!.issues.hole!.outcome).toBe('carbon-absent');

    expect(res.findings).toHaveLength(1);
    const c = res.findings[0]!;
    expect(c).toMatchObject({ surfaceId: WALL_N, type: 'crack', decidedBy: 'carbon', severity: 3, bbox: [0.1, 0.2, 0.4, 0.5], note: 'hairline crack under the window' });
    expect(c.confidence).toBeCloseTo(0.5);
    expect(c.frameIds).toEqual(calls[0]!.frames.map((x) => x.id));
  });

  it('never calls Carbon when every P is outside the uncertain band, and a Carbon error abstains', async () => {
    const { askFrame } = scripted({ [WALL_N]: { [f[0]!.id]: ans(0.9, { crack: 0.2 }), [f[1]!.id]: ans(0.9, { crack: 0.05 }) } });
    const res = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f.slice(0, 2) }) }, { deps: { askFrame, askCarbon: noCarbon } });
    expect(res.carbon).toEqual([]);
    expect(res.findings).toEqual([]);

    const { askFrame: uncertain } = scripted({ [WALL_N]: { [f[0]!.id]: ans(0.9, { stain: 0.3 }), [f[1]!.id]: ans(0.9, { stain: 0.3 }) } });
    const err = await detectFindings(plan, f, { localizations: locs, coverage: coverage({ [WALL_N]: f.slice(0, 2) }) }, { deps: { askFrame: uncertain, askCarbon: noCarbon } });
    expect(err.findings).toEqual([]);
    expect(err.surfaces[WALL_N]!.issues.stain!.outcome).toBe('carbon-error');
    expect(err.carbon[0]!.error).toMatch(/must not be called/);
  });
});

describe('detectFindings through @ledger/gemini (GEMINI_MODE=mock)', () => {
  const good = [frame(1, 100), frame(2, 90)];
  const blocked = frame(3, 95, darkJpg);
  const all = [...good, blocked];
  const locs = all.map((x) => loc(x, { [WALL_N]: 0.95 }));
  const cov = coverage({ [WALL_N]: all });

  const frameRules = (gate: number, crack: number) => ({
    rules: [
      { match: 'not blocked by', noul: gate },
      { match: 'shows a crack.*how severe', level: 3 },
      { match: 'shows a stain.*how severe', level: 0 },
      { match: 'how severe', level: 0 },
      { match: 'Does it show a crack', noul: crack },
      { match: 'Does it show a stain', noul: 0.9 },
      { match: 'Does it show', noul: 0.02 },
    ],
  });

  /** decide() that sends the dark (blocked) frame to the `findings.frame.blocked` fixture and records questions. */
  function routedDecide(seen: Record<string, DecisionQuestion>[]): typeof decide {
    const dark = readFileSync(darkJpg).toString('base64');
    return (async (args) => {
      seen.push(args.questions);
      const input = Array.isArray(args.input) ? args.input : [args.input];
      const isDark = input.some((c) => typeof c === 'object' && c.type === 'image' && c.data === dark);
      return decide({ ...args, tag: isDark ? 'findings.frame.blocked' : args.tag });
    }) as typeof decide;
  }

  it('one request per frame with gate + 5 damage + 5 severity questions, each naming room and surface', async () => {
    const env = mockEnv({ decide: { 'findings.frame': frameRules(0.1, 0.95) } });
    const seen: Record<string, DecisionQuestion>[] = [];
    const res = await detectFindings(plan, all, { localizations: locs, coverage: cov }, {
      env,
      deps: { askFrame: decisionsDamageAsker({ env, decideFn: routedDecide(seen) }), askCarbon: noCarbon },
    });
    // every gate failed: checklist answers (crack 0.95) are discarded and the surface is not-visible
    expect(res.findings).toEqual([]);
    expect(res.notVisible).toContain(WALL_N);

    const rows = readCalls(env).filter((r) => r.tag.startsWith('findings.frame'));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.questions === 11 && r.model === 'test-decision')).toBe(true);
    expect(seen).toHaveLength(3);
    const qs = Object.values(seen[0]!);
    expect(qs.map((q) => q.type).sort()).toEqual([...Array(6).fill('noul'), ...Array(5).fill('score')].sort());
    for (const q of qs) {
      expect(q.instructions).toContain('Room: Living room.');
      expect(q.instructions).toContain(`surface ID ${WALL_N}`);
    }
    for (const q of qs.filter((x) => x.type === 'score')) expect((q as { criteria: string[] }).criteria).toHaveLength(5);
  });

  it('discards the blocked frame (gate fails) and keeps findings from the other two', async () => {
    const env = mockEnv({ decide: { 'findings.frame': frameRules(0.9, 0.95), 'findings.frame.blocked': frameRules(0.1, 0.99) } });
    const res = await detectFindings(plan, all, { localizations: locs, coverage: cov }, {
      env,
      deps: { askFrame: decisionsDamageAsker({ env, decideFn: routedDecide([]) }), askCarbon: noCarbon },
    });
    expect(res.surfaces[WALL_N]!.accepted.sort()).toEqual(good.map((x) => x.id).sort());
    expect(res.findings.map((x) => x.type)).toEqual(['crack', 'stain']);
    for (const x of res.findings) {
      expect(x.decidedBy).toBe('decisions-api');
      expect(x.frameIds).not.toContain(blocked.id);
      expect(x.frameIds.sort()).toEqual(good.map((g) => g.id).sort());
    }
    // crack forced to level 3 -> severity 4; stain forced to level 0 -> severity 1
    expect(Object.fromEntries(res.findings.map((x) => [x.type, x.severity]))).toEqual({ crack: 4, stain: 1 });
  });

  it('runs Carbon through generate() on MODEL_DEEP, and an invalid bbox abstains instead of emitting a finding', async () => {
    const uncertain = ans(0.9, { hole: 1 - Math.sqrt(0.5) });
    const { askFrame } = scripted({ [WALL_N]: { [good[0]!.id]: uncertain, [good[1]!.id]: uncertain } });
    const two = coverage({ [WALL_N]: good });

    const okEnv = mockEnv({ generate: { 'findings.carbon': { present: true, type: 'hole', severity: 2, bbox: [0.1, 0.2, 0.3, 0.4], note: 'nail hole' } } });
    const ok = await detectFindings(plan, good, { localizations: locs, coverage: two }, { env: okEnv, deps: { askFrame } });
    expect(ok.findings).toHaveLength(1);
    expect(ok.findings[0]).toMatchObject({ type: 'hole', decidedBy: 'carbon', severity: 2, bbox: [0.1, 0.2, 0.3, 0.4], note: 'nail hole' });
    const carbonRows = readCalls(okEnv).filter((r) => r.tag === 'findings.carbon');
    expect(carbonRows).toHaveLength(1);
    expect(carbonRows[0]!.model).toBe('test-carbon');

    const badEnv = mockEnv({ generate: { 'findings.carbon': { present: true, type: 'hole', severity: 2, bbox: [0.5, 0.2, 0.3, 0.4], note: 'inverted box' } } });
    const bad = await detectFindings(plan, good, { localizations: locs, coverage: two }, { env: badEnv, deps: { askFrame } });
    expect(bad.findings).toEqual([]);
    expect(bad.surfaces[WALL_N]!.issues.hole!.outcome).toBe('carbon-error');
  });
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decide, readCalls } from '@ledger/gemini';
import { FIXTURES_DIR, LocalizationSchema, loadPlanFixture, type Frame } from '@ledger/shared';
import {
  NO_SURFACE,
  OTHER_ROOM,
  decisionsSurfaceAsker,
  localizeWalkthrough,
  smoothRooms,
  type CarbonAsker,
  type RoomAsker,
  type SurfaceAnswer,
  type SurfaceAsker,
} from '../src/localize.js';
import { forwardBackward, transitionMatrix, viterbi } from '../src/hmm.js';

const plan = loadPlanFixture('demo-table');
const planSvg = readFileSync(join(FIXTURES_DIR, 'plans', 'demo-table.svg'), 'utf8');
const LR = plan.surfaces.filter((s) => s.roomId === 'living-room').map((s) => s.id);

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GEMINI_MODE: 'mock',
    GEMINI_CACHE: '0',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'ledger-localize-')),
    MODEL_DECIDE: 'gemini-decision-1',
    MODEL_DEEP: 'gemini-4-carbon',
    ...extra,
  };
}

let frameDir: string;
const frames: Frame[] = [];
beforeAll(async () => {
  frameDir = mkdtempSync(join(tmpdir(), 'ledger-frames-'));
  for (let i = 0; i < 14; i++) {
    const path = join(frameDir, `${i}.jpg`);
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: i * 15, g: 80, b: 200 - i * 10 } } })
      .jpeg()
      .toFile(path);
    frames.push({ id: `w1.f${String(i + 1).padStart(5, '0')}`, walkthroughId: 'w1', tMs: i * 500, path, sharpness: 100, phash: '0' });
  }
});
const take = (n: number) => frames.slice(0, n);
const idx = (frameId: string) => frames.findIndex((f) => f.id === frameId);

/** Choice distribution over the living-room surfaces + none: `top` gets p, the rest share 1 - p. */
function dist(top: Record<string, number>): Record<string, number> {
  const keys = [...LR, NO_SURFACE];
  const used = Object.values(top).reduce((a, b) => a + b, 0);
  const rest = keys.filter((k) => !(k in top));
  return Object.fromEntries(keys.map((k) => [k, top[k] ?? (1 - used) / rest.length]));
}

const livingRoom: RoomAsker = async () => ({ 'living-room': 0.9, bedroom: 0.05, [OTHER_ROOM]: 0.05 });
const scriptedSurfaces =
  (choice: (i: number) => Record<string, number>, visible: (i: number) => Record<string, number> = () => ({})): SurfaceAsker =>
  async ({ frame, candidates }): Promise<SurfaceAnswer> => {
    const i = idx(frame.id);
    const v = visible(i);
    return { choice: choice(i), visible: Object.fromEntries(candidates.map((c) => [c.id, v[c.id] ?? 0.2])) };
  };
const neverCarbon: CarbonAsker = async () => {
  throw new Error('Carbon should not be called');
};

describe('smoothRooms', () => {
  it('ignores one- and two-frame blips', () => {
    expect(smoothRooms(['a', 'a', 'a', 'b', 'a', 'a', 'b', 'b', 'a', 'a'])).toEqual(Array(10).fill('a'));
  });
  it('switches at the start of a run of 3', () => {
    expect(smoothRooms(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'])).toEqual(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
  });
  it('absorbs leading noise into the first stable room', () => {
    expect(smoothRooms(['b', 'c', 'a', 'a', 'a'])).toEqual(['a', 'a', 'a', 'a', 'a']);
  });
  it('falls back to the most frequent label when nothing is stable', () => {
    expect(smoothRooms(['a', 'b', 'b', 'a', 'b'])).toEqual(Array(5).fill('b'));
  });
});

describe('hmm', () => {
  it('rows sum to 1 and follow self / neighbor / other mass', () => {
    // chain 0-1-2-3
    const T = transitionMatrix(4, (i, j) => Math.abs(i - j) === 1);
    for (const row of T) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(T[0]![0]).toBeCloseTo(0.8);
    expect(T[0]![1]).toBeCloseTo(0.15);
    expect(T[0]![2]).toBeCloseTo(0.025);
  });
  it('viterbi fixes a single-frame flip to a non-neighbor state', () => {
    const T = transitionMatrix(3, (i, j) => Math.abs(i - j) === 1);
    const E = Array.from({ length: 9 }, (_, t) => (t === 4 ? [0.1, 0.1, 0.8] : [0.8, 0.1, 0.1]));
    expect(viterbi(E, T)).toEqual(Array(9).fill(0));
    const post = forwardBackward(E, T);
    for (const p of post) expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(post[4]![0]).toBeGreaterThan(0.5);
  });
});

describe('localizeWalkthrough (scripted Decisions answers, demo-table plan)', () => {
  it('room smoothing: a 1-frame bedroom blip is ignored, a 4-frame run switches', async () => {
    const script = ['living-room', 'living-room', 'living-room', 'living-room', 'bedroom', 'living-room', 'living-room', 'bedroom', 'bedroom', 'bedroom', 'bedroom'];
    const res = await localizeWalkthrough(plan, take(11), {
      env: env(),
      deps: {
        askRoom: async ({ frame }) => ({ 'living-room': 0.1, bedroom: 0.1, [OTHER_ROOM]: 0.1, [script[idx(frame.id)]!]: 0.8 }),
        askSurfaces: async ({ candidates }) => ({
          choice: Object.fromEntries([...candidates.map((c, i) => [c.id, i === 0 ? 0.9 : 0.02]), [NO_SURFACE, 0.0]]),
          visible: {},
        }),
        askCarbon: neverCarbon,
      },
    });
    expect(res.localizations.map((l) => l.roomId)).toEqual([...Array(7).fill('living-room'), ...Array(4).fill('bedroom')]);
    expect(res.trace[4]!.rawRoom).toBe('bedroom');
    expect(res.localizations[8]!.surfaceId.startsWith('bedroom.')).toBe(true);
  });

  it('HMM fixes a single-frame flip to the opposite wall', async () => {
    const res = await localizeWalkthrough(plan, take(10), {
      env: env(),
      deps: {
        askRoom: livingRoom,
        askSurfaces: scriptedSurfaces((i) =>
          i === 5 ? dist({ 'living-room.wall-s': 0.8, 'living-room.wall-n': 0.05 }) : dist({ 'living-room.wall-n': 0.85 }),
        ),
        askCarbon: neverCarbon,
      },
    });
    expect(res.trace[5]!.rawSurfaceId).toBe('living-room.wall-s');
    expect(res.localizations.map((l) => l.surfaceId)).toEqual(Array(10).fill('living-room.wall-n'));
    expect(res.localizations[5]!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(res.carbon).toEqual([]);
  });

  it('sends low-posterior frames to Carbon with the frame, top-3 candidates and the plan image', async () => {
    const askCarbon = vi.fn<CarbonAsker>(async ({ candidates }) => ({ surfaceId: candidates[1]!.surfaceId, reason: 'window on the left matches' }));
    const res = await localizeWalkthrough(plan, take(6), {
      env: env(),
      planSvg,
      deps: {
        askRoom: livingRoom,
        askSurfaces: scriptedSurfaces(() => dist({ 'living-room.wall-n': 0.3, 'living-room.wall-e': 0.28, 'living-room.wall-w': 0.27 })),
        askCarbon,
      },
    });
    const unsure = res.trace.filter((t) => t.decidedBy === 'carbon');
    expect(askCarbon).toHaveBeenCalledTimes(6);
    expect(unsure).toHaveLength(6);
    const call = askCarbon.mock.calls[0]![0];
    expect(call.candidates).toHaveLength(3);
    expect(call.frame.path).toMatch(/\.jpg$/);
    expect(call.planPng?.subarray(1, 4).toString()).toBe('PNG');
    expect(call.roomText).toContain('living-room.wall-n');
    for (const c of res.carbon) {
      expect(c.surfaceId).toBe(c.candidates[1]!.surfaceId);
      expect(c.reason).toBe('window on the left matches');
      expect(c.usedPlanImage).toBe(true);
    }
    expect(res.localizations.every((l) => l.surfaceId === res.carbon[0]!.surfaceId)).toBe(true);
  });

  it('caps Carbon calls, lowest posterior first, and falls back to room text without plan.svg', async () => {
    const askCarbon = vi.fn<CarbonAsker>(async ({ candidates }) => ({ surfaceId: candidates[0]!.surfaceId, reason: 'r' }));
    const res = await localizeWalkthrough(plan, take(6), {
      env: env(),
      config: { MAX_CARBON_CALLS: 2 },
      deps: {
        askRoom: livingRoom,
        askSurfaces: scriptedSurfaces(() => dist({ 'living-room.wall-n': 0.3, 'living-room.wall-e': 0.28, 'living-room.wall-w': 0.27 })),
        askCarbon,
      },
    });
    expect(askCarbon).toHaveBeenCalledTimes(2);
    expect(askCarbon.mock.calls[0]![0].planPng).toBeUndefined();
    expect(res.carbon.every((c) => !c.usedPlanImage)).toBe(true);
    const hmmConf = res.trace.filter((t) => t.decidedBy === 'hmm').map((t) => t.confidence);
    const carbonFrames = new Set(res.carbon.map((c) => c.frameId));
    const sentConf = res.trace.filter((t) => carbonFrames.has(t.frameId)).map((t) => t.confidence);
    expect(Math.max(...sentConf)).toBeLessThanOrEqual(Math.min(...hmmConf) + 1e-9);
  });

  it('keeps the HMM answer when Carbon picks something that is not a candidate', async () => {
    const res = await localizeWalkthrough(plan, take(3), {
      env: env(),
      deps: {
        askRoom: livingRoom,
        askSurfaces: scriptedSurfaces(() => dist({ 'living-room.wall-n': 0.3, 'living-room.wall-e': 0.28, 'living-room.wall-w': 0.27 })),
        askCarbon: async () => ({ surfaceId: 'bedroom.wall-n', reason: 'x' }),
      },
    });
    expect(res.carbon.every((c) => c.error?.includes('not a candidate'))).toBe(true);
    expect(res.trace.every((t) => t.decidedBy === 'hmm')).toBe(true);
  });

  it('coverage: < 2 frames with P(visible) > 0.7 -> not-visible', async () => {
    const res = await localizeWalkthrough(plan, take(6), {
      env: env(),
      deps: {
        askRoom: livingRoom,
        askSurfaces: scriptedSurfaces(
          () => dist({ 'living-room.wall-n': 0.9 }),
          (i) => ({ 'living-room.wall-n': 0.95, 'living-room.wall-w': i < 2 ? 0.8 : 0.3, 'living-room.wall-e': i === 0 ? 0.9 : 0.1 }),
        ),
        askCarbon: neverCarbon,
      },
    });
    expect(res.coverage['living-room.wall-n']).toMatchObject({ frames: 6, notVisible: false });
    expect(res.coverage['living-room.wall-w']).toMatchObject({ frames: 2, notVisible: false });
    expect(res.coverage['living-room.wall-e']).toMatchObject({ frames: 1, notVisible: true });
    for (const s of plan.surfaces.filter((x) => x.roomId === 'bedroom')) expect(res.coverage[s.id]).toMatchObject({ frames: 0, notVisible: true });
    expect(res.notVisible).toContain('living-room.wall-e');
    expect(res.notVisible).not.toContain('living-room.wall-n');
    expect(Object.keys(res.coverage)).toHaveLength(plan.surfaces.length);
  });

  it('landmark hints boost a matching candidate', async () => {
    const res = await localizeWalkthrough(plan, take(4), {
      env: env(),
      captions: take(4).map((f) => ({ frameId: f.id, landmarks: ['window'] })),
      deps: {
        askRoom: livingRoom,
        // wall-w (plain) narrowly beats wall-n (window) before the hint
        askSurfaces: scriptedSurfaces(() => dist({ 'living-room.wall-w': 0.42, 'living-room.wall-n': 0.4 })),
        askCarbon: async ({ candidates }) => ({ surfaceId: candidates[0]!.surfaceId, reason: 'r' }),
      },
    });
    expect(res.localizations.every((l) => l.surfaceId === 'living-room.wall-n')).toBe(true);
  });
});

describe('default Decisions askers through @ledger/gemini mock', () => {
  it('one room request + one surface request per frame, logged to calls.jsonl', async () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'ledger-fx-'));
    mkdirSync(join(fixtures, 'decide'));
    writeFileSync(join(fixtures, 'decide', 'localize.room.json'), JSON.stringify({ rules: [{ match: 'Which room', choice: 'living-room' }] }));
    const e = env({ GEMINI_FIXTURES_DIR: fixtures });
    const outPath = join(e.DATA_DIR!, 'units', 'demo-table', 'walkthroughs', 'w1', 'localization.json');
    const res = await localizeWalkthrough(plan, take(4), { env: e, outPath });

    for (const l of res.localizations) {
      expect(LocalizationSchema.safeParse(l).success).toBe(true);
      expect(l.roomId).toBe('living-room');
      expect(Object.keys(l.visible).sort()).toEqual([...LR].sort());
      expect([...LR, NO_SURFACE]).toContain(l.surfaceId);
    }
    const rows = readCalls(e);
    const room = rows.filter((r) => r.tag === 'localize.room');
    const surf = rows.filter((r) => r.tag === 'localize.surface');
    expect(room).toHaveLength(4);
    expect(room.every((r) => r.questions === 1)).toBe(true);
    expect(surf).toHaveLength(4);
    expect(surf.every((r) => r.questions === LR.length + 1)).toBe(true);
    expect(rows.filter((r) => r.tag === 'localize.carbon')).toHaveLength(res.carbon.length);
    expect(JSON.parse(readFileSync(outPath, 'utf8')).localizations).toHaveLength(4);
  });

  it('surface request: one choice over the room surfaces + other, one noul per candidate, plan-generated text', async () => {
    const seen: Parameters<typeof decide>[0][] = [];
    const ask = decisionsSurfaceAsker(plan, {
      env: env(),
      decideFn: (async (args: Parameters<typeof decide>[0]) => {
        seen.push(args);
        return decide(args);
      }) as typeof decide,
    });
    const candidates = plan.surfaces.filter((s) => s.roomId === 'bedroom');
    const out = await ask({ frame: frames[0]!, landmarks: ['window'], roomId: 'bedroom', candidates });
    const qs = Object.values(seen[0]!.questions);
    const choice = qs.filter((q) => q.type === 'choice');
    expect(choice).toHaveLength(1);
    expect(qs.filter((q) => q.type === 'noul')).toHaveLength(candidates.length);
    const criteria = choice[0]!.criteria as Record<string, string>;
    expect(Object.keys(criteria).sort()).toEqual([...candidates.map((c) => c.id), 'other'].sort());
    expect(criteria['bedroom.wall-w']).toMatch(/door/);
    expect(criteria['bedroom.wall-e']).toMatch(/window/);
    expect(JSON.stringify(seen[0]!.input)).toContain('window');
    expect(Object.keys(out.visible).sort()).toEqual(candidates.map((c) => c.id).sort());
    expect(Object.keys(out.choice).sort()).toEqual([...candidates.map((c) => c.id), NO_SURFACE].sort());
  });
});

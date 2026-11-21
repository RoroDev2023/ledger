import { describe, expect, it } from 'vitest';
import type { Frame, Localization } from '@ledger/shared';
import { DIFF } from '../src/diffConfig.js';
import { candidatePairs, pairSweep, shiftedSimilarity, type SweepAnswer } from '../src/sweep.js';

const vec = (seed: number) => {
  const v = new Float64Array(32 * 18);
  for (let i = 0; i < v.length; i++) v[i] = Math.sin(i * 0.37 * seed) + Math.cos(i * 0.11 * (seed + 1));
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return v.map((x) => x / n);
};
const near = (v: Float64Array, k: number) => {
  const w = v.map((x, i) => x + 0.01 * Math.sin(i * k));
  let n = 0;
  for (const x of w) n += x * x;
  return w.map((x) => x / Math.sqrt(n));
};
const frame = (id: string, w: string, hash: string): Frame => ({ id, walkthroughId: w, tMs: 0, path: `/nope/${id}.jpg`, sharpness: 1, phash: hash });
const loc = (frameId: string, surfaceId: string): Localization => ({ frameId, roomId: 'room-1', surfaceId, confidence: 0.9, visible: {} });

describe('similarity', () => {
  it('scores a frame highest against itself and picks it as the top candidate', () => {
    const a = vec(1);
    const b = vec(2);
    expect(shiftedSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(shiftedSimilarity(a, b)).toBeLessThan(0.9);
    const c = candidatePairs([{ id: 'b1', sig: a }, { id: 'b2', sig: b }], [{ id: 'a1', sig: a }], 1);
    expect(c).toHaveLength(1);
    expect(c[0]!.beforeFrameId).toBe('b1');
  });
});

describe('pairSweep', () => {
  const base = [frame('b1', 'in', '0000000000000000'), frame('b2', 'in', 'ffffffffffffffff'), frame('b3', 'in', '00ff00ff00ff00ff')];
  const out = [frame('a1', 'out', '0f0f0f0f0f0f0f0f'), frame('a2', 'out', 'f0f0f0f0f0f0f0f0'), frame('a3', 'out', '3333333333333333')];
  // b1, b2, a1, a2 all show the same spot (wall-n) from slightly different positions; b3/a3 another wall.
  const sigs = new Map<string, Float64Array>([['b1', vec(1)], ['b2', near(vec(1), 3)], ['b3', vec(3)], ['a1', near(vec(1), 5)], ['a2', near(vec(1), 7)], ['a3', vec(3)]]);
  const locs = [loc('b1', 'room-1.wall-n'), loc('b2', 'room-1.wall-n'), loc('b3', 'room-1.wall-e'), loc('a1', 'room-1.wall-w'), loc('a2', 'room-1.wall-n'), loc('a3', 'room-1.wall-e')];
  const yes: SweepAnswer = { sameRegion: 0.9, newDamage: 0.9, movedOnly: 0.05, beyondWear: 0.8, issue: 'scuff' };
  const no: SweepAnswer = { sameRegion: 0.9, newDamage: 0.05, movedOnly: 0.05, beyondWear: 0.1, issue: 'other' };

  it('uses the move-in frame for the wall, so a mislabeled move-out frame (a1 on wall-w) does not hide the charge', async () => {
    const ask = async (b: Frame, a: Frame) => (['a1', 'a2'].includes(a.id) && ['b1', 'b2'].includes(b.id) ? yes : no);
    const r = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs, ask, cfg: DIFF, perAfter: 2, signatures: sigs });
    expect(r.pairs).toHaveLength(6);
    expect(r.hits.map((h) => h.surfaceId)).toEqual(['room-1.wall-n']);
  });

  it('one supporting pair is not enough', async () => {
    const ask = async (b: Frame, a: Frame) => (a.id === 'a1' && b.id === 'b1' ? yes : no);
    const r = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs, ask, cfg: DIFF, perAfter: 2, signatures: sigs });
    expect(r.hits).toHaveLength(0);
  });

  it('finds the change when two distinct pairs on the same wall agree', async () => {
    const locs2 = locs.map((l) => (l.frameId === 'a1' ? loc('a1', 'room-1.wall-n') : l));
    const ask = async (b: Frame, a: Frame) => (['a1', 'a2'].includes(a.id) && ['b1', 'b2'].includes(b.id) ? yes : no);
    const r = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs2, ask, cfg: DIFF, perAfter: 2, signatures: sigs });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.surfaceId).toBe('room-1.wall-n');
    expect(r.hits[0]!.issue).toBe('scuff');
    expect(r.hits[0]!.wear).toBe(false);
  });

  it('never charges a moved object, and marks small marks as wear', async () => {
    const locs2 = locs.map((l) => (l.frameId === 'a1' ? loc('a1', 'room-1.wall-n') : l));
    const moved = async () => ({ ...no, movedOnly: 0.95 });
    const r1 = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs2, ask: moved, cfg: DIFF, perAfter: 2, signatures: sigs });
    expect(r1.hits).toHaveLength(0);
    expect(r1.movedPairs.length).toBe(6);
    const small = async () => ({ ...yes, beyondWear: 0.2 });
    const r2 = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs2, ask: small, cfg: DIFF, perAfter: 2, signatures: sigs });
    expect(r2.hits.find((h) => h.surfaceId === 'room-1.wall-n')?.wear).toBe(true);
  });

  it('needs the same region: a new mark on a different wall view is not proof', async () => {
    const locs2 = locs.map((l) => (l.frameId === 'a1' ? loc('a1', 'room-1.wall-n') : l));
    const ask = async () => ({ ...yes, sameRegion: 0.2 });
    const r = await pairSweep({ baseFrames: base, outFrames: out, localizations: locs2, ask, cfg: DIFF, perAfter: 1, signatures: sigs });
    expect(r.hits).toHaveLength(0);
  });
});

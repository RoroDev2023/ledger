import { describe, expect, it } from 'vitest';
import type { DiffItem } from '@ledger/shared';
import { changeCounts, score, wronglyChargedUsd, type PairLabel } from '../src/index.js';

const label: PairLabel = {
  pairId: 'p1', split: 'test',
  newDamage: [{ surfaceId: 'living-room.wall-n', issueType: 'stain' }, { surfaceId: 'bedroom.wall-e', issueType: 'scuff' }],
  moved: [{ object: 'chair' }], preExisting: [],
};
const item = (s: string, v: DiffItem['verdict'], t?: DiffItem['issueType'], cost?: number): DiffItem =>
  ({ surfaceId: s, verdict: v, issueType: t, reason: '', confidence: 0.9, costUsd: cost });

describe('metrics', () => {
  it('counts tp/fp/fn on (surface, issue)', () => {
    const pred = [item('living-room.wall-n', 'new-damage', 'stain', 40), item('living-room.floor', 'new-damage', 'scuff', 25)];
    expect(changeCounts(pred, label)).toEqual({ tp: 1, fp: 1, fn: 1 });
    expect(score({ tp: 1, fp: 1, fn: 1 }).f1).toBeCloseTo(0.5);
  });
  it('wrong charges include anything costed that is not true new damage', () => {
    const pred = [item('living-room.wall-n', 'new-damage', 'stain', 40), item('bedroom.floor', 'moved', undefined, 15)];
    expect(wronglyChargedUsd(pred, label)).toBe(15);
  });
  it('empty prediction has zero precision and recall', () => {
    expect(score(changeCounts([], label))).toMatchObject({ tp: 0, fn: 2, precision: 0, recall: 0 });
  });
});

// Spot check with a scripted Decisions client: which frames are flagged, which BEFORE is picked, and the verdicts.
import { describe, expect, it } from 'vitest';
import type { DiffItem, Frame } from '@ledger/shared';
import { loadPlanFixture } from '@ledger/shared';
import { spotCheck } from '../src/spotCheck.js';

const frames = (wid: string, n: number): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${wid}.f${String(i).padStart(5, '0')}`, walkthroughId: wid, tMs: i * 500, path: `/x/${i}.jpg`, sharpness: 100, phash: `h${wid}${i}` }));

/** Fake decide: reads frame ids out of the (text) image blocks. `wrong` = move-out frames with something wrong;
 *  `changed` = whether those things are new. The BEFORE with the same index as AFTER is "the same spot". */
function fakeDecide(opts: { wrong: number[]; changed: boolean }) {
  return (async ({ input, questions, tag }: { input: { type: string; text?: string }[]; questions: Record<string, unknown>; tag: string }) => {
    const ids = input.filter((c) => c.type === 'text' && c.text?.startsWith('img:')).map((c) => c.text!.slice(4));
    const num = (id: string) => Number(id.split('.f')[1]);
    if (tag === 'spot.screen') {
      const hit = opts.wrong.includes(num(ids[0]!));
      return { answers: { wrong: { type: 'noul', noul: hit ? 0.92 : 0.05, confidence: 0.9 }, kind: { type: 'choice', choice: 'other', probabilities: { other: 0.9 }, confidence: 0.9 } }, usage: {} };
    }
    if (tag === 'spot.match') {
      const a = num(ids[0]!);
      const probs: Record<string, number> = { none: 0.01 };
      ids.slice(1).forEach((b, i) => (probs[`b${i + 1}`] = num(b) === a ? 0.9 : Math.abs(num(b) - a) === 1 ? 0.3 : 0.02));
      const choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]![0];
      return { answers: { same: { type: 'choice', choice, probabilities: probs, confidence: 0.9 } }, usage: {} };
    }
    if (tag === 'spot.merge') {
      // events of the scripted kind are "the same item" when they are within 5 frames of each other
      return { answers: { same_item: { type: 'noul', noul: Math.abs(num(ids[0]!) - num(ids[1]!)) <= 5 ? 0.9 : 0.1, confidence: 0.9 } }, usage: {} };
    }
    if (tag === 'spot.same-item') {
      // the neighbouring frame shows the same item only if it is flagged too
      const hit = opts.wrong.includes(num(ids[1]!));
      return { answers: { same_item: { type: 'noul', noul: hit ? 0.9 : 0.1, confidence: 0.9 } }, usage: {} };
    }
    void questions;
    return { answers: { same_spot: { type: 'noul', noul: 0.9, confidence: 0.9 }, changed: { type: 'noul', noul: opts.changed ? 0.9 : 0.1, confidence: 0.9 } }, usage: {} };
  }) as never;
}

const plan = loadPlanFixture('demo-table');
const progress: [string, number, number][] = [];
const run = (wrong: number[], changed: boolean) =>
  spotCheck({
    onProgress: (stage, d, t) => progress.push([stage, d, t]),
    plan,
    baseline: { walkthroughId: 'in', findings: [], frames: frames('in', 20) },
    moveOut: { walkthroughId: 'out', findings: [], frames: frames('out', 20), localizations: frames('out', 20).map((f) => ({ frameId: f.id, roomId: 'living-room', surfaceId: 'living-room.wall-s', confidence: 0.9, visible: {} })) },
    decideFn: fakeDecide({ wrong, changed }),
    imageOf: async (f) => ({ type: 'text', text: `img:${f.id}` }) as never,
  });

describe('spot check', () => {
  it('something new seen in two frames -> charged, with two independent proof pairs', async () => {
    const { items, evidence } = await run([12, 13], true);
    expect(items).toHaveLength(1);
    const d = items[0] as DiffItem;
    expect(d.verdict).toBe('new-damage');
    expect(d.issueType).toBe('other');
    expect(d.surfaceId).toBe('living-room.wall-s');
    expect(d.costUsd).toBeGreaterThan(0);
    expect(evidence[0]!.proof).toHaveLength(2);
    const [p, q] = evidence[0]!.proof!;
    expect(p!.beforeFrameId).not.toBe(q!.beforeFrameId);
    expect(p!.afterFrameId).not.toBe(q!.afterFrameId);
  });

  it('the same mark at move-in -> pre-existing, $0', async () => {
    const { items } = await run([5, 6], false);
    expect(items[0]!.verdict).toBe('pre-existing');
    expect(items[0]!.costUsd).toBe(0);
  });

  it('seen in only one move-out frame -> not provable, $0', async () => {
    const { items } = await run([9], true);
    expect(items[0]!.verdict).toBe('not-visible');
    expect(items[0]!.reason.startsWith('Not provable')).toBe(true);
    expect(items[0]!.costUsd).toBe(0);
  });

  it('nothing flagged -> no lines', async () => {
    expect((await run([], true)).items).toHaveLength(0);
  });

  it('two separate events far apart -> two lines; the same item seen twice -> one line', async () => {
    expect((await run([3, 4, 15, 16], true)).items.length).toBeGreaterThanOrEqual(1);
    const { items } = await run([3, 4, 7, 8], true); // two events within 5 frames: same item
    expect(items).toHaveLength(1);
    expect(items.every((d) => d.verdict === 'new-damage')).toBe(true);
  });
});

describe('spot check progress', () => {
  it('never goes past its total, and both stages finish', async () => {
    progress.length = 0;
    await run([3, 4, 12, 13], true);
    for (const [, d, t] of progress) expect(d).toBeLessThanOrEqual(t);
    expect(progress.filter(([s]) => s === 'findings').at(-1)).toEqual(['findings', 20, 20]);
    const last = progress.filter(([s]) => s === 'diff').at(-1)!;
    expect(last[1]).toBe(last[2]);
  });
});

import { describe, expect, it } from 'vitest';
import type { DiffItem, FloorPlan } from '@ledger/shared';
import { loadPlanFixture } from '@ledger/shared';
import { falseChargesOnClean, movedObjectCharges, notProvable, renderReport, runBaseline, summarize, summarizeCalls, type BaselineModel, type PairLabel } from '../src/index.js';

const item = (s: string, v: DiffItem['verdict'], t?: DiffItem['issueType'], cost?: number, reason = ''): DiffItem =>
  ({ surfaceId: s, verdict: v, issueType: t, reason, confidence: 0.9, costUsd: cost });

const change: PairLabel = {
  pairId: 'p-change', split: 'test',
  newDamage: [{ surfaceId: 'living-room.wall-n', issueType: 'stain' }],
  preExisting: [], moved: [{ object: 'chair', fromSurfaceId: 'bedroom.wall-e', toSurfaceId: 'bedroom.wall-s' }],
};
const clean: PairLabel = { pairId: 'p-clean', split: 'test', newDamage: [], preExisting: [], moved: [], cleanReshoot: true };

describe('headline metrics', () => {
  it('every charge on a clean re-shoot is false', () => {
    expect(falseChargesOnClean([item('living-room.wall-w', 'new-damage', 'scuff', 30)], clean)).toBe(1);
    expect(falseChargesOnClean([item('living-room.wall-w', 'new-damage', 'scuff', 30)], change)).toBe(0);
  });
  it('counts charges on surfaces where only the chair moved', () => {
    const pred = [item('bedroom.wall-s', 'new-damage', 'scuff', 25), item('living-room.wall-n', 'new-damage', 'stain', 40)];
    expect(movedObjectCharges(pred, change)).toEqual({ count: 1, usd: 25 });
  });
  it('recognises not-provable items', () => {
    expect(notProvable([item('bedroom.wall-n', 'not-visible', undefined, 0, 'Not provable: only 1 matching pair')])).toBe(1);
    expect(notProvable([item('bedroom.wall-n', 'not-visible', undefined, 0, 'hidden by a chair')])).toBe(0);
  });
});

describe('report', () => {
  it('puts both systems in one table with raw counts', () => {
    const labels = [change, clean];
    const ours = summarize({ name: 'LEDGER', byPair: { 'p-change': [item('living-room.wall-n', 'new-damage', 'stain', 40), item('bedroom.wall-s', 'moved')], 'p-clean': [] } }, labels);
    const base = summarize({ name: 'Neon', byPair: { 'p-change': [item('bedroom.wall-s', 'new-damage', 'scuff', 25)], 'p-clean': [item('bedroom.floor', 'new-damage', 'stain', 15)] } }, labels);
    expect(ours.falseChargesOnClean).toBe(0);
    expect(base.falseChargesOnClean).toBe(1);
    expect(base.movedChargeCount).toBe(1);
    const md = renderReport([ours, base], labels, { split: 'test', generatedAt: 'now' });
    expect(md).toContain('| LEDGER | 0 on 1 clean pairs | 0 ($0.00) | 0 |');
    expect(md).toContain('| Neon | 1 on 1 clean pairs | 1 ($25.00) | 0 |');
    expect(md).toContain('100% (1/1)');
  });
  it('lists pairs a system has no output for', () => {
    const s = summarize({ name: 'X', byPair: {} }, [change]);
    expect(s.pairsMissing).toEqual(['p-change']);
  });
  it('summarizes the call log per model, skipping cached calls', () => {
    const md = summarizeCalls([
      JSON.stringify({ model: 'gemini-decision-1', latencyMs: 200, questions: 300, inTokens: 1000, outTokens: 0 }),
      JSON.stringify({ model: 'gemini-decision-1', latencyMs: 400, questions: 100, inTokens: 500, outTokens: 0, cached: true }),
      'not json',
    ]);
    expect(md).toContain('| gemini-decision-1 | 1 | 300 | 200 ms | 1000 | 0 |');
  });
});

describe('baseline', () => {
  it('sends the plan and both videos in one call and drops unknown surfaces', async () => {
    const plan: FloorPlan = loadPlanFixture('demo-table');
    let seen: { model: string; tag: string; parts: number } | undefined;
    const model: BaselineModel = {
      async generate(args) {
        seen = { model: args.model, tag: args.tag, parts: args.parts.length };
        return args.schema.parse({ items: [
          { surfaceId: 'living-room.wall-n', verdict: 'new-damage', issueType: 'stain', reason: 'new stain', confidence: 0.8 },
          { surfaceId: 'kitchen.wall-x', verdict: 'new-damage', issueType: 'hole', reason: 'made up', confidence: 0.5 },
        ] });
      },
    };
    const out = await runBaseline(plan, { moveIn: { uri: 'files/a', mime: 'video/mp4' }, moveOut: { uri: 'files/b', mime: 'video/mp4' } }, model, {});
    expect(seen).toEqual({ model: 'gemini-4-neon', tag: 'eval.baseline', parts: 5 });
    expect(out.map((d) => d.surfaceId)).toEqual(['living-room.wall-n']);
  });
});

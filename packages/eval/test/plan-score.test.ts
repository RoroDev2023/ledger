import { describe, expect, it } from 'vitest';
import { loadPlanFixture, type FloorPlan } from '@ledger/shared';
import { scorePlan } from '../src/index.js';

describe('scorePlan', () => {
  it('a plan scored against itself is perfect', () => {
    const p = loadPlanFixture('studio-l');
    expect(scorePlan(p, p)).toEqual({ roomsTrue: 2, roomsFound: 2, roomNamesMatched: 2, openingsTrue: 4, openingsFound: 4, medianDimErrorPct: 0 });
  });
  it('is invariant to a shifted origin and catches a 10% scale error and a missing door', () => {
    const t = loadPlanFixture('demo-table');
    const shifted: FloorPlan = {
      ...t,
      rooms: t.rooms.map((r) => ({ ...r, polygon: r.polygon.map(([x, y]) => [x * 1.1 + 5, y * 1.1 + 5] as [number, number]) })),
      surfaces: t.surfaces.map((s) => (s.segment ? { ...s, segment: s.segment.map(([x, y]) => [x * 1.1 + 5, y * 1.1 + 5]) as [[number, number], [number, number]] } : s)),
      openings: t.openings.filter((o) => o.id !== 'door-entry'),
    };
    const s = scorePlan(shifted, t);
    expect(s.openingsFound).toBe(3);
    expect(s.medianDimErrorPct).toBeCloseTo(10, 0);
  });
});

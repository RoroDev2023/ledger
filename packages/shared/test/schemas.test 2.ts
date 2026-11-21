import { describe, expect, it } from 'vitest';
import { BBoxSchema, FindingSchema, FloorPlanSchema, listPlanFixtures, loadPlanFixture, scoreToSeverity, statementDueBy } from '../src/index.js';

describe('contract', () => {
  it('every committed plan fixture validates', () => {
    const names = listPlanFixtures();
    expect(names).toContain('demo-table');
    for (const n of names) expect(() => loadPlanFixture(n)).not.toThrow();
  });

  it('bbox must be ordered [ymin, xmin, ymax, xmax] in [0, 1]', () => {
    expect(BBoxSchema.safeParse([0.1, 0.2, 0.5, 0.6]).success).toBe(true);
    expect(BBoxSchema.safeParse([0.5, 0.2, 0.1, 0.6]).success).toBe(false);
    expect(BBoxSchema.safeParse([0.1, 0.2, 0.5, 1.2]).success).toBe(false);
  });

  it('severity conversion maps score 0-4 to 1-5 and rejects bad input', () => {
    expect(scoreToSeverity(0)).toBe(1);
    expect(scoreToSeverity(2.4)).toBe(3);
    expect(scoreToSeverity(4)).toBe(5);
    expect(() => scoreToSeverity(4.5)).toThrow();
    expect(() => scoreToSeverity(Number.NaN)).toThrow();
  });

  it('statement is due 14 days after move-out', () => {
    expect(statementDueBy('2026-11-21')).toBe('2026-12-05');
    expect(statementDueBy('2026-12-25')).toBe('2027-01-08');
  });

  it('rejects a plan whose opening points at a missing wall', () => {
    const plan = loadPlanFixture('demo-table');
    const bad = { ...plan, openings: [...plan.openings, { id: 'x', kind: 'door', wallId: 'nope.wall-n', offsetM: 0, widthM: 1 }] };
    expect(FloorPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('a finding needs at least one frame and a valid severity', () => {
    const base = { id: 'f1', walkthroughId: 'w1', surfaceId: 'living-room.wall-n', type: 'stain', confidence: 0.9, severity: 3, frameIds: ['fr1'], decidedBy: 'decisions-api' };
    expect(FindingSchema.safeParse(base).success).toBe(true);
    expect(FindingSchema.safeParse({ ...base, frameIds: [] }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...base, severity: 6 }).success).toBe(false);
  });
});

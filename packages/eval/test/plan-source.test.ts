import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRoomPlanScan, planFromJson, resolvePlan } from '../src/plan-source.js';
import { parseCard, parseIssue } from '../src/card.js';

const scan = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'plan', 'test', 'fixtures', 'scan-rect-room.json'), 'utf8'));

describe('plan-source', () => {
  it('tells a RoomPlan scan from a FloorPlan', () => {
    expect(isRoomPlanScan(scan)).toBe(true);
    expect(isRoomPlanScan(resolvePlan('demo-table'))).toBe(false);
  });
  it('converts a scan into wall ids the cards can use', () => {
    const plan = planFromJson(scan, 'pair-x');
    expect(plan.unitId).toBe('pair-x');
    expect(plan.surfaces.filter((s) => s.kind === 'wall').length).toBe(4);
  });
  it('loads fixtures by name and rejects unknown names', () => {
    expect(resolvePlan('demo-table').unitId).toBe('demo-table');
    expect(() => resolvePlan('no-such-plan')).toThrow(/no plan fixture or file/);
  });
});

describe('card', () => {
  it('maps everyday words to issue types', () => {
    expect(parseIssue('scratch')).toBe('scuff');
    expect(parseIssue('stain')).toBe('stain');
    expect(() => parseIssue('dent')).toThrow(/unknown issue type/);
  });
  it('parses a filled card', () => {
    const l = parseCard('t1', ['--new', 'room-1.wall-n:scratch', '--moved', 'bag:room-1.wall-e']);
    expect(l).toEqual({ pairId: 't1', split: 'test', newDamage: [{ surfaceId: 'room-1.wall-n', issueType: 'scuff' }], preExisting: [], moved: [{ object: 'bag', fromSurfaceId: 'room-1.wall-e' }] });
  });
  it('parses a clean re-shoot and refuses empty or contradictory cards', () => {
    expect(parseCard('t2', ['--clean', '--split', 'dev']).cleanReshoot).toBe(true);
    expect(() => parseCard('t3', [])).toThrow(/empty/);
    expect(() => parseCard('t4', ['--clean', '--new', 'a.wall-n:hole'])).toThrow(/nothing changed/);
  });
});

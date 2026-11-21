import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlanFixture } from '@ledger/shared';
import { describePrice, loadPricing, priceDamage, surfaceAreaM2 } from '../src/price.js';

const plan = loadPlanFixture('demo-table');

describe('surfaceAreaM2', () => {
  it('wall length × ceiling height − openings', () => {
    expect(surfaceAreaM2(plan, 'living-room.wall-s')).toBe(5.7); // 3 × 2.5 − door 0.9 × 2.0
    expect(surfaceAreaM2(plan, 'living-room.wall-e')).toBe(4.65); // 2.5 × 2.5 − door 0.8 × 2.0
    expect(surfaceAreaM2(plan, 'living-room.wall-n')).toBe(6.06); // 3 × 2.5 − window 1.2 × 1.2
    expect(surfaceAreaM2(plan, 'bedroom.wall-s')).toBe(6.25); // no openings
  });
  it('matches the plan package for every wall, and uses areaM2 for floors', () => {
    for (const s of plan.surfaces) expect(surfaceAreaM2(plan, s.id)).toBe(s.areaM2);
    expect(surfaceAreaM2(plan, 'nope')).toBeUndefined();
  });
});

describe('priceDamage', () => {
  it('loads the placeholder pricing.json', () => {
    const p = loadPricing();
    expect(p.currency).toBe('USD');
    expect(p.rates.paintPerM2).toBeGreaterThan(0);
  });

  it('flat + rate × area, rounded to cents', () => {
    const p = priceDamage({ plan, surfaceId: 'living-room.wall-s', issueType: 'hole' });
    expect(p.flatUsd).toBe(85);
    expect(p.areaM2).toBe(5.7);
    expect(p.costUsd).toBe(153.4); // 85 + 5.7 × 12
    expect(describePrice(p)).toBe('5.70 m² at $12.00/m² + $85.00 flat = $153.40');
  });

  it('rate only, flat only, and per-kind overrides', () => {
    expect(priceDamage({ plan, surfaceId: 'living-room.wall-n', issueType: 'stain' }).costUsd).toBe(72.72);
    expect(priceDamage({ plan, surfaceId: 'living-room.wall-n', issueType: 'missing-fixture' }).costUsd).toBe(120);
    const floor = priceDamage({ plan, surfaceId: 'living-room.floor', issueType: 'stain' });
    expect(floor.costUsd).toBe(60); // cleaning flat, not repaint × floor area
    expect(floor.areaM2).toBeUndefined();
  });

  it('depreciation is off by default and max(0, 1 − age / life) when enabled', () => {
    const base = { plan, surfaceId: 'living-room.wall-n', issueType: 'stain' as const };
    expect(priceDamage(base).depreciationFactor).toBe(1);
    expect(priceDamage({ ...base, depreciation: { enabled: false, ageYears: 3 } }).costUsd).toBe(72.72);
    expect(priceDamage({ ...base, depreciation: { enabled: true, ageYears: 2 } }).costUsd).toBe(36.36); // paint life 4 y
    expect(priceDamage({ ...base, depreciation: { enabled: true, ageYears: 9 } }).costUsd).toBe(0);
  });

  it('rejects a pricing file that references an unknown rate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-pricing-'));
    const bad = JSON.parse(JSON.stringify(loadPricing())) as { issues: { stain: { perM2: string } } };
    bad.issues.stain.perM2 = 'goldLeafPerM2';
    writeFileSync(join(dir, 'p.json'), JSON.stringify(bad));
    expect(() => loadPricing(join(dir, 'p.json'))).toThrow(/unknown rate .*goldLeafPerM2/);
  });
});

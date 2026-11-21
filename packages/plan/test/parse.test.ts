import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FloorPlanSchema, loadPlanFixture } from '@ledger/shared';
import { imageSize, mergeVertices, parsePlan, planFromArgon, renderPlanSvg, scaleFromLabels, snapToAxes, type ArgonPlan, type PlanModel } from '../src/index.js';

// Two rooms side by side on a 1000x800 px image. A 4.0 m label spans 400 px -> 0.01 m/px.
const argon: ArgonPlan = {
  rooms: [
    { name: 'Living room', polygon: [[100, 125], [501, 126], [500, 625], [100, 625]] },
    { name: 'Bedroom', polygon: [[502, 125], [800, 125], [800, 624], [500, 625]] },
  ],
  openings: [{ kind: 'door', a: [250, 625], b: [340, 625] }, { kind: 'window', a: [800, 300], b: [800, 420] }],
  dimensionLabels: [{ text: "13'1\"", meters: 4.0, a: [100, 650], b: [500, 650] }],
  fixtures: [{ room: 'Bedroom', name: 'radiator' }],
  printedTotalAreaM2: null,
  northArrowDeg: null,
};
const IMG = { width: 1000, height: 800 };

function fakePng(w: number, h: number): string {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8);
  b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  const p = join(mkdtempSync(join(tmpdir(), 'plan-')), 'plan.png');
  writeFileSync(p, b);
  return p;
}

describe('geometry cleanup', () => {
  it('merges near-duplicate corners shared by two rooms', () => {
    const [a, b] = mergeVertices([[[500, 125], [501, 126], [0, 0]], [[502, 125], [900, 900], [0, 900]]]);
    expect(a![0]).toEqual(b![0]);
  });
  it('snaps almost-straight edges onto the axis', () => {
    const p = snapToAxes([[0, 0], [100, 2], [100, 100], [0, 100]]);
    expect(p[1]![1]).toBe(0);
  });
});

describe('scale', () => {
  it('uses the median label and drops outliers', () => {
    const s = scaleFromLabels([
      { meters: 4, a: [0, 0], b: [400, 0] },
      { meters: 3, a: [0, 0], b: [300, 0] },
      { meters: 9, a: [0, 0], b: [300, 0] }, // way off
    ]);
    expect(s.scaleSource).toBe('labels');
    expect(s.metersPerPixel).toBeCloseTo(0.01);
    expect(s.warnings.length).toBe(1);
  });
  it('falls back to an assumption with a warning', () => {
    const s = scaleFromLabels([]);
    expect(s.scaleSource).toBe('assumed');
    expect(s.warnings[0]).toMatch(/assumed/);
  });
});

describe('planFromArgon', () => {
  it('builds a valid plan in meters with walls, openings and fixtures', () => {
    const { plan, errors } = planFromArgon(argon, IMG, { unitId: 'u1', ceilingHeightM: 2.5 });
    expect(errors).toEqual([]);
    expect(FloorPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.metersPerPixel).toBeCloseTo(0.01);
    const living = plan.rooms.find((r) => r.id === 'living-room')!;
    expect(living.polygon.map((p) => p[0])).toContain(1); // 100 px -> 1 m
    expect(plan.openings.find((o) => o.kind === 'door')!.wallId).toBe('living-room.wall-s');
    expect(plan.openings.find((o) => o.kind === 'window')!.wallId).toBe('bedroom.wall-e');
    expect(plan.surfaces.some((s) => s.id === 'bedroom.fixture-radiator')).toBe(true);
  });
  it('flags a printed total area that does not match', () => {
    const { errors } = planFromArgon({ ...argon, printedTotalAreaM2: 60 }, IMG, { unitId: 'u1' });
    expect(errors.join(' ')).toMatch(/off by more than 15%/);
  });
});

describe('parsePlan with a mocked model', () => {
  it('reads image size from the header and returns the plan', async () => {
    const path = fakePng(1000, 800);
    expect(imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(12).fill(0), 0, 0, 3, 232, 0, 0, 3, 32]))).toEqual({ width: 1000, height: 800 });
    const calls: string[] = [];
    const model: PlanModel = { async generate(args) { calls.push(args.tag); return args.schema.parse(argon); } };
    const plan = await parsePlan(path, model, { unitId: 'u1', ceilingHeightM: 2.5, env: {} });
    expect(calls).toEqual(['plan.parse']);
    expect(plan.rooms).toHaveLength(2);
  });
  it('runs up to two repair rounds, then keeps the problems as warnings', async () => {
    const path = fakePng(1000, 800);
    const calls: string[] = [];
    const model: PlanModel = { async generate(args) { calls.push(args.tag); return args.schema.parse({ ...argon, printedTotalAreaM2: 60 }); } };
    const plan = await parsePlan(path, model, { unitId: 'u1', env: {} });
    expect(calls).toEqual(['plan.parse', 'plan.repair.1', 'plan.repair.2']);
    expect(plan.warnings.some((w) => w.startsWith('unresolved:'))).toBe(true);
  });
});

describe('renderPlanSvg', () => {
  it('draws every wall with its surface id', () => {
    const plan = loadPlanFixture('demo-table');
    const svg = renderPlanSvg(plan);
    for (const s of plan.surfaces.filter((x) => x.kind === 'wall')) expect(svg).toContain(`data-surface-id="${s.id}"`);
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

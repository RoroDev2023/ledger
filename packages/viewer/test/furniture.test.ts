import { describe, expect, it } from 'vitest';
import { chairsAround, furnitureKind, placeFurniture } from '../src/placement.js';
import { planGeometry } from '../src/geometry.js';
import { SAMPLES } from '../src/samples.js';

const plan = SAMPLES.find((s) => s.id === 'furnished')!.plan;
const pieces = placeFurniture(plan, planGeometry(plan));
const get = (k: string) => pieces.find((p) => p.surfaceId.endsWith(k))!;

describe('furniture', () => {
  it('recognizes kinds from names', () => {
    expect(furnitureKind('Framed portrait')).toBe('art');
    expect(furnitureKind('brass wall light')).toBe('light');
    expect(furnitureKind('Concrete column')).toBe('column');
    expect(furnitureKind('Conference table')).toBe('table');
    expect(furnitureKind('credenza')).toBe('cabinet');
    expect(furnitureKind('stove')).toBe('fixture');
  });

  it('hangs the portrait on the east wall at eye height, facing into the room', () => {
    const art = get('portrait');
    expect(art.kind).toBe('art');
    expect(art.wallSurfaceId).toBe('conference.wall-2'); // east wall (x = 4.6)
    expect(art.position[0]).toBeLessThan(4.6);
    expect(art.position[0]).toBeGreaterThan(4.4);
    expect(art.position[1]).toBeGreaterThan(1.2);
    expect(Math.sin(art.rotationY)).toBeCloseTo(-1); // facing west (into the room)
  });

  it('places the table, cabinet and column at their drawn outlines, column floor to ceiling', () => {
    const t = get('table');
    expect(t.size[0]).toBeCloseTo(1.5);
    expect(t.size[2]).toBeCloseTo(3.8);
    expect(t.position[0]).toBeCloseTo(2.3);
    expect(t.position[2]).toBeCloseTo(-3.8);
    expect(get('column').size[1]).toBe(plan.ceilingHeightM);
    expect(get('cabinet').size[0]).toBeCloseTo(3.6);
  });

  it('puts chairs on both long sides of the table, all facing it', () => {
    const chairs = chairsAround(get('table'));
    expect(chairs.length).toBe(2 * 4); // 3.8 m long -> 4 per side
    for (const c of chairs) {
      const toTable = [get('table').position[0] - c.position[0], get('table').position[2] - c.position[2]];
      const front = [Math.sin(c.rotationY), Math.cos(c.rotationY)];
      expect(toTable[0]! * front[0]! + toTable[1]! * front[1]!).toBeGreaterThan(0);
    }
  });

  it('fixtures without a position are not placed', () => {
    const p2 = { ...plan, surfaces: plan.surfaces.map((s) => (s.kind === 'fixture' ? { ...s, at: undefined, footprint: undefined } : s)) };
    expect(placeFurniture(p2, planGeometry(p2))).toHaveLength(0);
  });
});

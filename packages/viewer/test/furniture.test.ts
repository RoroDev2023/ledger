import { describe, expect, it } from 'vitest';
import { chairsAround, furnitureKind, placeFurniture } from '../src/placement.js';
import { pinAnchors, planGeometry, spotAnchor } from '../src/geometry.js';
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

describe('pins on items', () => {
  const geo = planGeometry(plan);
  it('a line about the column gets its pin on the column, not mid-wall', () => {
    const col = get('column');
    const [pin] = pinAnchors(geo, col.surfaceId, 1, pieces);
    expect(Math.hypot(pin![0] - col.position[0], pin![2] - col.position[2])).toBeLessThan(0.05);
    expect(pin![1]).toBeCloseTo(col.size[1] / 2);
  });
  it('a line about the portrait sits just in front of it, above the frame', () => {
    const art = get('portrait');
    const [pin] = pinAnchors(geo, art.surfaceId, 1, pieces);
    expect(Math.hypot(pin![0] - art.position[0], pin![2] - art.position[2])).toBeLessThan(0.3);
    expect(pin![1]).toBeGreaterThan(art.position[1]);
  });
  it('a line about a wall still sits on the wall', () => {
    const [pin] = pinAnchors(geo, 'conference.wall-4', 1, pieces);
    expect(pin![0]).toBeLessThan(0.5); // west wall at x = 0
  });
});

describe('pins at the exact spot (any surface)', () => {
  const geo = planGeometry(plan);
  it('a mark halfway up the column: on the column, at that height', () => {
    const col = get('column');
    const at = spotAnchor(geo, plan, { surfaceId: col.surfaceId, spot: { heightM: 1.2 } }, pieces)!;
    expect(at[1]).toBeCloseTo(1.2);
    expect(Math.hypot(at[0] - col.position[0], at[2] - col.position[2])).toBeLessThan(0.45);
  });
  it('a mark high on a wall next to the portrait: on that wall, beside the portrait, high up', () => {
    const art = get('portrait');
    const at = spotAnchor(geo, plan, { surfaceId: art.wallSurfaceId!, spot: { heightM: 1.95, nearId: art.surfaceId } }, pieces)!;
    expect(at[1]).toBeCloseTo(1.95);
    expect(Math.hypot(at[0] - art.position[0], at[2] - art.position[2])).toBeLessThan(0.3);
  });
  it('a mark low on a wall next to a door: near the door, near the floor', () => {
    const door = plan.openings.find((o) => o.kind === 'door')!;
    const at = spotAnchor(geo, plan, { surfaceId: door.wallId, spot: { heightM: 0.15, nearId: door.id } }, pieces)!;
    const host = plan.surfaces.find((x) => x.id === door.wallId)!.segment!;
    const len = Math.hypot(host[1][0] - host[0][0], host[1][1] - host[0][1]);
    const k = (door.offsetM + door.widthM / 2) / len;
    const mid = [host[0][0] + (host[1][0] - host[0][0]) * k, -(host[0][1] + (host[1][1] - host[0][1]) * k)];
    expect(at[1]).toBeCloseTo(0.15);
    expect(Math.hypot(at[0] - mid[0]!, at[2] - mid[1]!)).toBeLessThan(0.3);
  });
  it('no spot: falls back to the surface pins', () => {
    expect(spotAnchor(geo, plan, { surfaceId: 'conference.wall-4' }, pieces)).toBeNull();
  });
});

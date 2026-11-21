// Tricky plans: L shapes, angled and rotated walls, tiny and huge rooms, crowded walls, bad data.
import { describe, expect, it } from 'vitest';
import { FloorPlanSchema, loadPlanFixture } from '@ledger/shared';
import { pinAnchors, planGeometry, pointInPolygon, wallGeometry } from '../src/geometry.js';
import { pinKind } from '../src/colors.js';
import { makePlan, SAMPLES } from '../src/samples.js';

const finite = (v: number[]) => v.every(Number.isFinite);
const plan2d = (p: [number, number, number]): [number, number] => [p[0], -p[2]];

describe('every sample plan', () => {
  for (const s of SAMPLES) {
    describe(s.title, () => {
      const geo = planGeometry(s.plan);

      it('is a valid plan under the shared contract', () => {
        expect(() => FloorPlanSchema.parse(s.plan)).not.toThrow();
      });

      it('every wall becomes finite, positive boxes no taller than the ceiling', () => {
        expect(geo.walls).toHaveLength(s.plan.surfaces.filter((x) => x.kind === 'wall').length);
        for (const w of geo.walls)
          for (const p of w.pieces) {
            expect(finite([...p.position, ...p.size, p.rotationY])).toBe(true);
            expect(Math.min(...p.size)).toBeGreaterThan(0);
            expect(p.position[1] + p.size[1] / 2).toBeLessThanOrEqual(s.plan.ceilingHeightM + 1e-9);
          }
      });

      it("every wall's inward side is inside its own room (works for concave rooms)", () => {
        for (const w of geo.walls) {
          const room = s.plan.rooms.find((r) => r.id === w.roomId)!;
          const probe = plan2d([w.center[0] + w.inward[0] * 0.05, 0, w.center[2] + w.inward[1] * 0.05]);
          expect(pointInPolygon(probe, room.polygon), w.surfaceId).toBe(true);
        }
      });

      it('every pin lands at a finite spot within the unit (with a margin)', () => {
        const { min, max } = geo.bounds;
        const counts = new Map<string, number>();
        for (const it of s.items) counts.set(it.surfaceId, (counts.get(it.surfaceId) ?? 0) + 1);
        for (const [sid, n] of counts) {
          const pins = pinAnchors(geo, sid, n);
          expect(pins).toHaveLength(n);
          for (const p of pins) {
            expect(finite(p)).toBe(true);
            const [x, y] = plan2d(p);
            expect(x).toBeGreaterThan(min[0] - 1.5);
            expect(x).toBeLessThan(max[0] + 1.5);
            expect(y).toBeGreaterThan(min[1] - 1.5);
            expect(y).toBeLessThan(max[1] + 1.5);
          }
        }
      });
    });
  }
});

describe('specific shapes', () => {
  const get = (id: string) => SAMPLES.find((s) => s.id === id)!;

  it('L shape: the two walls at the inside corner face into the L', () => {
    const geo = planGeometry(get('l-shape').plan);
    const w3 = geo.walls.find((w) => w.surfaceId === 'living.wall-3')!; // [6,2.5] -> [2.5,2.5], room is below
    const w4 = geo.walls.find((w) => w.surfaceId === 'living.wall-4')!; // [2.5,2.5] -> [2.5,5], room is to the west
    expect(w3.inward[1]).toBeCloseTo(1); // plan -y = 3D +z
    expect(w4.inward[0]).toBeCloseTo(-1);
  });

  it('angled wall: rotated 45° and its window cuts a gap', () => {
    const geo = planGeometry(get('angled').plan);
    const bay = geo.walls.find((w) => w.surfaceId === 'bay.wall-2')!;
    expect(bay.pieces[0]!.rotationY).toBeCloseTo(Math.PI / 4);
    expect(bay.pieces.length).toBe(4); // before, below, above, after the window
  });

  it('rotated building: the shared wall between A and B becomes two slabs facing opposite ways', () => {
    const geo = planGeometry(get('rotated').plan);
    const a2 = geo.walls.find((w) => w.surfaceId === 'a.wall-2')!;
    const b4 = geo.walls.find((w) => w.surfaceId === 'b.wall-4')!;
    expect(a2.inward[0] * b4.inward[0] + a2.inward[1] * b4.inward[1]).toBeCloseTo(-1);
  });

  it('far from origin: the camera target is the plan center, not 0,0', () => {
    const geo = planGeometry(get('far-from-origin').plan);
    expect(geo.bounds.center[0]).toBeCloseTo(122);
    expect(geo.bounds.center[2]).toBeCloseTo(-81.5);
  });

  it('loft: six windows cut six gaps in one wall', () => {
    const geo = planGeometry(get('loft').plan);
    const wall = geo.walls.find((w) => w.surfaceId === 'loft.wall-3')!;
    expect(wall.pieces.length).toBe(7 + 6 * 2); // 7 solid stretches + below/above each window
    expect(geo.bounds.size).toBe(18);
  });

  it('crowded wall: six pins spread along the wall, at least 70 cm apart, alternating height', () => {
    const geo = planGeometry(get('crowded-wall').plan);
    const pins = pinAnchors(geo, 'hall.wall-3', 6);
    for (let i = 1; i < pins.length; i++) {
      expect(Math.hypot(pins[i]![0] - pins[i - 1]![0], pins[i]![2] - pins[i - 1]![2])).toBeGreaterThanOrEqual(0.7);
      expect(pins[i]![1]).not.toBeCloseTo(pins[i - 1]![1]);
    }
    const xs = pins.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0); // still on the 6 m wall
    expect(Math.max(...xs)).toBeLessThan(6);
  });

  it('closet: the camera frame is at least 3.5 m, so the camera stays outside the room', () => {
    expect(planGeometry(get('tiny').plan).bounds.size).toBe(3.5);
  });

  it('unknown surfaces fall back to the room floor, then the unit center', () => {
    const geo = planGeometry(get('unknown-surface').plan);
    const [sink] = pinAnchors(geo, 'room.fixture-sink', 1);
    const [ghost] = pinAnchors(geo, 'kitchen.wall-9', 1);
    expect(sink![0]).toBeCloseTo(2);
    expect(ghost![0]).toBeCloseTo(geo.bounds.center[0]);
  });

  it('a wall whose segment is not on its room outline still gets a sensible inward side', () => {
    const plan = makePlan('bad', [{ id: 'r', name: 'R', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }]);
    const stray = { ...plan.surfaces[0]!, id: 'r.wall-x', segment: [[1, 1], [3, 1]] as [[number, number], [number, number]] };
    const g = wallGeometry(stray, plan.rooms[0]!, 2.5, []);
    expect(g).not.toBeNull();
    expect(finite([...g!.inward])).toBe(true);
  });

  it('every-verdict sample covers every pin kind except no-change', () => {
    expect(new Set(get('every-verdict').items.map(pinKind))).toEqual(new Set(['new-damage', 'pre-existing', 'wear', 'moved', 'not-provable', 'not-visible']));
  });

  it('fixtures still pass after the inward change', () => {
    for (const name of ['demo-table', 'studio-l', 'one-bed-railroad']) {
      const plan = loadPlanFixture(name);
      const geo = planGeometry(plan);
      for (const w of geo.walls) {
        const room = plan.rooms.find((r) => r.id === w.roomId)!;
        expect(pointInPolygon(plan2d([w.center[0] + w.inward[0] * 0.05, 0, w.center[2] + w.inward[1] * 0.05]), room.polygon)).toBe(true);
      }
    }
  });
});

describe('pointInPolygon', () => {
  const L: [number, number][] = [[0, 0], [6, 0], [6, 2.5], [2.5, 2.5], [2.5, 5], [0, 5]];
  it('handles the concave notch', () => {
    expect(pointInPolygon([1, 4], L)).toBe(true);
    expect(pointInPolygon([4, 4], L)).toBe(false); // the cut-out corner
    expect(pointInPolygon([5, 1], L)).toBe(true);
    expect(pointInPolygon([-1, 1], L)).toBe(false);
  });
});

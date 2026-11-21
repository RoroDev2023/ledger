import { describe, expect, it } from 'vitest';
import { listPlanFixtures, loadPlanFixture, type Opening, type Room, type Surface } from '@ledger/shared';
import { blocksView, centroid, openingGaps, pinAnchors, planGeometry, wallGeometry, WALL_THICKNESS } from '../src/geometry.js';
import { pinKind, pinStyle } from '../src/colors.js';

const room: Room = { id: 'r', name: 'R', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const south: Surface = { id: 'r.wall-s', roomId: 'r', kind: 'wall', label: 'R south', segment: [[0, 0], [4, 0]] };
const door = (offsetM: number, widthM: number): Opening => ({ id: 'd', kind: 'door', wallId: 'r.wall-s', offsetM, widthM });
const win = (offsetM: number, widthM: number): Opening => ({ id: 'w', kind: 'window', wallId: 'r.wall-s', offsetM, widthM });
const lengths = (g: ReturnType<typeof wallGeometry>) => g!.pieces.map((p) => +p.size[0].toFixed(3));

describe('centroid', () => {
  it('is the middle of a rectangle and works for an L shape', () => {
    expect(centroid([[0, 0], [4, 0], [4, 2], [0, 2]])).toEqual([2, 1]);
    const [x, y] = centroid([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
    expect(x).toBeCloseTo(5 / 6);
    expect(y).toBeCloseTo(5 / 6);
  });
});

describe('wallGeometry', () => {
  it('a plain wall is one full-height box on the room side of the line', () => {
    const g = wallGeometry(south, room, 2.5, [])!;
    expect(g.pieces).toHaveLength(1);
    const p = g.pieces[0]!;
    expect(p.size).toEqual([4, 2.5, WALL_THICKNESS]);
    expect(p.position[0]).toBeCloseTo(2);
    expect(p.position[1]).toBeCloseTo(1.25);
    expect(p.position[2]).toBeCloseTo(-WALL_THICKNESS / 2); // plan y = +t/2 (into the room) -> 3D z = -t/2
    expect(g.inward[0]).toBeCloseTo(0);
    expect(g.inward[1]).toBeCloseTo(-1); // room is north = -z
  });

  it('a door leaves a gap with a lintel above it', () => {
    const g = wallGeometry(south, room, 2.5, [door(1, 0.9)]);
    expect(lengths(g)).toEqual([1, 0.9, 2.1]); // left, lintel, right
    const lintel = g!.pieces[1]!;
    expect(lintel.size[1]).toBeCloseTo(2.5 - 2.05);
  });

  it('a window leaves wall below and above', () => {
    const g = wallGeometry(south, room, 2.5, [win(1, 1)]);
    expect(lengths(g)).toEqual([1, 1, 1, 2]);
    const [, below, above] = g!.pieces;
    expect(below!.size[1]).toBeCloseTo(0.9);
    expect(above!.size[1]).toBeCloseTo(2.5 - 2.1);
  });

  it('a door at the very start or end leaves no zero-length boxes', () => {
    expect(lengths(wallGeometry(south, room, 2.5, [door(0, 0.9)]))).toEqual([0.9, 3.1]);
    expect(lengths(wallGeometry(south, room, 2.5, [door(3.1, 0.9)]))).toEqual([3.1, 0.9]);
  });

  it('openings past the end are clamped, overlapping ones do not create negative boxes', () => {
    expect(lengths(wallGeometry(south, room, 2.5, [door(3.5, 2)]))).toEqual([3.5, 0.5]);
    const g = wallGeometry(south, room, 2.5, [door(1, 1), door(1.5, 1)]);
    expect(g!.pieces.every((p) => p.size[0] > 0 && p.size[1] > 0)).toBe(true);
  });

  it('openingGaps sorts by position', () => {
    expect(openingGaps(4, 2.5, [win(3, 0.5), door(0.5, 0.8)]).map((g) => g.from)).toEqual([0.5, 3]);
  });

  it('returns null for a wall without a segment or with zero length', () => {
    expect(wallGeometry({ ...south, segment: undefined }, room, 2.5, [])).toBeNull();
    expect(wallGeometry({ ...south, segment: [[1, 1], [1, 1]] }, room, 2.5, [])).toBeNull();
  });

  it('rotation follows the wall direction', () => {
    const east: Surface = { ...south, id: 'r.wall-e', segment: [[4, 0], [4, 3]] };
    expect(wallGeometry(east, room, 2.5, [])!.pieces[0]!.rotationY).toBeCloseTo(Math.PI / 2);
  });
});

describe('every fixture plan', () => {
  for (const name of listPlanFixtures()) {
    it(`${name}: every wall and floor surface gets geometry, every opening cuts a gap`, () => {
      const plan = loadPlanFixture(name);
      const geo = planGeometry(plan);
      expect(geo.walls.map((w) => w.surfaceId).sort()).toEqual(plan.surfaces.filter((s) => s.kind === 'wall').map((s) => s.id).sort());
      expect(geo.floors).toHaveLength(plan.surfaces.filter((s) => s.kind === 'floor').length);
      for (const w of geo.walls) {
        const openings = plan.openings.filter((o) => o.wallId === w.surfaceId).length;
        expect(w.pieces.length).toBeGreaterThanOrEqual(openings ? 2 : 1);
        for (const p of w.pieces) expect(p.size.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      }
    });

    it(`${name}: every wall's inward normal points into its own room`, () => {
      const plan = loadPlanFixture(name);
      const geo = planGeometry(plan);
      for (const w of geo.walls) {
        const room = plan.rooms.find((r) => r.id === w.roomId)!;
        const [cx, cy] = centroid(room.polygon);
        const toCenter = [cx - w.center[0], -cy - w.center[2]];
        expect(toCenter[0]! * w.inward[0] + toCenter[1]! * w.inward[1]).toBeGreaterThan(0);
      }
    });
  }

  it('shared walls become two slabs that do not overlap', () => {
    const geo = planGeometry(loadPlanFixture('demo-table'));
    const a = geo.walls.find((w) => w.surfaceId === 'living-room.wall-e')!;
    const b = geo.walls.find((w) => w.surfaceId === 'bedroom.wall-w')!;
    expect(Math.abs(a.pieces[0]!.position[0] - b.pieces[0]!.position[0])).toBeCloseTo(WALL_THICKNESS);
  });
});

describe('pins and camera', () => {
  const geo = planGeometry(loadPlanFixture('demo-table'));

  it('several pins on one wall are spread out, inside the room, at a visible height', () => {
    const pins = pinAnchors(geo, 'living-room.wall-n', 3);
    expect(new Set(pins.map((p) => p.map((v) => v.toFixed(2)).join())).size).toBe(3);
    for (const p of pins) expect(p[1]).toBeGreaterThan(1);
  });

  it('floor and unknown surfaces fall back to the room or plan center', () => {
    expect(pinAnchors(geo, 'bedroom.floor', 1)[0]![1]).toBeLessThan(1);
    expect(pinAnchors(geo, 'bedroom.fixture-sink', 1)).toHaveLength(1);
    expect(pinAnchors(geo, 'nowhere', 2)).toHaveLength(2);
  });

  it('a wall blocks the view only from outside its room', () => {
    const southWall = geo.walls.find((w) => w.surfaceId === 'living-room.wall-s')!;
    expect(blocksView(southWall, [1.5, 5, 10])).toBe(true); // camera south of the unit
    expect(blocksView(southWall, [1.5, 5, -10])).toBe(false); // camera north of it
  });

  it('frames the whole plan', () => {
    expect(geo.bounds.size).toBeGreaterThan(3);
  });
});

describe('pin colors', () => {
  it('maps verdicts, and "Not provable" overrides the verdict', () => {
    expect(pinKind({ verdict: 'new-damage', reason: 'New stain' })).toBe('new-damage');
    expect(pinKind({ verdict: 'not-visible', reason: 'Not provable: 1 pair' })).toBe('not-provable');
    expect(pinStyle({ verdict: 'moved', reason: 'x' }).charged).toBe(false);
    expect(pinStyle({ verdict: 'new-damage', reason: 'x' }).charged).toBe(true);
  });
});

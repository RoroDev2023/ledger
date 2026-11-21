import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FloorPlanSchema, type FloorPlan, type Surface } from '@ledger/shared';
import { ScanError, renderPlanSvg, scanToPlan } from '../src/index.js';

// Hand-made CapturedRoom: a 5 m (x) by 4 m (z) room, x in [-2, 3], z in [-3, 1], walls 2.5 m (one 2.4 m).
// The door is on the +x wall (parentIdentifier set), the window on the far -z wall (no parent, nearest wall).
// The sofa stands against the -x wall, the table in the middle, the sink against the +x wall.
// `coachingHint` is a made-up field to check that unknown fields are logged, not fatal.
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/scan-rect-room.json'), 'utf8')) as Record<string, unknown>;
interface Item { transform: number[]; category?: unknown; [k: string]: unknown }
type Lists = 'walls' | 'doors' | 'windows' | 'openings' | 'floors' | 'objects';
type Scan = Record<Lists, Item[]> & { sections: unknown[]; [k: string]: unknown };
const fixture = () => structuredClone(FIXTURE) as Scan;

const quiet = { unitId: 'scan-1', log: () => {} };
const wall = (p: FloorPlan, side: string): Surface => p.surfaces.find((s) => s.id === `room-1.wall-${side}`)!;
const len = (s: Surface) => Math.hypot(s.segment![1][0] - s.segment![0][0], s.segment![1][1] - s.segment![0][1]);
/** Distance from the wall's start to the opening's center. */
const along = (p: FloorPlan, id: string) => {
  const o = p.openings.find((x) => x.id === id)!;
  return o.offsetM + o.widthM / 2;
};
const point = (p: FloorPlan, wallId: string, d: number): [number, number] => {
  const [[x1, y1], [x2, y2]] = p.surfaces.find((s) => s.id === wallId)!.segment!;
  const L = Math.hypot(x2 - x1, y2 - y1);
  return [x1 + ((x2 - x1) / L) * d, y1 + ((y2 - y1) / L) * d];
};

/** Rotate (about y) and shift every transform in the scan: the same room seen from another session origin. */
function moveScene(room: ReturnType<typeof fixture>, deg: number, shift: [number, number, number]) {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const R = (v: [number, number, number]): [number, number, number] => [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  for (const key of ['walls', 'doors', 'windows', 'openings', 'floors', 'objects'] as const) {
    for (const item of room[key]) {
      const m = item.transform;
      const col = (i: number) => R([m[i * 4]!, m[i * 4 + 1]!, m[i * 4 + 2]!]);
      const t = R([m[12]!, m[13]!, m[14]!]);
      item.transform = [...col(0), 0, ...col(1), 0, ...col(2), 0, t[0] + shift[0], t[1] + shift[1], t[2] + shift[2], 1];
    }
  }
  return room;
}

describe('scanToPlan (RoomPlan CapturedRoom JSON)', () => {
  const plan = scanToPlan(fixture(), quiet);

  it('produces a valid FloorPlan in real meters', () => {
    expect(FloorPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.unitId).toBe('scan-1');
    expect(plan.scaleSource).toBe('known-measurement');
    expect(plan.ceilingHeightM).toBe(2.5); // max wall height, not the 2.4 m wall
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]!.id).toBe('room-1');
  });

  it('builds exactly 4 walls with stable compass IDs, lengths and areas minus openings', () => {
    const walls = plan.surfaces.filter((s) => s.kind === 'wall');
    expect(walls.map((w) => w.id).sort()).toEqual(['room-1.wall-e', 'room-1.wall-n', 'room-1.wall-s', 'room-1.wall-w']);
    // North = the wall the scan started facing (-z), which is 5 m long.
    expect(len(wall(plan, 'n'))).toBeCloseTo(5, 2);
    expect(len(wall(plan, 's'))).toBeCloseTo(5, 2);
    expect(len(wall(plan, 'e'))).toBeCloseTo(4, 2);
    expect(len(wall(plan, 'w'))).toBeCloseTo(4, 2);
    expect(wall(plan, 'n').areaM2).toBe(11.06); // 5 x 2.5 - window 1.2 x 1.2
    expect(wall(plan, 'e').areaM2).toBe(8.2); // 4 x 2.5 - door 0.9 x 2.0
    expect(wall(plan, 's').areaM2).toBe(12.5);
    expect(wall(plan, 'w').areaM2).toBe(10);
    expect(plan.surfaces.find((s) => s.id === 'room-1.floor')!.areaM2).toBe(20);
    expect(wall(plan, 'n').neighbors!.sort()).toEqual(['room-1.wall-e', 'room-1.wall-w']);
    // Plan starts at the origin, north up.
    const xs = plan.rooms[0]!.polygon.map((p) => p[0]);
    const ys = plan.rooms[0]!.polygon.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 5, 0, 4]);
    expect(plan.warnings.some((w) => w.includes('started facing'))).toBe(true);
  });

  it('places the door and window on the right wall at the right offset and width', () => {
    expect(plan.openings).toHaveLength(2);
    const door = plan.openings.find((o) => o.id === 'door-1')!;
    const win = plan.openings.find((o) => o.id === 'window-1')!;
    expect(door).toMatchObject({ kind: 'door', wallId: 'room-1.wall-e', widthM: 0.9 });
    expect(win).toMatchObject({ kind: 'window', wallId: 'room-1.wall-n', widthM: 1.2 });
    // Door center was at world z = 0 -> plan (5, 1); window center at world x = 1.5 -> plan (3.5, 4).
    const dc = point(plan, door.wallId, along(plan, 'door-1'));
    const wc = point(plan, win.wallId, along(plan, 'window-1'));
    expect(dc[0]).toBeCloseTo(5, 1);
    expect(dc[1]).toBeCloseTo(1, 1);
    expect(wc[0]).toBeCloseTo(3.5, 1);
    expect(wc[1]).toBeCloseTo(4, 1);
  });

  it('turns objects into landmarks and built-ins into fixtures', () => {
    expect(wall(plan, 'w').landmarks).toEqual(['sofa']);
    expect(wall(plan, 'e').landmarks).toEqual(['door', 'sink']);
    expect(wall(plan, 'n').landmarks).toEqual(['window']);
    expect(wall(plan, 's').landmarks).toEqual([]);
    expect(plan.surfaces.find((s) => s.id === 'room-1.floor')!.landmarks).toEqual(['sofa', 'table', 'sink']);
    expect(plan.surfaces.find((s) => s.id === 'room-1.fixture-sink')).toMatchObject({ kind: 'fixture', roomId: 'room-1' });
  });

  it('logs unknown fields instead of failing', () => {
    const logs: string[] = [];
    scanToPlan(fixture(), { unitId: 'u', log: (m) => logs.push(m) });
    expect(logs.some((m) => m.includes('coachingHint'))).toBe(true);
  });

  it('gives the same plan when the scan session started rotated 30° and shifted', () => {
    const p2 = scanToPlan(moveScene(fixture(), 30, [0.2, 0, -0.3]), quiet);
    expect(p2.surfaces.map((s) => [s.id, s.areaM2])).toEqual(plan.surfaces.map((s) => [s.id, s.areaM2]));
    expect(p2.openings.map((o) => [o.id, o.wallId, o.widthM])).toEqual(plan.openings.map((o) => [o.id, o.wallId, o.widthM]));
    for (const [a, b] of p2.rooms[0]!.polygon.map((pt, i) => [pt, plan.rooms[0]!.polygon[i]!] as const)) {
      expect(a[0]).toBeCloseTo(b[0], 1);
      expect(a[1]).toBeCloseTo(b[1], 1);
    }
  });

  it('falls back to the longest wall as north when the scan started outside the room', () => {
    const p = scanToPlan(moveScene(fixture(), 0, [10, 0, 0]), quiet);
    expect(p.warnings.some((w) => w.includes('longest wall'))).toBe(true);
    expect(len(p.surfaces.find((s) => s.id === 'room-1.wall-n')!)).toBeCloseTo(5, 2);
    expect(FloorPlanSchema.safeParse(p).success).toBe(true);
  });

  it('accepts 4x4 nested transforms and string categories', () => {
    const room = fixture();
    for (const w of room.walls as unknown as { transform: unknown; category: unknown }[]) {
      const m = w.transform as number[];
      w.transform = [0, 1, 2, 3].map((i) => m.slice(i * 4, i * 4 + 4)); // 4 columns of 4
      w.category = 'wall';
    }
    const p = scanToPlan(room, quiet);
    expect(p.surfaces.map((s) => s.id)).toEqual(plan.surfaces.map((s) => s.id));
  });

  it('names the room from a section label when there is exactly one', () => {
    const room = fixture();
    room.sections = [{ label: { livingRoom: {} }, center: [0.5, 0, -1], story: 0 }];
    const p = scanToPlan(room, quiet);
    expect(p.rooms[0]).toMatchObject({ id: 'living-room', name: 'Living room' });
    expect(p.surfaces.some((s) => s.id === 'living-room.wall-n')).toBe(true);
  });

  it('rejects scans that cannot make a room', () => {
    const room = fixture();
    room.walls = room.walls.slice(0, 2);
    expect(() => scanToPlan(room, quiet)).toThrow(ScanError);
    expect(() => scanToPlan([], quiet)).toThrow(ScanError);
  });

  it('renders with the existing plan SVG', () => {
    const svg = renderPlanSvg(plan);
    expect(svg).toContain('data-surface-id="room-1.wall-n"');
    expect(svg).toContain('data-opening-id="door-1"');
  });
});

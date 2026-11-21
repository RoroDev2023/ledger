// [Alex] Synthetic plans for testing the viewer on shapes the fixtures don't cover: angled walls, L shapes,
// rotated buildings, tiny and huge rooms, crowded walls. Used by the geometry tests and the web /lab page.
import type { DiffItem, FloorPlan, Opening, Surface, Verdict } from '@ledger/shared';
import type { Vec2 } from './geometry.js';

interface RoomSpec {
  id: string;
  name: string;
  polygon: Vec2[];
}
interface OpeningSpec {
  room: string;
  /** 1-based wall number = polygon edge from vertex n-1 to n. */
  wall: number;
  kind: 'door' | 'window';
  offsetM: number;
  widthM: number;
}

/** Builds a contract-valid FloorPlan from room outlines. Wall ids are `<room>.wall-<n>`. */
export function makePlan(unitId: string, rooms: RoomSpec[], openings: OpeningSpec[] = [], ceilingHeightM = 2.5): FloorPlan {
  const surfaces: Surface[] = [];
  for (const r of rooms) {
    const n = r.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i]!;
      const b = r.polygon[(i + 1) % n]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      surfaces.push({
        id: `${r.id}.wall-${i + 1}`,
        roomId: r.id,
        kind: 'wall',
        label: `${r.name} wall ${i + 1}`,
        segment: [a, b],
        areaM2: Math.round(len * ceilingHeightM * 100) / 100,
        neighbors: [`${r.id}.wall-${((i - 1 + n) % n) + 1}`, `${r.id}.wall-${((i + 1) % n) + 1}`],
      });
    }
    surfaces.push({ id: `${r.id}.floor`, roomId: r.id, kind: 'floor', label: `${r.name} floor` });
  }
  const ops: Opening[] = openings.map((o, i) => ({ id: `${o.kind}-${i + 1}`, kind: o.kind, wallId: `${o.room}.wall-${o.wall}`, offsetM: o.offsetM, widthM: o.widthM }));
  return { unitId, ceilingHeightM, metersPerPixel: 0.01, scaleSource: 'assumed', rooms: rooms.map((r) => ({ ...r })), surfaces, openings: ops, warnings: ['synthetic test plan'] };
}

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const rotate = (poly: Vec2[], deg: number, about: Vec2 = [0, 0]): Vec2[] => {
  const t = (deg * Math.PI) / 180;
  return poly.map(([x, y]) => {
    const dx = x - about[0];
    const dy = y - about[1];
    return [about[0] + dx * Math.cos(t) - dy * Math.sin(t), about[1] + dx * Math.sin(t) + dy * Math.cos(t)];
  });
};

const item = (surfaceId: string, verdict: Verdict, extra: Partial<DiffItem> = {}): DiffItem => ({
  surfaceId,
  verdict,
  reason: verdict === 'new-damage' ? 'New damage: 2 of 2 same-region pairs agree.' : `${verdict} (sample)`,
  confidence: 0.9,
  costUsd: verdict === 'new-damage' ? 64.5 : 0,
  ...extra,
});

export interface Sample {
  id: string;
  title: string;
  /** What this case is checking, shown on the lab page. */
  checks: string;
  plan: FloorPlan;
  items: DiffItem[];
}

export const SAMPLES: Sample[] = [
  {
    id: 'every-verdict',
    title: 'Every verdict',
    checks: 'One pin of each kind, readable colors and labels, charged wall tinted red.',
    plan: makePlan('every-verdict', [{ id: 'room', name: 'Room', polygon: rect(0, 0, 5, 4) }], [{ room: 'room', wall: 1, kind: 'door', offsetM: 0.5, widthM: 0.9 }]),
    items: [
      item('room.wall-3', 'new-damage'),
      item('room.wall-2', 'pre-existing'),
      item('room.wall-4', 'wear'),
      item('room.floor', 'moved'),
      item('room.wall-1', 'not-visible', { reason: 'Not provable: only 1 matching pair.' }),
      item('room.wall-1', 'not-visible', { reason: 'Never seen on camera.' }),
    ],
  },
  {
    id: 'crowded-wall',
    title: 'Six pins on one wall',
    checks: 'Pins on the same wall spread out instead of stacking.',
    plan: makePlan('crowded-wall', [{ id: 'hall', name: 'Hall', polygon: rect(0, 0, 6, 3) }]),
    items: [
      item('hall.wall-3', 'new-damage'),
      item('hall.wall-3', 'new-damage', { costUsd: 12 }),
      item('hall.wall-3', 'pre-existing'),
      item('hall.wall-3', 'wear'),
      item('hall.wall-3', 'pre-existing'),
      item('hall.wall-3', 'not-visible', { reason: 'Not provable: 0 pairs.' }),
    ],
  },
  {
    id: 'l-shape',
    title: 'L-shaped room',
    checks: 'Concave corner: every wall faces into the room, floor fills the L, label inside the L.',
    plan: makePlan(
      'l-shape',
      [
        {
          id: 'living',
          name: 'Living',
          polygon: [
            [0, 0],
            [6, 0],
            [6, 2.5],
            [2.5, 2.5],
            [2.5, 5],
            [0, 5],
          ],
        },
      ],
      [
        { room: 'living', wall: 1, kind: 'window', offsetM: 2, widthM: 1.5 },
        { room: 'living', wall: 4, kind: 'door', offsetM: 1, widthM: 0.9 },
      ],
    ),
    items: [item('living.wall-4', 'new-damage'), item('living.wall-5', 'pre-existing'), item('living.floor', 'moved')],
  },
  {
    id: 'angled',
    title: 'Angled bay wall',
    checks: 'A diagonal wall is placed and rotated correctly, with a window on the diagonal.',
    plan: makePlan(
      'angled',
      [
        {
          id: 'bay',
          name: 'Bay room',
          polygon: [
            [0, 0],
            [4, 0],
            [5.5, 1.5],
            [5.5, 4],
            [0, 4],
          ],
        },
      ],
      [{ room: 'bay', wall: 2, kind: 'window', offsetM: 0.4, widthM: 1.2 }],
    ),
    items: [item('bay.wall-2', 'new-damage'), item('bay.wall-4', 'pre-existing')],
  },
  {
    id: 'rotated',
    title: 'Building rotated 30°',
    checks: 'Nothing assumes walls run north-south or east-west.',
    plan: makePlan(
      'rotated',
      [
        { id: 'a', name: 'Room A', polygon: rotate(rect(0, 0, 4, 3), 30) },
        { id: 'b', name: 'Room B', polygon: rotate(rect(4, 0, 3, 3), 30) },
      ],
      [
        { room: 'a', wall: 2, kind: 'door', offsetM: 1, widthM: 0.9 },
        { room: 'a', wall: 3, kind: 'window', offsetM: 1.2, widthM: 1.4 },
      ],
    ),
    items: [item('a.wall-3', 'new-damage'), item('b.wall-2', 'pre-existing'), item('b.floor', 'moved')],
  },
  {
    id: 'far-from-origin',
    title: 'Coordinates far from 0,0',
    checks: 'Camera frames the unit even when the plan sits at (120 m, 80 m).',
    plan: makePlan('far', [{ id: 'room', name: 'Room', polygon: rect(120, 80, 4, 3) }]),
    items: [item('room.wall-3', 'new-damage')],
  },
  {
    id: 'tiny',
    title: 'Closet 1 × 1.2 m',
    checks: 'A very small room is still readable and pins stay inside.',
    plan: makePlan('tiny', [{ id: 'closet', name: 'Closet', polygon: rect(0, 0, 1, 1.2) }], [{ room: 'closet', wall: 1, kind: 'door', offsetM: 0.1, widthM: 0.8 }]),
    items: [item('closet.wall-3', 'new-damage'), item('closet.floor', 'moved')],
  },
  {
    id: 'loft',
    title: 'Loft 18 × 11 m, 4 m ceiling',
    checks: 'A large unit fits the view; tall ceiling; many windows on one wall.',
    plan: makePlan(
      'loft',
      [{ id: 'loft', name: 'Loft', polygon: rect(0, 0, 18, 11) }],
      [1, 4, 7, 10, 13, 16].map((x) => ({ room: 'loft', wall: 3, kind: 'window' as const, offsetM: x, widthM: 1.2 })),
      4,
    ),
    items: [item('loft.wall-3', 'new-damage'), item('loft.wall-1', 'pre-existing'), item('loft.floor', 'moved')],
  },
  {
    id: 'openings-edge-cases',
    title: 'Doors at wall ends, overlapping openings',
    checks: 'Door at offset 0, door past the wall end, a window overlapping a door: no gaps in the wrong place, no crash.',
    plan: makePlan(
      'openings',
      [{ id: 'room', name: 'Room', polygon: rect(0, 0, 5, 4) }],
      [
        { room: 'room', wall: 1, kind: 'door', offsetM: 0, widthM: 0.9 },
        { room: 'room', wall: 1, kind: 'door', offsetM: 4.5, widthM: 1.5 },
        { room: 'room', wall: 3, kind: 'door', offsetM: 1, widthM: 1 },
        { room: 'room', wall: 3, kind: 'window', offsetM: 1.6, widthM: 1.2 },
      ],
    ),
    items: [item('room.wall-1', 'pre-existing'), item('room.wall-3', 'new-damage')],
  },
  {
    id: 'no-items',
    title: 'Clean move-out, nothing found',
    checks: 'No pins, no tinted walls, still a useful model.',
    plan: makePlan('clean', [
      { id: 'a', name: 'Living', polygon: rect(0, 0, 4, 4) },
      { id: 'b', name: 'Kitchen', polygon: rect(4, 0, 2.5, 4) },
    ]),
    items: [],
  },
  {
    id: 'unknown-surface',
    title: 'Item on a surface the plan does not have',
    checks: 'A pin for an unknown surface id falls back to the unit center instead of crashing.',
    plan: makePlan('unknown', [{ id: 'room', name: 'Room', polygon: rect(0, 0, 4, 3) }]),
    items: [item('kitchen.wall-9', 'new-damage'), item('room.fixture-sink', 'pre-existing')],
  },
];

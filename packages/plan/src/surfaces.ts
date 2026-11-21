// Plain-code geometry: room polygons (meters, y = north) -> wall surfaces with stable IDs.
// Models never produce these numbers; Argon only gives rooms/openings, this code does the rest.
import type { FloorPlan, Opening, Room, Surface } from '@ledger/shared';

type Pt = [number, number];
const EPS = 1e-6;

export function slug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
}

/** Signed area (shoelace). Positive = counter-clockwise. */
export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(poly: Pt[]): Pt {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** Compass side of a wall from its outward normal: n, e, s or w. */
export function compassOf(a: Pt, b: Pt, ccw: boolean): 'n' | 'e' | 's' | 'w' {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // Outward normal of an edge: right of travel for CCW polygons, left for CW.
  const [nx, ny] = ccw ? [dy, -dx] : [-dy, dx];
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? 'e' : 'w';
  return ny > 0 ? 'n' : 's';
}

/**
 * One wall surface per polygon edge, plus a floor per room.
 * IDs: `<room-slug>.wall-<n|e|s|w>`; repeated sides get `-2`, `-3`.
 * Area = length x ceiling height (openings are subtracted by attachOpenings).
 */
export function wallsFromRooms(rooms: Room[], ceilingHeightM: number): Surface[] {
  const out: Surface[] = [];
  for (const room of rooms) {
    const poly = room.polygon as Pt[];
    const ccw = polygonArea(poly) > 0;
    const seen = new Map<string, number>();
    const roomWalls: Surface[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < EPS) continue;
      const side = compassOf(a, b, ccw);
      const k = (seen.get(side) ?? 0) + 1;
      seen.set(side, k);
      const id = `${room.id}.wall-${side}${k > 1 ? `-${k}` : ''}`;
      roomWalls.push({
        id,
        roomId: room.id,
        kind: 'wall',
        label: `${room.name} ${({ n: 'north', e: 'east', s: 'south', w: 'west' } as const)[side]} wall${k > 1 ? ` ${k}` : ''}`,
        segment: [a, b],
        areaM2: round2(len * ceilingHeightM),
        neighbors: [],
        landmarks: [],
      });
    }
    // Walls that share a corner inside the same room are neighbors.
    for (let i = 0; i < roomWalls.length; i++) {
      const prev = roomWalls[(i - 1 + roomWalls.length) % roomWalls.length]!;
      const next = roomWalls[(i + 1) % roomWalls.length]!;
      roomWalls[i]!.neighbors = [...new Set([prev.id, next.id])].filter((id) => id !== roomWalls[i]!.id);
    }
    out.push(...roomWalls);
    out.push({
      id: `${room.id}.floor`,
      roomId: room.id,
      kind: 'floor',
      label: `${room.name} floor`,
      areaM2: round2(Math.abs(polygonArea(poly))),
    });
  }
  return out;
}

function distToSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

/**
 * Attach each opening (given by its center point in meters) to the nearest wall,
 * set offset along the wall, subtract its area from the wall, and add it as a landmark.
 * Door/window heights are fixed assumptions: door 2.0 m, window 1.2 m.
 */
export function attachOpenings(
  surfaces: Surface[],
  openings: { id: string; kind: 'door' | 'window'; center: Pt; widthM: number }[],
  roomFilter?: (s: Surface) => boolean,
): { surfaces: Surface[]; openings: Opening[]; warnings: string[] } {
  const walls = surfaces.filter((s) => s.kind === 'wall' && s.segment && (!roomFilter || roomFilter(s)));
  const result: Opening[] = [];
  const warnings: string[] = [];
  for (const o of openings) {
    let best: { wall: Surface; d: number; t: number } | undefined;
    for (const w of walls) {
      const [a, b] = w.segment!;
      const { d, t } = distToSegment(o.center, a, b);
      if (!best || d < best.d) best = { wall: w, d, t };
    }
    if (!best) {
      warnings.push(`opening ${o.id} has no wall to attach to`);
      continue;
    }
    if (best.d > 0.3) warnings.push(`opening ${o.id} is ${best.d.toFixed(2)} m from the nearest wall ${best.wall.id}`);
    const [a, b] = best.wall.segment!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const offsetM = round2(Math.max(0, best.t * len - o.widthM / 2));
    result.push({ id: o.id, kind: o.kind, wallId: best.wall.id, offsetM, widthM: o.widthM });
    const h = o.kind === 'door' ? 2.0 : 1.2;
    best.wall.areaM2 = round2(Math.max(0, (best.wall.areaM2 ?? 0) - o.widthM * h));
    best.wall.landmarks = [...(best.wall.landmarks ?? []), o.kind];
  }
  return { surfaces, openings: result, warnings };
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Build a full FloorPlan from rooms + openings (meters). Used by fixtures and by parsePlan. */
export function buildPlan(input: {
  unitId: string;
  ceilingHeightM: number;
  metersPerPixel: number;
  scaleSource: FloorPlan['scaleSource'];
  rooms: { name: string; polygon: Pt[] }[];
  openings?: { id: string; kind: 'door' | 'window'; center: Pt; widthM: number }[];
  fixtures?: { roomName: string; name: string }[];
  warnings?: string[];
}): FloorPlan {
  const used = new Map<string, number>();
  const rooms: Room[] = input.rooms.map((r) => {
    const base = slug(r.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { id: n > 1 ? `${base}-${n}` : base, name: r.name, polygon: r.polygon };
  });
  let surfaces = wallsFromRooms(rooms, input.ceilingHeightM);
  const att = attachOpenings(surfaces, input.openings ?? []);
  surfaces = att.surfaces;
  for (const f of input.fixtures ?? []) {
    const room = rooms.find((r) => r.name === f.roomName);
    if (!room) continue;
    surfaces.push({ id: `${room.id}.fixture-${slug(f.name)}`, roomId: room.id, kind: 'fixture', label: `${room.name} ${f.name}` });
  }
  return {
    unitId: input.unitId,
    ceilingHeightM: input.ceilingHeightM,
    metersPerPixel: input.metersPerPixel,
    scaleSource: input.scaleSource,
    rooms,
    surfaces,
    openings: att.openings,
    warnings: [...(input.warnings ?? []), ...att.warnings],
  };
}

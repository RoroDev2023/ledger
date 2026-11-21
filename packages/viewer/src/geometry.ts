// [Alex] Plan (meters) -> 3D boxes, floors and pin anchors. Pure functions, no three.js, so they are unit-tested.
//
// Axes: plan x = east, plan y = north. In 3D, y is up, so plan (x, y) maps to 3D (x, 0, -y): north points away
// from a camera that looks down -z. Walls are drawn per room surface, so a wall shared by two rooms becomes two
// thin slabs, each pushed into its own room by half a thickness. They never overlap (no z-fighting), and clicking
// either side selects that room's surface ID.
import type { FloorPlan, Opening, Room, Surface } from '@ledger/shared';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const WALL_THICKNESS = 0.08;
export const DOOR_HEIGHT = 2.05;
export const WINDOW_SILL = 0.9;
export const WINDOW_TOP = 2.1;
/** Height of a lowered wall (cut-away and top-down views): a stub with door gaps only. */
export const STUB_HEIGHT = 0.3;

/** One solid box of a wall (walls are split around doors and windows). */
export interface WallPiece {
  surfaceId: string;
  /** 3D center of the box. */
  position: Vec3;
  /** [length along the wall, height, thickness]. */
  size: Vec3;
  /** Rotation around the vertical axis, radians. */
  rotationY: number;
}

export interface WallGeometry {
  surfaceId: string;
  roomId: string;
  label: string;
  pieces: WallPiece[];
  /** The same wall lowered to STUB_HEIGHT, with only door gaps (windows sit above a stub). */
  stub: WallPiece[];
  /** Wall length in meters. */
  length: number;
  /** 3D point on the room-facing side of the wall, mid-length and mid-height. */
  center: Vec3;
  /** Unit vector (x, z) pointing from the wall into its room. Used to fade walls between camera and room. */
  inward: Vec2;
}

export const to3 = ([x, y]: Vec2, height = 0): Vec3 => [x, height, -y];

export function centroid(poly: Vec2[]): Vec2 {
  // Area-weighted centroid; falls back to the vertex mean for degenerate polygons.
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Even-odd ray casting. */
export function pointInPolygon([x, y]: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Gaps cut into a wall: [start, end] along the wall (meters from segment start) and [bottom, top] heights. */
export function openingGaps(wallLength: number, ceiling: number, openings: Opening[]): { from: number; to: number; bottom: number; top: number }[] {
  return openings
    .map((o) => {
      const from = Math.max(0, Math.min(wallLength, o.offsetM));
      const to = Math.max(from, Math.min(wallLength, o.offsetM + o.widthM));
      const top = o.kind === 'door' ? Math.min(DOOR_HEIGHT, ceiling - 0.05) : Math.min(WINDOW_TOP, ceiling - 0.05);
      const bottom = o.kind === 'door' ? 0 : Math.min(WINDOW_SILL, top);
      return { from, to, bottom, top };
    })
    .filter((g) => g.to - g.from > 1e-6)
    .sort((a, b) => a.from - b.from);
}

/** Splits one wall into solid boxes around its doors and windows. */
export function wallGeometry(surface: Surface, room: Room, ceiling: number, openings: Opening[]): WallGeometry | null {
  if (!surface.segment) return null;
  const [a, b] = surface.segment;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const dir: Vec2 = [dx / length, dy / length];

  // Inward normal. Probe a few cm to the left of the wall: if that point is inside the room, left is inward.
  // (Pointing at the room's centroid is wrong for some walls of L-shaped and other concave rooms.)
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let n: Vec2 = [-dir[1], dir[0]];
  const probe: Vec2 = [mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05];
  const inside = pointInPolygon(probe, room.polygon);
  const outside = pointInPolygon([mid[0] - n[0] * 0.05, mid[1] - n[1] * 0.05], room.polygon);
  if (outside && !inside) n = [-n[0], -n[1]];
  else if (inside === outside) {
    // Wall not on the room outline (bad data): fall back to the centroid direction.
    const c = centroid(room.polygon);
    if ((c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
  }
  const shift = WALL_THICKNESS / 2;

  const rotationY = Math.atan2(dy, dx);
  const pieces: WallPiece[] = [];
  const box = (from: number, to: number, bottom: number, top: number) => {
    if (to - from < 1e-3 || top - bottom < 1e-3) return;
    const along = (from + to) / 2;
    const p: Vec2 = [a[0] + dir[0] * along + n[0] * shift, a[1] + dir[1] * along + n[1] * shift];
    pieces.push({ surfaceId: surface.id, position: to3(p, (bottom + top) / 2), size: [to - from, top - bottom, WALL_THICKNESS], rotationY });
  };

  const gaps = openingGaps(length, ceiling, openings);
  let cursor = 0;
  for (const g of gaps) {
    box(cursor, Math.max(cursor, g.from), 0, ceiling); // solid wall before the gap
    const from = Math.max(cursor, g.from);
    box(from, g.to, 0, g.bottom); // below a window
    box(from, g.to, g.top, ceiling); // above a door or window
    cursor = Math.max(cursor, g.to);
  }
  box(cursor, length, 0, ceiling);

  const full = pieces.splice(0, pieces.length);
  cursor = 0;
  for (const g of gaps.filter((x) => x.bottom === 0)) {
    box(cursor, Math.max(cursor, g.from), 0, STUB_HEIGHT);
    cursor = Math.max(cursor, g.to);
  }
  box(cursor, length, 0, STUB_HEIGHT);
  const stub = pieces.splice(0, pieces.length);
  pieces.push(...full);

  const face: Vec2 = [mid[0] + n[0] * WALL_THICKNESS, mid[1] + n[1] * WALL_THICKNESS];
  return { surfaceId: surface.id, roomId: surface.roomId, label: surface.label, pieces, stub, length, center: to3(face, ceiling / 2), inward: [n[0], -n[1]] };
}

export interface PlanGeometry {
  walls: WallGeometry[];
  floors: { surfaceId: string; roomId: string; label: string; polygon: Vec2[]; center: Vec3 }[];
  /** Axis-aligned bounds in plan meters, for framing the camera. */
  bounds: { min: Vec2; max: Vec2; center: Vec3; size: number };
  ceiling: number;
}

/**
 * Openings that cut a given wall, with offsets along THAT wall. A door between two rooms is attached to only
 * one room's wall in the plan, but the wall between them is drawn as two slabs (one per room); the door has to
 * cut both, or one side shows a solid wall. So every opening is placed in plan space once, then projected onto
 * every wall that lies on the same line (within 20 cm) and covers it.
 */
export function openingsForWall(wall: Surface, plan: FloorPlan): Opening[] {
  if (!wall.segment) return [];
  const [a, b] = wall.segment;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const hosts = new Map(plan.surfaces.map((x) => [x.id, x]));
  const out: Opening[] = [];
  for (const o of plan.openings) {
    const host = hosts.get(o.wallId);
    if (!host?.segment) continue;
    if (o.wallId === wall.id) {
      out.push(o);
      continue;
    }
    const [ha, hb] = host.segment;
    const hl = Math.hypot(hb[0] - ha[0], hb[1] - ha[1]);
    if (hl < 1e-6) continue;
    const hd: Vec2 = [(hb[0] - ha[0]) / hl, (hb[1] - ha[1]) / hl];
    const ends: Vec2[] = [o.offsetM, o.offsetM + o.widthM].map((t) => [ha[0] + hd[0] * t, ha[1] + hd[1] * t]);
    const proj = ends.map(([x, y]) => {
      const along = (x - a[0]) * dir[0] + (y - a[1]) * dir[1];
      const across = Math.abs((x - a[0]) * -dir[1] + (y - a[1]) * dir[0]);
      return { along, across };
    });
    if (proj.some((p) => p.across > 0.2 || p.along < -0.05 || p.along > len + 0.05)) continue;
    const from = Math.min(proj[0]!.along, proj[1]!.along);
    out.push({ ...o, wallId: wall.id, offsetM: Math.max(0, from), widthM: Math.abs(proj[1]!.along - proj[0]!.along) });
  }
  return out;
}

export function planGeometry(plan: FloorPlan): PlanGeometry {
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  const walls: WallGeometry[] = [];
  for (const s of plan.surfaces) {
    if (s.kind !== 'wall') continue;
    const room = rooms.get(s.roomId);
    if (!room) continue;
    const g = wallGeometry(s, room, plan.ceilingHeightM, openingsForWall(s, plan));
    if (g) walls.push(g);
  }
  const floors = plan.surfaces
    .filter((s) => s.kind === 'floor')
    .flatMap((s) => {
      const room = rooms.get(s.roomId);
      return room ? [{ surfaceId: s.id, roomId: room.id, label: s.label, polygon: room.polygon, center: to3(centroid(room.polygon), 0.02) }] : [];
    });

  const pts = plan.rooms.flatMap((r) => r.polygon);
  const min: Vec2 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  const max: Vec2 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const mid: Vec2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return {
    walls,
    floors,
    // size never goes below 3.5 m so the camera stays outside even a closet.
    bounds: { min, max, center: to3(mid, 0), size: Math.max(max[0] - min[0], max[1] - min[1], 3.5) },
    ceiling: plan.ceilingHeightM,
  };
}

/**
 * Where to draw the pins for one surface. Several items on the same surface are spread out along the wall
 * (or around the room center for floors) so they never sit on top of each other.
 */
export function pinAnchors(geo: PlanGeometry, surfaceId: string, count: number): Vec3[] {
  const wall = geo.walls.find((w) => w.surfaceId === surfaceId);
  if (wall) {
    const [cx, cy, cz] = wall.center;
    const along: Vec2 = [-wall.inward[1], wall.inward[0]]; // perpendicular to inward, in the (x, z) plane
    // Spread over up to 70% of the wall, 35 cm to 1 m apart; neighbors alternate height so labels don't collide.
    const gap = count > 1 ? Math.min(1, Math.max(0.35, (wall.length * 0.7) / (count - 1))) : 0;
    return Array.from({ length: count }, (_, i) => {
      const k = (i - (count - 1) / 2) * gap;
      const lift = count > 1 ? (i % 2 === 0 ? 0.25 : -0.2) : 0.2;
      return [cx + along[0] * k + wall.inward[0] * 0.12, cy + lift, cz + along[1] * k + wall.inward[1] * 0.12];
    });
  }
  const floor = geo.floors.find((f) => f.surfaceId === surfaceId) ?? geo.floors.find((f) => surfaceId.startsWith(`${f.roomId}.`));
  const [fx, , fz] = floor?.center ?? geo.bounds.center;
  return Array.from({ length: count }, (_, i) => {
    const ang = (i / Math.max(count, 1)) * Math.PI * 2;
    const r = count > 1 ? 0.35 : 0;
    return [fx + Math.cos(ang) * r, 0.35, fz + Math.sin(ang) * r];
  });
}

/** True when the camera is on the outside of a wall, so the wall would block the view into its room. */
export function blocksView(wall: WallGeometry, camera: Vec3): boolean {
  const dx = camera[0] - wall.center[0];
  const dz = camera[2] - wall.center[2];
  return dx * wall.inward[0] + dz * wall.inward[1] < 0;
}

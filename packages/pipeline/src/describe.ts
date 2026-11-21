// [Rahim] R3: plan -> text for Decisions options and Carbon prompts. Generated from the plan, never hand-written.
//   "north wall of the Living room: 3.0 m wide, window at the center, between the east and west walls"

import type { FloorPlan, Opening, Room, Surface } from '@ledger/shared';

type Pt = [number, number];

const COMPASS: Record<string, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };
/** An opening belongs to every wall its center lies on (catches the other side of a shared wall). */
const ON_WALL_M = 0.05;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const fmt = (x: number) => x.toFixed(1);

export function wallLengthM(s: Surface): number | undefined {
  return s.segment ? len(sub(s.segment[1], s.segment[0])) : undefined;
}

function centroid(room: Room): Pt {
  const n = room.polygon.length || 1;
  const sx = room.polygon.reduce((a, p) => a + p[0], 0);
  const sy = room.polygon.reduce((a, p) => a + p[1], 0);
  return [sx / n, sy / n];
}

function openingCenter(plan: FloorPlan, o: Opening): Pt | undefined {
  const w = plan.surfaces.find((s) => s.id === o.wallId);
  if (!w?.segment) return undefined;
  const [a, b] = w.segment;
  const d = sub(b, a);
  const L = len(d) || 1;
  const t = o.offsetM + o.widthM / 2;
  return [a[0] + (d[0] / L) * t, a[1] + (d[1] / L) * t];
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a);
  const L2 = dot(d, d);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
  return len(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t]));
}

export interface WallOpening {
  opening: Opening;
  /** As seen from the room's center, facing the wall. */
  position: 'left end' | 'center' | 'right end';
}

/** Openings on a wall, including ones recorded on the coincident wall of the neighboring room. */
export function openingsOnWall(plan: FloorPlan, s: Surface): WallOpening[] {
  if (!s.segment) return [];
  const room = plan.rooms.find((r) => r.id === s.roomId);
  const [a, b] = s.segment;
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const half = len(sub(b, a)) / 2 || 1;
  const c = room ? centroid(room) : mid;
  const f = sub(mid, c);
  const right: Pt = len(f) ? [f[1] / len(f), -f[0] / len(f)] : [1, 0];
  const out: WallOpening[] = [];
  for (const o of plan.openings) {
    const p = openingCenter(plan, o);
    if (!p || distToSegment(p, a, b) > ON_WALL_M) continue;
    const t = dot(sub(p, mid), right) / half;
    out.push({ opening: o, position: t < -1 / 3 ? 'left end' : t > 1 / 3 ? 'right end' : 'center' });
  }
  return out.sort((x, y) => x.opening.id.localeCompare(y.opening.id));
}

function shortName(s: Surface, plan: FloorPlan): string {
  const room = plan.rooms.find((r) => r.id === s.roomId)?.name ?? s.roomId;
  const m = /\.wall-([nesw])$/.exec(s.id);
  if (s.kind === 'wall' && m) return `${COMPASS[m[1]!]} wall of the ${room}`;
  if (s.kind === 'floor') return `floor of the ${room}`;
  if (s.kind === 'ceiling') return `ceiling of the ${room}`;
  return `${s.label} (${room})`;
}

/** Landmark words for a surface: Surface.landmarks plus the kinds of openings found on it. */
export function surfaceFeatures(plan: FloorPlan, s: Surface): string[] {
  const kinds = openingsOnWall(plan, s).map((w) => w.opening.kind);
  return [...new Set([...(s.landmarks ?? []), ...kinds].map((x) => x.toLowerCase()))];
}

/** One line describing a surface, used as a choice option, in visibility questions and for Carbon. */
export function describeSurface(plan: FloorPlan, s: Surface): string {
  const parts: string[] = [];
  const L = wallLengthM(s);
  if (s.kind === 'wall' && L !== undefined) parts.push(`${fmt(L)} m wide`);
  else if (s.areaM2 !== undefined) parts.push(`${fmt(s.areaM2)} m²`);

  const ops = openingsOnWall(plan, s);
  for (const w of ops) parts.push(`${w.opening.kind} at ${w.position === 'center' ? 'the center' : `its ${w.position}`}`);
  const opKinds = new Set(ops.map((w) => w.opening.kind as string));
  const fixtures = (s.landmarks ?? []).filter((x) => !opKinds.has(x.toLowerCase()));
  if (fixtures.length) parts.push(`has ${fixtures.join(', ')}`);
  if (s.kind === 'wall' && !ops.length && !fixtures.length) parts.push('plain, no door or window');

  if (s.kind === 'wall') {
    const ns = (s.neighbors ?? [])
      .map((id) => /\.wall-([nesw])$/.exec(id)?.[1])
      .filter((x): x is string => !!x)
      .map((c) => COMPASS[c]!);
    if (ns.length === 2) parts.push(`between the ${ns[0]} and ${ns[1]} walls`);
  }
  return `${shortName(s, plan)}: ${parts.join(', ')}`;
}

export function roomSurfaces(plan: FloorPlan, roomId: string): Surface[] {
  return plan.surfaces.filter((s) => s.roomId === roomId);
}

/** One line per room for the room choice. */
export function describeRoom(plan: FloorPlan, room: Room): string {
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const fixtures = new Set<string>();
  for (const s of roomSurfaces(plan, room.id)) {
    for (const o of openingsOnWall(plan, s)) {
      if (seen.has(o.opening.id)) continue;
      seen.add(o.opening.id);
      counts.set(o.opening.kind, (counts.get(o.opening.kind) ?? 0) + 1);
    }
    for (const l of s.landmarks ?? []) if (l !== 'door' && l !== 'window') fixtures.add(l);
    if (s.kind === 'fixture') fixtures.add(s.label);
  }
  const parts = [`about ${fmt(w)} × ${fmt(d)} m`];
  for (const k of ['window', 'door']) {
    const n = counts.get(k) ?? 0;
    if (n) parts.push(`${n} ${k}${n > 1 ? 's' : ''}`);
  }
  if (fixtures.size) parts.push(`has ${[...fixtures].join(', ')}`);
  return `${room.name}: ${parts.join(', ')}`;
}

/** Text fallback for Carbon when there is no plan.svg: the room and each of its surfaces. */
export function describeRoomInDetail(plan: FloorPlan, roomId: string): string {
  const room = plan.rooms.find((r) => r.id === roomId);
  const lines = room ? [describeRoom(plan, room)] : [`Room ${roomId}`];
  for (const s of roomSurfaces(plan, roomId)) lines.push(`- ${s.id}: ${describeSurface(plan, s)}`);
  return lines.join('\n');
}

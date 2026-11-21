// scanToPlan: Apple RoomPlan `CapturedRoom` JSON (LiDAR, real meters) -> validated FloorPlan.
// No model is involved: the scan already holds measured geometry, so this is plain code end to end.
//
// Encoded shape (CapturedRoom is Codable; property list checked against Apple's RoomPlan docs, 2026-11-21):
//   { identifier, story, version, walls, doors, windows, openings, floors, objects, sections }
//   Surface: { identifier, parentIdentifier?, category, confidence, transform, dimensions, story,
//              completedEdges, curve?, polygonCorners }
//   Object:  { identifier, parentIdentifier?, category, confidence, transform, dimensions, story, attributes }
// Swift enums with payloads encode as single-key objects: {"wall":{}}, {"door":{"isOpen":true}}, {"high":{}}.
// simd_float4x4 encodes as 16 floats, column-major (translation in [12..14]); simd_float3 as [x, y, z].
// The docs do not name the axes; ARKit world space is y-up, and a surface's local x runs along it
// (dimensions = [width, height, depth]). Anything we do not recognise is logged, never fatal.
import { z } from 'zod';
import { FloorPlanSchema, type FloorPlan } from '@ledger/shared';
import { buildPlan, centroid, cleanName, polygonArea, round2 } from './surfaces.js';

type Pt = [number, number];

export class ScanError extends Error {}

// ---------------------------------------------------------------------------------------------
// Tolerant input schema

const num = z.number().finite();
const vec3 = z.array(num).min(3);
/** Flat 16 (column-major), or 4 columns of 4. Normalised to flat column-major. */
const mat4 = z.union([
  z.array(num).length(16),
  z.array(z.array(num).length(4)).length(4).transform((cols) => cols.flat()),
]);
/** `{"door":{"isOpen":true}}`, `{"wall":{}}` or a bare string. Returns the case name. */
const enumCase = z.union([z.string(), z.record(z.string(), z.unknown())]).transform((v) => (typeof v === 'string' ? v : Object.keys(v)[0] ?? 'unknown'));

const ScanSurfaceSchema = z
  .object({
    identifier: z.string().optional(),
    parentIdentifier: z.string().nullable().optional(),
    category: enumCase.optional(),
    confidence: enumCase.optional(),
    dimensions: vec3,
    transform: mat4,
    curve: z.unknown().optional(),
  })
  .passthrough();
type ScanSurface = z.infer<typeof ScanSurfaceSchema>;

const ScanSectionSchema = z.object({ label: enumCase.optional() }).passthrough();

const KNOWN_TOP = new Set(['identifier', 'story', 'version', 'walls', 'doors', 'windows', 'openings', 'floors', 'objects', 'sections']);
const KNOWN_ITEM = new Set([
  'identifier', 'parentIdentifier', 'category', 'confidence', 'transform', 'dimensions', 'story',
  'completedEdges', 'curve', 'polygonCorners', 'attributes', 'edges',
]);

/** Object categories that are part of the unit (can be damaged or go missing) rather than tenant furniture. */
const BUILT_IN = new Set(['bathtub', 'dishwasher', 'fireplace', 'oven', 'refrigerator', 'sink', 'stairs', 'stove', 'toilet', 'washerDryer']);

/** "washerDryer" -> "washer/dryer", "livingRoom" -> "living room". */
function words(name: string): string {
  if (name === 'washerDryer') return 'washer/dryer';
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** World (x, y-up, z) -> plan (X = x, Y = -z). Looking down from +y, -z (the camera's start heading) is up. */
const toPlan = (m: number[]): Pt => [m[12]!, -m[14]!];
/** The surface's local x axis projected to the plan, normalised. */
function axisX(m: number[]): Pt {
  const [x, y] = [m[0]!, -m[2]!];
  const l = Math.hypot(x, y);
  return l < 1e-9 ? [1, 0] : [x / l, y / l];
}

interface Seg { a: Pt; b: Pt; mid: Pt; len: number; height: number; src: ScanSurface }

function lineIntersect(p: Pt, r: Pt, q: Pt, s: Pt): Pt | null {
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  return [p[0] + t * r[0], p[1] + t * r[1]];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance along a ray (origin o, unit dir d) to segment a-b, or null when it misses. */
function rayHit(o: Pt, d: Pt, a: Pt, b: Pt): number | null {
  const s: Pt = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * s[1] - d[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - o[0]) * s[1] - (a[1] - o[1]) * s[0]) / den;
  const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
  return t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}

function projectOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return [a[0] + t * dx, a[1] + t * dy];
}

// ---------------------------------------------------------------------------------------------

export interface ScanToPlanOptions {
  unitId: string;
  /** Room name when the scan has no section label. Default "Room 1" -> ids like `room-1.wall-n`. */
  roomName?: string;
  /** Where notes about unknown or skipped input go. Default console.warn. */
  log?: (msg: string) => void;
}

/**
 * One RoomPlan CapturedRoom (a single room) -> FloorPlan in meters, north up.
 * Walls become the room polygon (ordered by angle around their centroid, corners where neighbouring wall
 * lines meet); doors, windows and openings attach to their parent wall (else the nearest); objects become
 * landmarks on the nearest wall and the floor, and built-ins (sink, stove, toilet...) also become fixtures.
 */
export function scanToPlan(capturedRoom: unknown, opts: ScanToPlanOptions): FloorPlan {
  const log = opts.log ?? ((m: string) => console.warn(`[scanToPlan] ${m}`));
  if (!capturedRoom || typeof capturedRoom !== 'object' || Array.isArray(capturedRoom)) throw new ScanError('scan must be a CapturedRoom JSON object');
  const root = capturedRoom as Record<string, unknown>;
  const warnings: string[] = [];

  const unknownTop = Object.keys(root).filter((k) => !KNOWN_TOP.has(k));
  if (unknownTop.length) log(`ignoring unknown CapturedRoom fields: ${unknownTop.join(', ')}`);

  const list = (key: string): ScanSurface[] => {
    const raw = root[key];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      log(`${key} is not an array; ignored`);
      return [];
    }
    const out: ScanSurface[] = [];
    const unknown = new Set<string>();
    raw.forEach((item, i) => {
      const r = ScanSurfaceSchema.safeParse(item);
      if (!r.success) {
        log(`${key}[${i}] skipped: ${r.error.issues.map((x) => `${x.path.join('.') || '(item)'} ${x.message}`).join('; ')}`);
        return;
      }
      for (const k of Object.keys(r.data)) if (!KNOWN_ITEM.has(k)) unknown.add(k);
      out.push(r.data);
    });
    if (unknown.size) log(`ignoring unknown fields in ${key}: ${[...unknown].join(', ')}`);
    return out;
  };

  // ---- walls -> segments in plan space
  const walls: Seg[] = list('walls').map((w) => {
    const c = toPlan(w.transform);
    const u = axisX(w.transform);
    const len = w.dimensions[0]!;
    const a: Pt = [c[0] - (u[0] * len) / 2, c[1] - (u[1] * len) / 2];
    const b: Pt = [c[0] + (u[0] * len) / 2, c[1] + (u[1] * len) / 2];
    return { a, b, mid: c, len, height: w.dimensions[1]!, src: w };
  }).filter((s) => {
    if (s.len < 0.05) log(`wall ${s.src.identifier ?? '?'} is ${s.len} m long; skipped`);
    return s.len >= 0.05;
  });
  if (walls.length < 3) throw new ScanError(`scan has ${walls.length} usable wall(s); a room needs at least 3`);
  if (walls.some((w) => w.src.curve)) warnings.push('scan has curved walls; each is drawn as a straight wall between its ends');
  const lowConf = walls.filter((w) => w.src.confidence === 'low').length;
  if (lowConf) warnings.push(`${lowConf} wall(s) were scanned with low confidence; check their sizes`);

  const storyCount = new Set(['walls', 'floors'].flatMap((k) => (Array.isArray(root[k]) ? (root[k] as { story?: unknown }[]).map((x) => x?.story) : [])).filter((s) => s !== undefined)).size;
  if (storyCount > 1) warnings.push('scan spans more than one story; all walls were treated as one room');

  // ---- room polygon: walls ordered by angle around their centroid; corner i joins wall i and wall i+1
  const cMid = centroid(walls.map((w) => w.mid));
  walls.sort((p, q) => Math.atan2(p.mid[1] - cMid[1], p.mid[0] - cMid[0]) - Math.atan2(q.mid[1] - cMid[1], q.mid[0] - cMid[0]));
  const n = walls.length;
  let gap = 0;
  const corners: Pt[] = walls.map((w, i) => {
    const v = walls[(i + 1) % n]!;
    // Endpoints of w and v that are closest to each other: the corner they share.
    const pairs: [Pt, Pt][] = [[w.a, v.a], [w.a, v.b], [w.b, v.a], [w.b, v.b]];
    const [pw, pv] = pairs.sort((x, y) => dist(...x) - dist(...y))[0]!;
    gap = Math.max(gap, dist(pw, pv));
    const near: Pt = [(pw[0] + pv[0]) / 2, (pw[1] + pv[1]) / 2];
    const x = lineIntersect(w.a, [w.b[0] - w.a[0], w.b[1] - w.a[1]], v.a, [v.b[0] - v.a[0], v.b[1] - v.a[1]]);
    // Trust the intersection only when it is close to where the two walls actually end (no runaway corners).
    return x && dist(x, pw) <= 0.5 && dist(x, pv) <= 0.5 ? x : near;
  });
  // Edge k (polygon[k] -> polygon[k+1]) is wall k.
  let poly: Pt[] = walls.map((_, k) => corners[(k - 1 + n) % n]!);
  if (Math.abs(polygonArea(poly)) < 0.5) throw new ScanError('scan walls do not enclose a room (area under 0.5 m²)');
  if (gap > 0.3) warnings.push(`scan walls leave a gap of up to ${gap.toFixed(2)} m; corners were closed by joining the nearest wall ends`);

  // ---- compass: north = the wall the scan started facing (world -z = plan +Y from the session origin), else the longest
  const ccw = polygonArea(poly) > 0;
  const outward = (k: number): Pt => {
    const a = poly[k]!;
    const b = poly[(k + 1) % n]!;
    const L = dist(a, b) || 1;
    const [dx, dy] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    return ccw ? [dy, -dx] : [-dy, dx];
  };
  let northIdx = -1;
  const origin: Pt = [0, 0];
  if (pointInPolygon(origin, poly)) {
    let best = Infinity;
    poly.forEach((a, k) => {
      const t = rayHit(origin, [0, 1], a, poly[(k + 1) % n]!);
      if (t !== null && t < best) [best, northIdx] = [t, k];
    });
  }
  if (northIdx >= 0) {
    warnings.push(`north is the wall the scan started facing (${dist(poly[northIdx]!, poly[(northIdx + 1) % n]!).toFixed(2)} m long); owner should confirm`);
  } else {
    northIdx = poly.reduce((bi, a, k) => (dist(a, poly[(k + 1) % n]!) > dist(poly[bi]!, poly[(bi + 1) % n]!) ? k : bi), 0);
    warnings.push(`scan start is outside the room, so north is the longest wall (${dist(poly[northIdx]!, poly[(northIdx + 1) % n]!).toFixed(2)} m); owner should confirm`);
  }
  // Start the polygon (and the wall list) at the north wall, so the output does not depend on where the scan began.
  const [nx, ny] = outward(northIdx);
  poly = [...poly.slice(northIdx), ...poly.slice(0, northIdx)];
  walls.push(...walls.splice(0, northIdx));
  // Rotate so that wall's outward normal points exactly +Y, then shift the plan to start at (0, 0).
  const theta = Math.PI / 2 - Math.atan2(ny, nx);
  const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
  const rot = ([x, y]: Pt): Pt => [x * cos - y * sin, x * sin + y * cos];
  const rotated = poly.map(rot);
  const minX = Math.min(...rotated.map((p) => p[0]));
  const minY = Math.min(...rotated.map((p) => p[1]));
  const place = (p: Pt): Pt => {
    const [x, y] = rot(p);
    return [x - minX, y - minY];
  };
  poly = rotated.map(([x, y]) => [round2(x - minX), round2(y - minY)] as Pt);

  // ---- openings: snap onto the parent wall (else nearest edge) so buildPlan attaches them to that wall
  const wallIndexById = new Map(walls.map((w, k) => [w.src.identifier, k] as const).filter(([id]) => id));
  const counters = new Map<string, number>();
  const openings = (['doors', 'windows', 'openings'] as const).flatMap((key) =>
    list(key).map((o) => {
      // A RoomPlan "opening" is a doorless passage: our contract has door|window, so it is a door-width gap.
      const kind: 'door' | 'window' = key === 'windows' ? 'window' : 'door';
      const label = key === 'doors' ? 'door' : key === 'windows' ? 'window' : 'opening';
      const i = (counters.get(label) ?? 0) + 1;
      counters.set(label, i);
      const c = place(toPlan(o.transform));
      const parent = o.parentIdentifier ? wallIndexById.get(o.parentIdentifier) : undefined;
      if (o.parentIdentifier && parent === undefined) log(`${label}-${i}: parent wall ${o.parentIdentifier} not found; using the nearest wall`);
      const k = parent ?? nearestEdge(c, poly);
      const center = projectOnSegment(c, poly[k]!, poly[(k + 1) % n]!);
      return { id: `${label}-${i}`, kind, center, widthM: Math.max(0.3, round2(o.dimensions[0]!)) };
    }),
  );

  // ---- room name from the scan's section label (iOS 17+), else the default
  const sections = Array.isArray(root.sections) ? root.sections.map((s) => ScanSectionSchema.safeParse(s)).filter((r) => r.success).map((r) => r.data) : [];
  const labelled = sections.map((s) => s.label).filter((l): l is string => !!l && l !== 'unidentified');
  if (sections.length > 1) warnings.push(`scan has ${sections.length} sections; only one room is built from it`);
  const roomName = labelled.length === 1 ? cleanName(words(labelled[0]!).replace(/^./, (c) => c.toUpperCase())) : opts.roomName ?? 'Room 1';

  // ---- objects: built-ins become fixtures (named once each: "Sink", "Sink 2")
  const objects = list('objects').map((o) => ({ category: o.category ?? 'unknown', center: place(toPlan(o.transform)), depth: o.dimensions[2] ?? 0 }));
  const fixtureCount = new Map<string, number>();
  const fixtures = objects
    .filter((o) => BUILT_IN.has(o.category))
    .map((o) => {
      const k = (fixtureCount.get(o.category) ?? 0) + 1;
      fixtureCount.set(o.category, k);
      const base = words(o.category).replace(/^./, (ch) => ch.toUpperCase());
      return { roomName, name: k > 1 ? `${base} ${k}` : base };
    });

  const ceilingHeightM = round2(Math.max(...walls.map((w) => w.height)));
  const plan = buildPlan({
    unitId: opts.unitId,
    ceilingHeightM,
    // Plan units are already meters (LiDAR), so one plan unit = 1 m.
    metersPerPixel: 1,
    scaleSource: 'known-measurement',
    rooms: [{ name: roomName, polygon: poly }],
    openings,
    fixtures,
    warnings,
  });

  // ---- object landmarks: the floor always; the nearest wall when the object stands against it (<= 0.6 m)
  const floor = plan.surfaces.find((s) => s.kind === 'floor');
  const planWalls = plan.surfaces.filter((s) => s.kind === 'wall' && s.segment);
  for (const o of objects) {
    const text = words(o.category);
    if (floor) floor.landmarks = [...new Set([...(floor.landmarks ?? []), text])];
    let best: { d: number; s: (typeof planWalls)[number] } | undefined;
    for (const s of planWalls) {
      const [a, b] = s.segment! as [Pt, Pt];
      const d = dist(o.center, projectOnSegment(o.center, a, b)) - o.depth / 2;
      if (!best || d < best.d) best = { d, s };
    }
    if (best && best.d <= 0.6 && !(best.s.landmarks ?? []).includes(text)) best.s.landmarks = [...(best.s.landmarks ?? []), text];
  }

  const res = FloorPlanSchema.safeParse(plan);
  if (!res.success) throw new ScanError(`scan produced an invalid plan: ${res.error.issues.map((i) => i.message).join('; ')}`);
  return res.data;
}

function nearestEdge(p: Pt, poly: Pt[]): number {
  let bi = 0;
  let bd = Infinity;
  poly.forEach((a, k) => {
    const d = dist(p, projectOnSegment(p, a, poly[(k + 1) % poly.length]!));
    if (d < bd) [bd, bi] = [d, k];
  });
  return bi;
}

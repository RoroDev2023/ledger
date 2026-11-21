// E4 · plan parsing accuracy: compare a parsed FloorPlan with the fixture its image was drawn from.
import type { FloorPlan } from '@ledger/shared';

export interface PlanScore {
  roomsTrue: number;
  roomsFound: number;
  /** Rooms whose name matches a true room name (case-insensitive). */
  roomNamesMatched: number;
  openingsTrue: number;
  /** True openings matched by a parsed opening of the same kind at the same relative position. */
  openingsFound: number;
  /** Median relative error of room bounding-box width and height, in %. */
  medianDimErrorPct: number | null;
}

function center(plan: FloorPlan, o: FloorPlan['openings'][number]): [number, number] | undefined {
  const w = plan.surfaces.find((s) => s.id === o.wallId)?.segment;
  if (!w) return undefined;
  const [[x1, y1], [x2, y2]] = w;
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const t = o.offsetM + o.widthM / 2;
  return [x1 + ((x2 - x1) / L) * t, y1 + ((y2 - y1) / L) * t];
}

const bbox = (poly: [number, number][]) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x: Math.min(...xs), y: Math.min(...ys) };
};

/** relTol: max distance between opening centers as a fraction of the plan's size (default 8%). */
export function scorePlan(parsed: FloorPlan, truth: FloorPlan, relTol = 0.08): PlanScore {
  const names = new Set(truth.rooms.map((r) => r.name.toLowerCase()));
  const roomNamesMatched = parsed.rooms.filter((r) => names.has(r.name.toLowerCase())).length;

  // Match openings by position relative to each plan's own extent (0-1), so a scale error does not
  // also count as missed doors; scale error is measured separately as dimension error.
  const extent = (p: FloorPlan) => {
    const all = p.rooms.flatMap((r) => r.polygon);
    const xs = all.map((q) => q[0]);
    const ys = all.map((q) => q[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return { x0, y0, w: Math.max(...xs) - x0 || 1, h: Math.max(...ys) - y0 || 1 };
  };
  const ep = extent(parsed);
  const et = extent(truth);
  const rel = (c: [number, number], e: ReturnType<typeof extent>) => [(c[0] - e.x0) / e.w, (c[1] - e.y0) / e.h] as const;
  const used = new Set<number>();
  let openingsFound = 0;
  const parsedRel = parsed.openings.map((o) => {
    const c = center(parsed, o);
    return { kind: o.kind, r: c ? rel(c, ep) : undefined };
  });
  for (const o of truth.openings) {
    const c = center(truth, o);
    if (!c) continue;
    const r = rel(c, et);
    const i = parsedRel.findIndex((p, j) => !used.has(j) && p.kind === o.kind && p.r && Math.hypot(p.r[0] - r[0], p.r[1] - r[1]) <= relTol);
    if (i >= 0) { used.add(i); openingsFound++; }
  }

  // Dimension error: pair rooms by name, compare bounding-box width and height.
  const errs: number[] = [];
  for (const t of truth.rooms) {
    const p = parsed.rooms.find((r) => r.name.toLowerCase() === t.name.toLowerCase());
    if (!p) continue;
    const a = bbox(p.polygon);
    const b = bbox(t.polygon);
    if (b.w > 0) errs.push(Math.abs(a.w - b.w) / b.w);
    if (b.h > 0) errs.push(Math.abs(a.h - b.h) / b.h);
  }
  errs.sort((x, y) => x - y);
  const med = errs.length ? (errs.length % 2 ? errs[(errs.length - 1) / 2]! : (errs[errs.length / 2 - 1]! + errs[errs.length / 2]!) / 2) : null;

  return {
    roomsTrue: truth.rooms.length,
    roomsFound: parsed.rooms.length,
    roomNamesMatched,
    openingsTrue: truth.openings.length,
    openingsFound,
    medianDimErrorPct: med === null ? null : Math.round(med * 1000) / 10,
  };
}

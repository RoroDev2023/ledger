// E2 · parsePlan: a 2D floor plan image -> validated FloorPlan.
// Argon only reads the drawing (rooms, openings, dimension labels) on a 0-1000 grid.
// Everything numeric after that (scale, meters, walls, areas, IDs) is plain code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { FloorPlanSchema, type FloorPlan } from '@ledger/shared';
import { buildPlan, cleanName, polygonArea, round2 } from './surfaces.js';

type Pt = [number, number];

// ---------------------------------------------------------------------------------------------
// What we ask the model for. Coordinates are on a 0-1000 grid (x right, y down) over the image.
const gridPt = z.tuple([z.number().min(-20).max(1020), z.number().min(-20).max(1020)]);

export const ArgonPlanSchema = z.object({
  rooms: z.array(z.object({ name: z.string().min(1), polygon: z.array(gridPt).min(3) })).min(1),
  openings: z.array(z.object({ kind: z.enum(['door', 'window']), a: gridPt, b: gridPt })),
  dimensionLabels: z.array(
    z.object({
      text: z.string(),
      /** The label's value converted to meters by the model, e.g. 12'6" -> 3.81. Code re-checks it. */
      meters: z.number().positive().nullable(),
      /** Endpoints of the dimension line the label measures. */
      a: gridPt,
      b: gridPt,
    }),
  ),
  fixtures: z.array(z.object({ room: z.string(), name: z.string() })),
  /** Total area printed on the plan, in square meters, if any. */
  printedTotalAreaM2: z.number().positive().nullable(),
  /** Degrees clockwise from image-up to the north arrow, if the plan has one. */
  northArrowDeg: z.number().nullable(),
});
export type ArgonPlan = z.infer<typeof ArgonPlanSchema>;

export const PLAN_PROMPT = `You are reading an apartment floor plan image.
Return JSON only, matching the schema. Use a 0-1000 grid over the whole image: x from left (0) to right (1000), y from top (0) to bottom (1000).
- rooms: every enclosed room with its name as printed (or a short generic name like "Bathroom" if unnamed), and its polygon traced along the inside of the walls, corners in order.
- openings: every door and window, as the two endpoints of the gap in the wall.
- dimensionLabels: every printed measurement with its exact text, its value in meters (convert feet/inches; null if unreadable), and the two endpoints of the line or wall it measures.
- fixtures: sinks, stoves, tubs, toilets, counters, closets, radiators, with the room they are in.
- printedTotalAreaM2: total area printed on the plan in square meters (convert sq ft), else null.
- northArrowDeg: degrees clockwise from image-up to the north arrow, else null.
Do not invent rooms or measurements that are not on the drawing.`;

// ---------------------------------------------------------------------------------------------
// The only thing parsePlan needs from packages/gemini (Rahim's client). Mockable in tests.
export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mime_type: string };

export interface PlanModel {
  generate<T>(args: { model: string; parts: Part[]; schema: z.ZodType<T>; tag: string }): Promise<T>;
}

// ---------------------------------------------------------------------------------------------
// Image helpers

/** Width and height from a PNG or JPEG header (no image library needed). */
export function imageSize(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  throw new Error('unsupported image: expected PNG or JPEG');
}

/** PDF -> PNG (first page, 200 dpi) via pdftoppm; images pass through. */
export function loadPlanImage(path: string): { data: Buffer; mime: string } {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-plan-'));
    execFileSync('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', '1', '-singlefile', path, join(dir, 'page')]);
    const png = readdirSync(dir).find((f) => f.endsWith('.png'));
    if (!png) throw new Error('pdftoppm produced no image');
    return { data: readFileSync(join(dir, png)), mime: 'image/png' };
  }
  return { data: readFileSync(path), mime: ext === '.png' ? 'image/png' : 'image/jpeg' };
}

// ---------------------------------------------------------------------------------------------
// Geometry cleanup (pixel space)

/** Merge vertices closer than `tol` px (across all rooms) to their shared mean. */
export function mergeVertices(polys: Pt[][], tol = 5): Pt[][] {
  const all = polys.flat();
  const groupOf = all.map((_, i) => i);
  const find = (i: number): number => (groupOf[i] === i ? i : (groupOf[i] = find(groupOf[i]!)));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (Math.hypot(all[i]![0] - all[j]![0], all[i]![1] - all[j]![1]) <= tol) groupOf[find(j)] = find(i);
  const sums = new Map<number, [number, number, number]>();
  all.forEach((p, i) => {
    const g = find(i);
    const s = sums.get(g) ?? [0, 0, 0];
    sums.set(g, [s[0] + p[0], s[1] + p[1], s[2] + 1]);
  });
  let k = 0;
  return polys.map((poly) =>
    poly.map(() => {
      const s = sums.get(find(k++))!;
      return [s[0] / s[2], s[1] / s[2]] as Pt;
    }),
  );
}

/** Snap edges within ±deg of horizontal/vertical exactly onto the axis, and drop repeated points. */
export function snapToAxes(poly: Pt[], deg = 3): Pt[] {
  const out = poly.map((p) => [...p] as Pt);
  const tan = Math.tan((deg * Math.PI) / 180);
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % out.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.abs(dx) > 1e-9 && Math.abs(dy / dx) <= tan) b[1] = a[1];
    else if (Math.abs(dy) > 1e-9 && Math.abs(dx / dy) <= tan) b[0] = a[0];
  }
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

// ---------------------------------------------------------------------------------------------
// Scale

/**
 * meters per pixel from dimension labels: median of label/pixel-length, dropping labels more than
 * 15% off the median. Falls back to a known measurement, then to an assumption with a warning.
 */
export function scaleFromLabels(
  labels: { meters: number | null; a: Pt; b: Pt }[],
  knownMetersPerPixel?: number,
): { metersPerPixel: number; scaleSource: FloorPlan['scaleSource']; warnings: string[] } {
  const ratios = labels
    .filter((l) => l.meters && l.meters > 0)
    .map((l) => l.meters! / Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]))
    .filter((r) => Number.isFinite(r) && r > 0);
  if (ratios.length) {
    const median = (xs: number[]) => {
      const s = [...xs].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
    };
    const m0 = median(ratios);
    const kept = ratios.filter((r) => Math.abs(r - m0) / m0 <= 0.15);
    const warnings = kept.length < ratios.length ? [`${ratios.length - kept.length} dimension label(s) disagreed with the others by >15% and were ignored`] : [];
    return { metersPerPixel: median(kept), scaleSource: 'labels', warnings };
  }
  if (knownMetersPerPixel) return { metersPerPixel: knownMetersPerPixel, scaleSource: 'known-measurement', warnings: [] };
  return {
    metersPerPixel: 0.01,
    scaleSource: 'assumed',
    warnings: ['no readable dimension labels: scale assumed at 1 px = 1 cm; ask the owner for one known measurement'],
  };
}

// ---------------------------------------------------------------------------------------------
// Validation

export function validatePlanGeometry(plan: FloorPlan, printedTotalAreaM2: number | null): string[] {
  const errors: string[] = [];
  for (const r of plan.rooms) {
    if (r.polygon.length < 3) errors.push(`room ${r.id} has fewer than 3 corners`);
    if (Math.abs(polygonArea(r.polygon as Pt[])) < 0.5) errors.push(`room ${r.id} is smaller than 0.5 m²`);
  }
  if (printedTotalAreaM2) {
    const sum = plan.rooms.reduce((s, r) => s + Math.abs(polygonArea(r.polygon as Pt[])), 0);
    if (Math.abs(sum - printedTotalAreaM2) / printedTotalAreaM2 > 0.15)
      errors.push(`rooms add up to ${round2(sum)} m² but the plan says ${printedTotalAreaM2} m² (off by more than 15%)`);
  }
  const res = FloorPlanSchema.safeParse(plan);
  if (!res.success) errors.push(...res.error.issues.map((i) => i.message));
  return errors;
}

// ---------------------------------------------------------------------------------------------
// From model output to FloorPlan

export function planFromArgon(
  argon: ArgonPlan,
  img: { width: number; height: number },
  opts: { unitId: string; ceilingHeightM?: number; knownMetersPerPixel?: number },
): { plan: FloorPlan; errors: string[] } {
  const toPx = ([x, y]: Pt): Pt => [(x / 1000) * img.width, (y / 1000) * img.height];
  const roomsPx = mergeVertices(argon.rooms.map((r) => r.polygon.map(toPx))).map((p) => snapToAxes(p));
  const scale = scaleFromLabels(
    argon.dimensionLabels.map((l) => ({ meters: l.meters, a: toPx(l.a), b: toPx(l.b) })),
    opts.knownMetersPerPixel,
  );
  const mpp = scale.metersPerPixel;
  // pixel (x right, y down) -> meters (x right, y = north up)
  const toM = ([x, y]: Pt): Pt => [round2(x * mpp), round2((img.height - y) * mpp)];

  const warnings = [...scale.warnings];
  if (argon.northArrowDeg !== null && Math.abs(argon.northArrowDeg) > 10)
    warnings.push(`north arrow points ${Math.round(argon.northArrowDeg)}° from image-up; wall names use image-up as north`);

  const plan = buildPlan({
    unitId: opts.unitId,
    ceilingHeightM: opts.ceilingHeightM ?? 2.6,
    metersPerPixel: mpp,
    scaleSource: scale.scaleSource,
    rooms: argon.rooms.map((r, i) => ({ name: cleanName(r.name), polygon: roomsPx[i]!.map(toM) })),
    openings: argon.openings.map((o, i) => {
      const a = toM(toPx(o.a));
      const b = toM(toPx(o.b));
      return {
        id: `${o.kind}-${i + 1}`,
        kind: o.kind,
        center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt,
        widthM: Math.max(0.3, round2(Math.hypot(b[0] - a[0], b[1] - a[1]))),
      };
    }),
    fixtures: argon.fixtures.map((f) => ({ roomName: cleanName(f.room), name: cleanName(f.name) })),
    warnings: opts.ceilingHeightM ? warnings : [...warnings, 'ceiling height assumed 2.6 m; owner should confirm'],
  });
  return { plan, errors: validatePlanGeometry(plan, argon.printedTotalAreaM2) };
}

/**
 * Full E2 flow: image/PDF -> Argon -> cleanup -> validation, with up to 2 Carbon repair rounds
 * when validation fails. Always returns a plan; unresolved problems end up in `warnings`.
 */
export async function parsePlan(
  path: string,
  model: PlanModel,
  opts: { unitId: string; ceilingHeightM?: number; knownMetersPerPixel?: number; env?: NodeJS.ProcessEnv } = { unitId: 'unit' },
): Promise<FloorPlan> {
  const env = opts.env ?? process.env;
  const { data, mime } = loadPlanImage(path);
  const size = imageSize(data);
  const image: Part = { type: 'image', data: data.toString('base64'), mime_type: mime };

  let argon = await model.generate({
    model: env.MODEL_PLAN ?? 'gemini-4-argon',
    parts: [{ type: 'text', text: PLAN_PROMPT }, image],
    schema: ArgonPlanSchema,
    tag: 'plan.parse',
  });
  let { plan, errors } = planFromArgon(argon, size, opts);

  for (let round = 1; errors.length && round <= 2; round++) {
    argon = await model.generate({
      model: env.MODEL_DEEP ?? 'gemini-4-carbon',
      parts: [
        { type: 'text', text: `${PLAN_PROMPT}\n\nA previous reading of this plan failed these checks:\n- ${errors.join('\n- ')}\nPrevious reading:\n${JSON.stringify(argon)}\nReturn a corrected reading.` },
        image,
      ],
      schema: ArgonPlanSchema,
      tag: `plan.repair.${round}`,
    });
    ({ plan, errors } = planFromArgon(argon, size, opts));
  }
  if (errors.length) plan = { ...plan, warnings: [...plan.warnings, ...errors.map((e) => `unresolved: ${e}`)] };
  return plan;
}

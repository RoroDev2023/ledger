// [Alex] Parse a plan PDF/image end to end and grade it against its ground truth.
//   pnpm --filter @ledger/api check-plan test/plans/unit-4b.pdf          # live Argon (needs GEMINI_API_KEY etc.)
//   pnpm --filter @ledger/api check-plan test/plans/unit-4b.pdf --truth  # no key: a perfect "Argon" answer from
//                                                                         # unit-4b.truth.json, tests everything after Argon
// The parsed plan is saved as a unit in DATA_DIR, so http://localhost:3000/units/<unitId> shows it in 3D.
import '../src/env.js';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gemini, geminiMode } from '@ledger/gemini';
import type { PlanModel } from '@ledger/plan';
import type { FloorPlan } from '@ledger/shared';
import { argonPlanParser, planImagePath } from '../src/planParser.js';
import { Storage, defaultDataDir } from '../src/storage.js';

interface Truth {
  unitId: string;
  totalAreaM2: number;
  rooms: { name: string; areaM2: number; polygon: [number, number][] }[];
  openings: { kind: 'door' | 'window'; widthM: number; a: [number, number]; b: [number, number] }[];
  argon: unknown;
}

const file = process.argv[2];
const useTruth = process.argv.includes('--truth');
if (!file || !existsSync(file)) {
  console.error('usage: check-plan <plan.pdf|png> [--truth]');
  process.exit(1);
}
const truthPath = file.replace(/\.(pdf|png|jpe?g)$/i, '.truth.json');
const truth = existsSync(truthPath) ? (JSON.parse(readFileSync(truthPath, 'utf8')) as Truth) : null;

const model: PlanModel = useTruth
  ? {
      // Stands in for Argon with the exact reading of the drawing; Carbon repair rounds get the same answer.
      generate: async ({ schema }) => schema.parse(truth?.argon),
    }
  : gemini;
if (useTruth && !truth) throw new Error(`--truth needs ${truthPath}`);
if (!useTruth && geminiMode() === 'mock') {
  console.error(`No live Gemini: GEMINI_MODE is "mock" (no .env, or GEMINI_MODE=mock in it).
To read the plan with Argon, create ledger/.env from .env.example with your key:
  GEMINI_API_KEY=<your key>
  GEMINI_MODE=live            (or record, to save the answer for replay)
  MODEL_PLAN=gemini-4-argon   (and the other MODEL_* lines)
Without a key, run with --truth to test everything after Argon.`);
  process.exit(2);
}

const unitId = `${basename(file).replace(/\.[^.]+$/, '')}-${useTruth ? 'truth' : 'argon'}`.replace(/[^A-Za-z0-9_-]/g, '-');
console.log(`\n▶ ${file} → ${useTruth ? 'ground-truth reading (no API call)' : `live ${process.env.MODEL_PLAN ?? 'MODEL_PLAN'}`}`);
const t0 = Date.now();
console.log(`  image: ${planImagePath(file)}`);
const plan: FloorPlan = await argonPlanParser(model)({ unitId, filePath: file });
console.log(`  parsed in ${((Date.now() - t0) / 1000).toFixed(1)} s · scale ${plan.metersPerPixel.toFixed(5)} m/px (${plan.scaleSource})`);

const area = (poly: [number, number][]) => Math.abs(poly.reduce((s, [x, y], i) => s + x * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * y, 0)) / 2;
let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
};

console.log('\n  rooms');
for (const r of plan.rooms) console.log(`    ${r.name.padEnd(14)} ${area(r.polygon).toFixed(2)} m²`);
const walls = plan.surfaces.filter((s) => s.kind === 'wall').length;
console.log(`  ${walls} walls · ${plan.openings.length} openings · ${plan.surfaces.filter((s) => s.kind === 'fixture').length} fixtures`);
for (const w of plan.warnings) console.log(`  ⚠ ${w}`);

if (truth) {
  console.log('\n  vs ground truth');
  check(plan.rooms.length === truth.rooms.length, `room count ${plan.rooms.length} (truth ${truth.rooms.length})`);
  for (const t of truth.rooms) {
    const r = plan.rooms.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    const a = r ? area(r.polygon) : 0;
    const err = Math.abs(a - t.areaM2) / t.areaM2;
    check(!!r && err <= 0.05, `${t.name}: ${r ? `${a.toFixed(2)} m² vs ${t.areaM2} (${(err * 100).toFixed(1)}% off)` : 'missing'}`);
  }
  const total = plan.rooms.reduce((s, r) => s + area(r.polygon), 0);
  check(Math.abs(total - truth.totalAreaM2) / truth.totalAreaM2 <= 0.05, `total ${total.toFixed(2)} m² vs ${truth.totalAreaM2}`);
  for (const kind of ['door', 'window'] as const) {
    const want = truth.openings.filter((o) => o.kind === kind);
    const got = plan.openings.filter((o) => o.kind === kind);
    check(got.length === want.length, `${kind}s: ${got.length} (truth ${want.length})`);
    const ws = (xs: { widthM: number }[]) => xs.map((o) => o.widthM).sort((a, b) => a - b);
    const diffs = ws(got).map((w, i) => Math.abs(w - (ws(want)[i] ?? 0)));
    if (got.length === want.length) check(Math.max(0, ...diffs) <= 0.15, `${kind} widths within 15 cm (worst ${(Math.max(0, ...diffs) * 100).toFixed(0)} cm)`);
  }

  // Positions. The parse is in its own meter frame (origin at the image corner), so line it up with the truth by
  // the corner of the bounding box first, then compare every opening's center to the nearest one of its kind.
  const bboxMin = (pts: [number, number][]) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))] as const;
  const [tx, ty] = bboxMin(truth.rooms.flatMap((r) => r.polygon));
  const [px, py] = bboxMin(plan.rooms.flatMap((r) => r.polygon));
  const walls = new Map(plan.surfaces.map((w) => [w.id, w]));
  const parsedCenter = (o: FloorPlan['openings'][number]): [number, number] | null => {
    const seg = walls.get(o.wallId)?.segment;
    if (!seg) return null;
    const [a, b] = seg;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = (o.offsetM + o.widthM / 2) / len;
    return [a[0] + (b[0] - a[0]) * t - px + tx, a[1] + (b[1] - a[1]) * t - py + ty];
  };
  const misplaced: string[] = [];
  let worst = 0;
  for (const t of truth.openings) {
    const c: [number, number] = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const dists = plan.openings.filter((o) => o.kind === t.kind).flatMap((o) => {
      const p = parsedCenter(o);
      return p ? [Math.hypot(p[0] - c[0], p[1] - c[1])] : [];
    });
    const dmin = dists.length ? Math.min(...dists) : Infinity;
    worst = Math.max(worst, dmin);
    if (dmin > 0.3) misplaced.push(`${t.kind} at (${c[0].toFixed(1)}, ${c[1].toFixed(1)}) ${Number.isFinite(dmin) ? `${dmin.toFixed(2)} m off` : 'missing'}`);
  }
  check(misplaced.length === 0, `every door/window within 30 cm of its true spot (worst ${Number.isFinite(worst) ? `${(worst * 100).toFixed(0)} cm` : 'missing'})${misplaced.length ? `: ${misplaced.join('; ')}` : ''}`);
}

// Save as a unit so the web app can show it.
const st = new Storage(defaultDataDir());
const dir = st.unitDir(unitId);
await st.writeJson(join(dir, 'plan.json'), plan);
await st.writeJson(join(dir, 'unit.json'), { unitId, createdAt: new Date().toISOString(), planFile: basename(file), walkthroughs: [] });
console.log(`\n  saved → http://localhost:3000/units/${unitId}`);
console.log(fails ? `  ${fails} check(s) failed` : '  all checks passed');
process.exit(fails ? 1 : 0);

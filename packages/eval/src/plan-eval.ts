// pnpm --filter @ledger/eval plan-eval  ->  eval/plan-results.md
// Parses every listing-style image in packages/shared/fixtures/plan-images/ with parsePlan (Argon via
// packages/gemini) and scores it against the fixture it was drawn from. Needs R1's generate() and a key.
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURES_DIR, loadPlanFixture } from '@ledger/shared';
import { parsePlan, type PlanModel } from '@ledger/plan';
import { scorePlan } from './plan-score.js';

// Load the repo's git-ignored .env (Node 22+), so GEMINI_API_KEY and GEMINI_MODE apply without extra tooling.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env: env already set or mock mode */ }
const gemini: Record<string, unknown> = await import('@ledger/gemini');
if (typeof gemini.generate !== 'function') {
  console.log('packages/gemini has no generate() yet (R1). Nothing run.');
  process.exit(0);
}
const model: PlanModel = { generate: gemini.generate as PlanModel['generate'] };

const dir = join(FIXTURES_DIR, 'plan-images');
const images = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
const rows: string[] = [];
for (const img of images) {
  const name = img.replace(/\.png$/, '');
  const truth = loadPlanFixture(name);
  const t0 = Date.now();
  try {
    const parsed = await parsePlan(join(dir, img), model, { unitId: name, ceilingHeightM: truth.ceilingHeightM });
    const s = scorePlan(parsed, truth);
    rows.push(`| ${name} | ${s.roomsFound}/${s.roomsTrue} | ${s.roomNamesMatched}/${s.roomsTrue} | ${s.openingsFound}/${s.openingsTrue} | ${s.medianDimErrorPct ?? 'n/a'}% | ${parsed.scaleSource} | ${((Date.now() - t0) / 1000).toFixed(1)} s | ${parsed.warnings.length} |`);
  } catch (e) {
    rows.push(`| ${name} | failed: ${(e as Error).message.slice(0, 80)} | | | | | | |`);
  }
}
const md = [
  '# Plan parsing results', '',
  'Images are drawn by us from the fixture plans (`pnpm --filter @ledger/plan plan-images`), so the exact answer is known. Small set; raw counts shown.', '',
  '| Plan | Rooms found | Room names | Doors/windows found | Median dimension error | Scale from | Time | Warnings |',
  '|---|---|---|---|---|---|---|---|',
  ...rows, '',
].join('\n');
const evalDir = resolve(import.meta.dirname, '..', '..', '..', 'eval');
mkdirSync(evalDir, { recursive: true });
writeFileSync(join(evalDir, 'plan-results.md'), md);
console.log(md);

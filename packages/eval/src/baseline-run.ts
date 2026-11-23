// pnpm --filter @ledger/eval baseline <pairId> [plan]   (plan defaults to the pair's own: plan.json, room.json scan or plan.txt)
// Uploads data/pairs/<pairId>/{baseline,moveout}.mp4 through packages/gemini, runs the one-call Neon
// baseline, writes .data/eval/baseline/<pairId>.json for `pnpm eval`. Waits for R1 (generate + upload).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pairPlan, resolvePlan } from './plan-source.js';
import { runBaseline, type BaselineModel } from './baseline.js';

const [pairId, planName] = process.argv.slice(2);
if (!pairId) {
  console.log('usage: pnpm --filter @ledger/eval baseline <pairId> [planFixture]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..');
const pairDir = join(root, 'data', 'pairs', pairId);
for (const f of ['baseline.mp4', 'moveout.mp4'])
  if (!existsSync(join(pairDir, f))) { console.log(`missing ${join(pairDir, f)}`); process.exit(1); }

// Load the repo's git-ignored .env (Node 22+), so GEMINI_API_KEY and GEMINI_MODE apply without extra tooling.
try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* no .env: env already set or mock mode */ }
const gemini: Record<string, unknown> = await import('@ledger/gemini');
const upload = gemini.uploadFile as ((path: string, mime: string) => Promise<{ uri: string }>) | undefined;
if (typeof gemini.generate !== 'function' || typeof upload !== 'function') {
  console.log('packages/gemini needs generate() and uploadFile(path, mime) -> { uri } (R1). Nothing run.');
  process.exit(0);
}
const model: BaselineModel = { generate: gemini.generate as BaselineModel['generate'] };
const plan = planName ? resolvePlan(planName, process.env.INIT_CWD ?? process.cwd()) : pairPlan(pairDir, pairId);
if (!plan) { console.log(`no plan for ${pairId}: add data/pairs/${pairId}/room.json (scan), plan.json, or plan.txt with a fixture name`); process.exit(1); }
const moveIn = await upload(join(pairDir, 'baseline.mp4'), 'video/mp4');
const moveOut = await upload(join(pairDir, 'moveout.mp4'), 'video/mp4');
const items = await runBaseline(plan, { moveIn: { uri: moveIn.uri, mime: 'video/mp4' }, moveOut: { uri: moveOut.uri, mime: 'video/mp4' } }, model);
const out = join(root, process.env.DATA_DIR ?? '.data', 'eval', 'baseline');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${pairId}.json`), JSON.stringify(items, null, 2));
console.log(`baseline ${pairId}: ${items.length} items -> ${join(out, `${pairId}.json`)}`);

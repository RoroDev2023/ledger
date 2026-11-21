// [Alex] Run the spot check on a unit whose walkthroughs were already processed:
//   pnpm --filter @ledger/api exec tsx scripts/spot-run.ts <unitId>
import '../src/env.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WalkthroughEvidence } from '@ledger/pipeline';
import { FloorPlanSchema } from '@ledger/shared';
import { spotCheck } from '../src/spotCheck.js';
import { defaultDataDir } from '../src/storage.js';
import { buildStatement } from '../src/statement/build.js';

const unitId = process.argv[2]!;
const dir = join(defaultDataDir(), 'units', unitId);
const plan = FloorPlanSchema.parse(JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8')));
const wts = await readdir(join(dir, 'walkthroughs'));
const load = async (prefix: string) => JSON.parse(await readFile(join(dir, 'walkthroughs', wts.find((w) => w.startsWith(prefix))!, 'evidence.json'), 'utf8')) as WalkthroughEvidence;
const t0 = Date.now();
const { items, evidence } = await spotCheck({ plan, baseline: await load('baseline'), moveOut: await load('move-out') });
console.log(`spot check: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const [i, d] of items.entries()) {
  const e = evidence.find((x) => x.surfaceId === d.surfaceId && x.issueType === d.issueType);
  console.log(`  ${d.verdict.padEnd(12)} ${d.issueType?.padEnd(16)} ${d.surfaceId.padEnd(30)} $${(d.costUsd ?? 0).toFixed(2)}  frames ${e?.afterFrameIds.map((f) => f.split('.f')[1]).join(',')}  pairs ${JSON.stringify(e?.pairs.map((p) => [p.sameSpot, p.changed]))}`);
  console.log(`      ${d.reason}`);
  void i;
}
for (const e of evidence) if (!items.some((d) => d.surfaceId === e.surfaceId && d.issueType === e.issueType)) console.log('  (merged)', e.verdict, e.afterFrameIds);

// Write the proof frames side by side (move-in | move-out) for checking by eye: <unit>/spot-proof.json
const all = new Map([...(await load('baseline')).frames, ...(await load('move-out')).frames].map((f) => [f.id, f.path]));
const sheet = evidence.flatMap((e) => (e.proof ?? e.pairs).map((p) => ({ verdict: e.verdict, issue: e.issueType, before: all.get(p.beforeFrameId), after: all.get(p.afterFrameId), sameSpot: p.sameSpot, changed: p.changed })));
const { writeFile } = await import('node:fs/promises');
await writeFile(join(dir, 'spot-proof.json'), JSON.stringify(sheet, null, 2)); // proof-sheet

// --write: replace the unit's diff, evidence and statement with this result (so the app shows it).
if (process.argv.includes('--write')) {
  const { writeFile: w } = await import('node:fs/promises');
  const out = JSON.parse(await readFile(join(dir, 'walkthroughs', wts.find((x) => x.startsWith('move-out'))!, 'walkthrough.json'), 'utf8')) as { capturedAt: string };
  await w(join(dir, 'diff.json'), JSON.stringify(items, null, 2));
  await w(join(dir, 'diff-evidence.json'), JSON.stringify({ evidence, warnings: [], method: 'spot-check' }, null, 2));
  await w(join(dir, 'statement.json'), JSON.stringify(buildStatement(unitId, out.capturedAt, items), null, 2));
  console.log(`wrote diff.json, diff-evidence.json, statement.json for ${unitId}`);
}

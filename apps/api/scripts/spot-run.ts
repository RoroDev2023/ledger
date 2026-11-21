// [Alex] Run the spot check on a unit whose walkthroughs were already processed:
//   pnpm --filter @ledger/api exec tsx scripts/spot-run.ts <unitId>
import '../src/env.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WalkthroughEvidence } from '@ledger/pipeline';
import { FloorPlanSchema } from '@ledger/shared';
import { spotCheck } from '../src/spotCheck.js';
import { defaultDataDir } from '../src/storage.js';

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

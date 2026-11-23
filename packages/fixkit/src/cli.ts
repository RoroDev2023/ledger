// pnpm --filter @ledger/fixkit fixkit <unitDir | diff.json> [--no-checkout] [--country US]
// Reads the pipeline's diff.json, builds the fix kit on Shopify (search + unpaid checkout links), prints it,
// and writes fixkit.json next to diff.json. Never pays: the tenant opens the checkout link and decides.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { DiffItemSchema } from '@ledger/shared';
import { buildFixKit } from './fixkit.js';
import { shopClient } from './shop.js';

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--country');
if (!target) {
  console.log('usage: fixkit <unitDir | diff.json> [--no-checkout] [--country US]');
  process.exit(1);
}
const p = resolve(process.env.INIT_CWD ?? process.cwd(), target);
const diffPath = existsSync(p) && statSync(p).isDirectory() ? join(p, 'diff.json') : p;
if (!existsSync(diffPath)) {
  console.log(`no diff.json at ${diffPath}`);
  process.exit(1);
}
const items = z.array(DiffItemSchema).parse(JSON.parse(readFileSync(diffPath, 'utf8')));
const country = args.includes('--country') ? args[args.indexOf('--country') + 1] ?? 'US' : 'US';
const t = Date.now();
const kit = await buildFixKit(items, shopClient(), { unitId: basename(dirname(diffPath)), country, checkout: !args.includes('--no-checkout') });
const out = join(dirname(diffPath), 'fixkit.json');
writeFileSync(out, `${JSON.stringify(kit, null, 2)}\n`);
for (const l of kit.lines) {
  console.log(`${l.surfaceId} · ${l.issueType} · charged $${l.chargeUsd.toFixed(2)}`);
  for (const n of l.needs) console.log(`   ${n.need}: ${n.product ? `${n.product.title.slice(0, 60)} $${n.product.priceUsd.toFixed(2)} (${n.product.seller})` : n.note}`);
}
for (const c of kit.checkouts) console.log(`checkout ${c.seller}: $${c.totalUsd.toFixed(2)} -> ${c.continueUrl.slice(0, 50)}...`);
for (const w of kit.warnings) console.warn(`warning: ${w}`);
console.log(`Kit $${kit.kitTotalUsd.toFixed(2)} vs charged $${kit.chargedUsd.toFixed(2)} (${((Date.now() - t) / 1000).toFixed(1)} s) -> ${out}`);

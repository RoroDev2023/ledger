// [Rahim] Live Shop MCP check. Read-only by default:
//   pnpm --filter @ledger/shop smoke ["query"] [--max-usd 40]      one live search_catalog (US, USD, limit 10)
//   SHOP_MODE=record pnpm --filter @ledger/shop smoke …            same, and saves the response to fixtures/
//   … --checkout                                                   also one create_checkout with the cheapest item
// create_checkout places no order; we print only whether continue_url came back (and its host), never the URL.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { repoRoot } from '@ledger/gemini';
import { createCheckout, searchCatalog } from '../src/index.js';

const root = repoRoot();
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
if (process.env.SHOP_MODE !== 'record') process.env.SHOP_MODE = 'live';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const val = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const query = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--max-usd') ?? 'interior wall touch up paint';
const maxUsd = Number(val('max-usd') ?? 40);

const t0 = performance.now();
const doc = await searchCatalog({ query, country: 'US', currency: 'USD', maxPriceMinor: Math.round(maxUsd * 100), limit: 10 });
console.log(`search_catalog "${query}" ≤ $${maxUsd} (${process.env.SHOP_MODE}): ${doc.products.length} products in ${Math.round(performance.now() - t0)} ms, total ${doc.pagination?.total_count ?? '?'}`);
for (const m of doc.messages) console.log(`  ${m.type}: ${m.content ?? m.code}`);
const rows = doc.products.flatMap((p) =>
  p.variants.map((v) => ({
    title: p.title.slice(0, 50),
    price: `${(v.price.amount / 100).toFixed(2)} ${v.price.currency}`,
    available: v.availability?.available,
    seller: v.seller?.name,
    domain: v.seller?.domain,
  })),
);
console.table(rows);

if (flag('checkout')) {
  const cheapest = doc.products
    .flatMap((p) => p.variants.map((v) => ({ p, v })))
    .filter(({ v }) => v.availability?.available === true && v.price.currency === 'USD' && v.seller?.domain)
    .sort((a, b) => a.v.price.amount - b.v.price.amount)[0];
  if (!cheapest) {
    console.error('no available USD item to check out');
    process.exit(1);
  }
  const t1 = performance.now();
  const co = await createCheckout({ shop: cheapest.v.seller!.domain, lines: [{ variantId: cheapest.v.id, quantity: 1 }], country: 'US' });
  const host = co.continue_url ? new URL(co.continue_url).host : undefined;
  console.log(
    `create_checkout 1 × "${cheapest.p.title.slice(0, 50)}" at ${cheapest.v.seller!.name}: status ${co.status} in ${Math.round(performance.now() - t1)} ms · continue_url ${host ? `present (host ${host})` : 'MISSING'} · expires ${co.expires_at ?? '?'} · no order placed`,
  );
  for (const m of co.messages) console.log(`  ${m.type}${m.severity ? `/${m.severity}` : ''}: ${m.content ?? m.code}`);
}

// [Rahim] pnpm --filter @ledger/cart-agent fill <fixkit.json> [--sellers a,b] [--max-sellers N] [--max-usd N]
//                                                [--shots dir] [--timebox ms] [--headless] [--close]
// Opens a visible Chromium, fills one cart per seller, prints the feed and a table, writes cart.json next to
// the kit, and keeps the tabs open until Ctrl+C (--close to quit right away). Never checks out.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FixKitSchema } from '@ledger/pipeline';
import { fillCarts } from './agent.js';
import { describeCartEvent } from './events.js';
import { sellerRuns } from './plan.js';
import { launchStoreBrowser } from './playwright.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !['--sellers', '--max-sellers', '--max-usd', '--shots', '--timebox'].includes(args[i - 1] ?? ''));
if (!file) {
  console.error('usage: fill <fixkit.json> [--sellers a,b] [--max-sellers N] [--max-usd N] [--shots dir] [--timebox ms] [--headless] [--close]');
  process.exit(2);
}
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const kit = FixKitSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

// --max-usd: only sellers whose lines add up to at most N (for cheap live tests).
let sellers = value('sellers')?.split(',').map((s) => s.trim()).filter(Boolean);
const maxUsd = value('max-usd');
if (maxUsd !== undefined) {
  const cap = Number(maxUsd);
  const cost = (domain: string) => kit.items.filter((i) => i.seller.domain === domain).reduce((s, i) => s + i.lineTotal, 0);
  const cheap = sellerRuns(kit).filter((r) => cost(r.domain) <= cap).sort((a, b) => cost(a.domain) - cost(b.domain));
  sellers = cheap.map((r) => r.domain).filter((d) => !sellers || sellers.includes(d));
}
const maxSellers = value('max-sellers') !== undefined ? Number(value('max-sellers')) : undefined;
const shots = resolve(process.env.INIT_CWD ?? process.cwd(), value('shots') ?? join(dirname(path), 'cart-shots'));

const { carts, close } = await fillCarts(kit, {
  launch: () => launchStoreBrowser({ headless: flag('headless') }),
  screenshotDir: shots,
  onEvent: (e) => console.log(`[${e.done}/${e.total}] ${describeCartEvent(e)}${'screenshot' in e && e.screenshot ? `  (${e.screenshot})` : ''}`),
  ...(sellers ? { sellers } : {}),
  ...(maxSellers !== undefined ? { maxSellers } : {}),
  ...(value('timebox') ? { timeboxMs: Number(value('timebox')) } : {}),
});

console.log('');
console.table(
  carts.map((c) => ({
    seller: c.seller,
    verified: c.verified,
    items: c.itemCount,
    subtotal: `$${c.subtotal.toFixed(2)}`,
    added: c.lines.map((l) => l.via ?? `failed (${l.error ?? '?'})`).join(', '),
    sec: Math.round(c.ms / 100) / 10,
    error: c.error ?? '',
  })),
);
const out = join(dirname(path), 'cart.json');
// cart.json keeps the fallback flag but not the continue_url (it carries an access key).
writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), carts: carts.map(({ fallbackUrl, ...c }) => ({ ...c, hasFallback: !!fallbackUrl })) }, null, 2));
console.log(`wrote ${out}; screenshots in ${shots}`);
for (const c of carts.filter((x) => !x.verified && x.fallbackUrl)) console.log(`fallback for ${c.seller}: use the fix kit's Shop checkout link`);

if (flag('close') || process.env.CART_AGENT_HEADLESS === '1' || flag('headless')) {
  await close();
} else {
  console.log('Tabs stay open on each /cart page. Ctrl+C to close the browser.');
  process.on('SIGINT', () => void close().finally(() => process.exit(0)));
}

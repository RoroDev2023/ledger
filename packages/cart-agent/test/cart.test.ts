import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FixKit, FixKitItem } from '@ledger/pipeline';
import {
  describeCartEvent,
  fillCarts,
  isCheckoutNavigation,
  numericVariantId,
  sellerRuns,
  UNSAFE_TEXT,
  type CartEvent,
  type ClickResult,
  type StoreBrowser,
  type StorePage,
} from '../src/index.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-cart-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const item = (o: { key: string; title: string; id: string; url: string; seller: string; domain: string; quantity?: number; price?: number }): FixKitItem => ({
  key: o.key,
  need: 'n',
  needLabel: 'need',
  product: { id: `gid://shopify/Product/${o.key}`, title: o.title },
  variant: { id: o.id, options: [] },
  price: o.price ?? 5,
  seller: { name: o.seller, domain: o.domain },
  url: o.url,
  quantity: o.quantity ?? 1,
  lineTotal: (o.price ?? 5) * (o.quantity ?? 1),
  confidence: 0.9,
  pickedBy: 'decisions',
  needsChoice: false,
  alternatives: [],
  query: 'q',
  confirmed: true,
  forDiffItem: { surfaceId: 's', issueType: 'stain', deductionUsd: 60 },
});

const kit = (items: FixKitItem[], checkouts: FixKit['checkouts'] = []): FixKit => ({
  createdAt: '2026-11-21T00:00:00Z',
  items,
  checkouts,
  missing: [],
  uncovered: [],
  warnings: [],
  diyTotal: 0,
  deductionTotal: 0,
  savings: 0,
  complete: true,
});

const KNOB = item({ key: 'a', title: 'Cabinet Knob', id: 'gid://shopify/ProductVariant/39354942324817', url: 'https://cosmas-hardware.com/products/knob?variant=39354942324817&_gsid=X&utm_source=shopify', seller: 'Cosmas', domain: 'cosmas-hardware.myshopify.com' });
const PAINT = item({ key: 'b', title: 'Touch Up Kit', id: 'gid://shopify/ProductVariant/51760719921383', url: 'https://touchup.com/products/kit?variant=51760719921383', seller: 'TouchUp.com', domain: 'ysd3dj-1m.myshopify.com', quantity: 2 });

describe('numericVariantId', () => {
  it('reads ?variant= from the URL, keeping the rest of the query string irrelevant', () => {
    expect(numericVariantId('https://x.com/products/p?variant=43979186897036&_gsid=Ub&utm_source=shopify')).toBe('43979186897036');
    expect(numericVariantId('https://x.com/products/p?_gsid=Ub&variant=7')).toBe('7');
  });
  it('falls back to the GID', () => {
    expect(numericVariantId('https://x.com/products/p', 'gid://shopify/ProductVariant/51760719921383')).toBe('51760719921383');
    expect(numericVariantId(undefined, 'gid://shopify/ProductVariant/42?shop=1')).toBe('42');
    expect(numericVariantId('not a url', '123')).toBe('123');
  });
  it('URL param wins over the GID; junk gives null', () => {
    expect(numericVariantId('https://x.com/p?variant=5', 'gid://shopify/ProductVariant/9')).toBe('5');
    expect(numericVariantId('https://x.com/p?variant=abc', 'gid://shopify/ProductVariant/mock-1')).toBeNull();
    expect(numericVariantId('https://x.com/p', 'gid://shopify/Product/12')).toBeNull();
    expect(numericVariantId()).toBeNull();
  });
});

describe('sellerRuns', () => {
  it('groups by seller.domain, merges identical variants, storefront = URL origin, fallback = continue_url', () => {
    const k = kit([KNOB, PAINT, { ...PAINT, key: 'c', quantity: 1 }], [{ seller: 'TouchUp.com', shop: 'ysd3dj-1m.myshopify.com', continue_url: 'https://shop.app/c/1?key=k', subtotal: 1, lines: [], messages: [] }]);
    const runs = sellerRuns(k);
    expect(runs.map((r) => [r.domain, r.storefront, r.lines.length])).toEqual([
      ['cosmas-hardware.myshopify.com', 'https://cosmas-hardware.com', 1],
      ['ysd3dj-1m.myshopify.com', 'https://touchup.com', 1],
    ]);
    expect(runs[1]!.lines[0]!.quantity).toBe(3);
    expect(runs[1]!.continueUrl).toBe('https://shop.app/c/1?key=k');
    expect(runs[0]!.lines[0]!.url).toBe(KNOB.url);
  });
  it('filters by domain, name or storefront host, and caps the count', () => {
    const k = kit([KNOB, PAINT]);
    expect(sellerRuns(k, { sellers: ['touchup.com'] }).map((r) => r.seller)).toEqual(['TouchUp.com']);
    expect(sellerRuns(k, { sellers: ['Cosmas'] }).map((r) => r.seller)).toEqual(['Cosmas']);
    expect(sellerRuns(k, { maxSellers: 1 })).toHaveLength(1);
  });
});

/** A fake store: a cart in memory, a theme button that works or not. */
function fakeBrowser(behavior: Record<string, { button?: 'works' | 'none' | 'silent'; api?: 'works' | 'fails'; hang?: boolean }>) {
  const calls: string[] = [];
  const browser: StoreBrowser = {
    async newPage(): Promise<StorePage> {
      let origin = '';
      const carts = new Map<string, Map<string, number>>();
      const cart = () => carts.get(origin) ?? carts.set(origin, new Map()).get(origin)!;
      const b = () => behavior[new URL(origin).hostname] ?? {};
      return {
        async goto(url) {
          origin = new URL(url).origin;
          calls.push(`goto ${url}`);
          if (b().hang && url.includes('/products/')) await new Promise(() => {});
          return url;
        },
        async dismissPopups() {
          return 0;
        },
        async clickAddToCart(id, qty): Promise<ClickResult> {
          calls.push(`click ${id}`);
          if (b().button === 'none') return 'no-button';
          if (b().button !== 'silent') cart().set(id, (cart().get(id) ?? 0) + qty);
          return 'clicked';
        },
        async addViaCartApi(id, qty) {
          calls.push(`api ${id} ${qty}`);
          if (b().api === 'fails') throw new Error('/cart/add.js 422: sold out');
          cart().set(id, (cart().get(id) ?? 0) + qty);
        },
        async readCart() {
          const items = [...cart()].map(([id, quantity]) => ({ variant_id: Number(id), quantity }));
          return { item_count: items.reduce((s, i) => s + i.quantity, 0), total_price: items.reduce((s, i) => s + i.quantity * 500, 0), currency: 'USD', items };
        },
        async screenshot(path) {
          calls.push(`shot ${path.split('/').pop()}`);
        },
        async pause() {},
      };
    },
    async close() {
      calls.push('close');
    },
  };
  return { browser, calls };
}

const fast = { buttonTimeoutMs: 60, pollMs: 10, homepageMs: 0 };

describe('fillCarts', () => {
  it('event sequence: start → opening → product → added → cart → cart-verified → done; tabs stay open', async () => {
    const { browser, calls } = fakeBrowser({ 'cosmas-hardware.com': { button: 'works' }, 'touchup.com': { button: 'none' } });
    const events: CartEvent[] = [];
    const { carts, close } = await fillCarts(kit([KNOB, PAINT]), { launch: async () => browser, onEvent: (e) => events.push(e), screenshotDir: dir, ...fast });
    expect(events.map((e) => e.step)).toEqual(['start', 'opening', 'product', 'added', 'cart', 'cart-verified', 'opening', 'product', 'added', 'cart', 'cart-verified', 'done']);
    expect(events.map((e) => e.done)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2]);
    expect(events.every((e) => e.total === 2)).toBe(true);
    const added = events.filter((e) => e.step === 'added');
    expect(added.map((e) => e.step === 'added' && e.via)).toEqual(['button', 'cart-api']);
    expect(describeCartEvent(added[1]!)).toBe('added Touch Up Kit ×2 (/cart/add.js)');
    const verified = events.filter((e) => e.step === 'cart-verified');
    expect(verified.map((e) => describeCartEvent(e))).toEqual(['cart verified at Cosmas, 1 item, $5.00', 'cart verified at TouchUp.com, 2 items, $10.00']);
    expect(verified.every((e) => e.step === 'cart-verified' && e.screenshot?.endsWith('-cart.png'))).toBe(true);
    // Homepage first, then the variant URL exactly as search returned it, then the storefront's /cart.
    expect(calls.filter((c) => c.startsWith('goto')).slice(0, 3)).toEqual(['goto https://cosmas-hardware.com/', `goto ${KNOB.url}`, 'goto https://cosmas-hardware.com/cart']);
    expect(carts.map((c) => [c.cartUrl, c.verified, c.itemCount, c.subtotal])).toEqual([
      ['https://cosmas-hardware.com/cart', true, 1, 5],
      ['https://touchup.com/cart', true, 2, 10],
    ]);
    expect(calls).not.toContain('close');
    await close();
    expect(calls).toContain('close');
  });

  it('a click that does not change the cart within the timeout falls back to /cart/add.js', async () => {
    const { browser, calls } = fakeBrowser({ 'cosmas-hardware.com': { button: 'silent' } });
    const { carts } = await fillCarts(kit([KNOB]), { launch: async () => browser, screenshotDir: dir, ...fast });
    expect(calls).toContain('click 39354942324817');
    expect(calls).toContain('api 39354942324817 1');
    expect(carts[0]!.lines[0]!.via).toBe('cart-api');
    expect(carts[0]!.verified).toBe(true);
  });

  it('add failure → add-failed, cart not verified, run continues', async () => {
    const { browser } = fakeBrowser({ 'cosmas-hardware.com': { button: 'none', api: 'fails' } });
    const events: CartEvent[] = [];
    const { carts } = await fillCarts(kit([KNOB, PAINT]), { launch: async () => browser, onEvent: (e) => events.push(e), screenshotDir: dir, ...fast });
    expect(events.find((e) => e.step === 'add-failed')).toMatchObject({ title: 'Cabinet Knob', error: '/cart/add.js 422: sold out' });
    expect(carts.map((c) => c.verified)).toEqual([false, true]);
    expect(describeCartEvent(events.find((e) => e.step === 'cart-verified')!)).toBe('cart at Cosmas is missing Cabinet Knob (0 in cart, $0.00)');
  });

  it('timebox: a hung store becomes seller-failed with the Shop checkout fallback, and the next store still runs', async () => {
    const { browser } = fakeBrowser({ 'cosmas-hardware.com': { hang: true }, 'touchup.com': { button: 'works' } });
    const events: CartEvent[] = [];
    const k = kit([KNOB, PAINT], [{ seller: 'Cosmas', shop: 'cosmas-hardware.myshopify.com', continue_url: 'https://shop.app/c/9?key=k', subtotal: 1, lines: [], messages: [] }]);
    const { carts } = await fillCarts(k, { launch: async () => browser, onEvent: (e) => events.push(e), screenshotDir: dir, ...fast, timeboxMs: 150 });
    expect(events.map((e) => e.step)).toEqual(['start', 'opening', 'seller-failed', 'opening', 'product', 'added', 'cart', 'cart-verified', 'done']);
    expect(carts[0]).toMatchObject({ verified: false, fallbackUrl: 'https://shop.app/c/9?key=k' });
    expect(carts[0]!.error).toMatch(/over 0 s|took over/);
    expect(carts[1]!.verified).toBe(true);
    expect(describeCartEvent(events.at(-1)!)).toBe('done: 1 of 2 carts verified. Nothing was bought.');
  });

  it('a line without a numeric variant id is reported, not sent', async () => {
    const { browser, calls } = fakeBrowser({});
    const bad = { ...KNOB, url: 'https://cosmas-hardware.com/products/knob', variant: { id: 'gid://shopify/ProductVariant/mock-1', options: [] } };
    const { carts } = await fillCarts(kit([bad]), { launch: async () => browser, screenshotDir: dir, ...fast });
    expect(carts[0]!.lines[0]!.error).toMatch(/no numeric variant id/);
    expect(calls.some((c) => c.startsWith('click') || c.startsWith('api'))).toBe(false);
  });
});

describe('never checks out', () => {
  it('blocks checkout navigations', () => {
    for (const u of ['https://touchup.com/checkout', 'https://touchup.com/checkouts/cn/abc', 'https://touchup.com/cart/checkout', 'https://shop.app/checkout/1', 'https://x.com/cart?checkout=1']) {
      expect(isCheckoutNavigation(u), u).toBe(true);
    }
    expect(isCheckoutNavigation('https://touchup.com/cart', 'POST', 'updates%5B%5D=1&checkout=Check+out')).toBe(true);
    for (const u of ['https://touchup.com/cart', 'https://touchup.com/products/kit?variant=1', 'https://touchup.com/']) expect(isCheckoutNavigation(u), u).toBe(false);
    expect(isCheckoutNavigation('https://touchup.com/cart', 'POST', 'updates%5B%5D=2')).toBe(false);
  });

  it('treats checkout and express-pay labels as unsafe', () => {
    for (const t of ['Check out', 'Checkout', 'Buy it now', 'Shop Pay', 'PayPal', 'Place order']) expect(UNSAFE_TEXT.test(t), t).toBe(true);
    for (const t of ['Add to cart', 'Close', 'No thanks', 'Accept']) expect(UNSAFE_TEXT.test(t), t).toBe(false);
  });

  it('static check: no complete_checkout, no checkout click or navigation, the only typing is the quantity field', async () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    for (const f of await readdir(srcDir)) {
      const code = await readFile(join(srcDir, f), 'utf8');
      expect(code, f).not.toMatch(/complete_?checkout|completeCheckout/i);
      for (const line of code.split('\n')) {
        // No checkout URL in a string literal (comments may mention them).
        if (!/^\s*(\/\/|\*|\/\*\*)/.test(line)) expect(line, `${f}: ${line}`).not.toMatch(/(['"`])[^'"`]*\/checkouts?\b[^'"`]*\1/);
        if (/\.(click|dblclick|tap|press|check|goto|submit|dispatchEvent)\(/.test(line) || /\b(fetch)\(/.test(line)) expect(line, `${f}: ${line}`).not.toMatch(/checkout/i);
      }
      const typing = code.split('\n').filter((l) => /\.(fill|type|pressSequentially|setInputFiles|selectOption)\(/.test(l));
      expect(typing.every((l) => /qty\.fill\(String\(quantity\)/.test(l)), `${f}: ${typing.join(' | ')}`).toBe(true);
    }
  });
});

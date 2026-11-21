// [Rahim] The cart agent: for each seller in a FixKit, open the store, show the product page, put the picked
// variant in the cart, and stop on /cart. It never checks out: it presses no checkout or pay button, calls no order tool, and enters no
// personal or payment data. The browser is behind StoreBrowser/StorePage so the flow is testable without one.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { FixKit } from '@ledger/pipeline';
import type { AddVia, CartEvent, CartEventBody, OnCartEvent } from './events.js';
import { sellerRuns, type CartLine, type SellerRun } from './plan.js';

/** What /cart.js returns (Shopify Ajax API), only the fields we read. Prices in minor units. */
export const CartJsSchema = z
  .object({
    item_count: z.number(),
    total_price: z.number(),
    currency: z.string().optional(),
    items: z.array(z.object({ variant_id: z.number(), quantity: z.number(), title: z.string().optional() }).passthrough()),
  })
  .passthrough();
export type CartJs = z.infer<typeof CartJsSchema>;

export type ClickResult = 'clicked' | 'no-button' | 'variant-mismatch';

/** One browser tab on one store. */
export interface StorePage {
  /** Navigate and wait for the page; returns the final URL (after redirects). */
  goto(url: string): Promise<string>;
  /** Close obvious cookie/newsletter popups; at most `tries` passes, never throws. Returns how many closed. */
  dismissPopups(tries: number): Promise<number>;
  /** Click the theme's add-to-cart button for this variant (sets quantity if the form has a field). */
  clickAddToCart(variantId: string, quantity: number): Promise<ClickResult>;
  /** POST /cart/add.js on the store origin. Throws on a non-2xx answer. */
  addViaCartApi(variantId: string, quantity: number): Promise<void>;
  /** GET /cart.js on the store origin (raw JSON; validated by the agent). */
  readCart(): Promise<unknown>;
  screenshot(path: string): Promise<void>;
  /** Wait a moment so people can see the page (no-op in tests). */
  pause(ms: number): Promise<void>;
}

export interface StoreBrowser {
  newPage(): Promise<StorePage>;
  close(): Promise<void>;
}

export interface CartLineResult {
  key: string;
  title: string;
  variantId: string | null;
  quantity: number;
  via?: AddVia;
  error?: string;
}

export interface CartResult {
  seller: string;
  shop: string;
  cartUrl: string;
  /** Every wanted variant is in the cart at the wanted quantity (read back from /cart.js). */
  verified: boolean;
  itemCount: number;
  /** Cart subtotal from /cart.js, in the store currency (before tax and shipping). */
  subtotal: number;
  currency: string;
  screenshot?: string;
  lines: CartLineResult[];
  error?: string;
  /** The Shop MCP continue_url for this seller (show as a link when the run failed). Never logged. */
  fallbackUrl?: string;
  ms: number;
}

export interface FillCartsOptions {
  launch: () => Promise<StoreBrowser>;
  onEvent?: OnCartEvent;
  /** Where screenshots go (created). */
  screenshotDir: string;
  sellers?: string[];
  maxSellers?: number;
  /** Per seller (default 30 s). On timeout the seller is recorded as failed and the run moves on. */
  timeboxMs?: number;
  /** Button click + wait for the cart to change, before falling back to /cart/add.js (default 5 s). */
  buttonTimeoutMs?: number;
  pollMs?: number;
  /** How long the homepage stays on screen (default 1.5 s). */
  homepageMs?: number;
  popupTries?: number;
}

export interface FillCartsResult {
  carts: CartResult[];
  /** Closes the browser. Leave it open for the demo: one tab per seller stays on its /cart page. */
  close: () => Promise<void>;
}

class Timeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Timeout(`${what} took over ${ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`}`)), ms)))]).finally(() => clearTimeout(t));
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 200);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'store';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const qtyIn = (cart: CartJs | null, variantId: string) => cart?.items.filter((i) => String(i.variant_id) === variantId).reduce((s, i) => s + i.quantity, 0) ?? 0;

async function cartOf(page: StorePage): Promise<CartJs | null> {
  try {
    return CartJsSchema.parse(await page.readCart());
  } catch {
    return null;
  }
}

/** Runs every seller in the kit in one browser (one tab each). Never throws for a store failure. */
export async function fillCarts(kit: FixKit, opts: FillCartsOptions): Promise<FillCartsResult> {
  const runs = sellerRuns(kit, { ...(opts.sellers ? { sellers: opts.sellers } : {}), ...(opts.maxSellers !== undefined ? { maxSellers: opts.maxSellers } : {}) });
  const total = runs.length;
  let done = 0;
  const emit = (e: CartEventBody) => opts.onEvent?.({ done, total, ...e } as CartEvent);
  await mkdir(opts.screenshotDir, { recursive: true });

  emit({ step: 'start', sellers: total, items: runs.reduce((s, r) => s + r.lines.length, 0) });
  const browser = total ? await opts.launch() : null;
  const carts: CartResult[] = [];
  for (const [i, run] of runs.entries()) {
    carts.push(await runSeller(browser!, run, i, opts, emit));
    done++;
  }
  emit({ step: 'done', carts: carts.length, verified: carts.filter((c) => c.verified).length });
  return { carts, close: async () => void (await browser?.close()) };
}

async function runSeller(browser: StoreBrowser, run: SellerRun, index: number, opts: FillCartsOptions, emit: (e: CartEventBody) => void): Promise<CartResult> {
  const t0 = Date.now();
  const live = { on: true };
  // After a timeout the abandoned work may still resolve: it must not emit into the next seller's feed.
  const say = (e: CartEventBody) => live.on && emit(e);
  const result: CartResult = {
    seller: run.seller,
    shop: run.domain,
    cartUrl: `${run.storefront}/cart`,
    verified: false,
    itemCount: 0,
    subtotal: 0,
    currency: 'USD',
    lines: run.lines.map((l) => ({ key: l.key, title: l.title, variantId: l.variantId, quantity: l.quantity })),
    ...(run.continueUrl ? { fallbackUrl: run.continueUrl } : {}),
    ms: 0,
  };
  try {
    await withTimeout(sellerFlow(browser, run, index, opts, say, result), opts.timeboxMs ?? 30_000, run.seller);
  } catch (e) {
    result.error = msg(e);
  } finally {
    live.on = false;
  }
  result.ms = Date.now() - t0;
  if (result.error) emit({ step: 'seller-failed', seller: run.seller, error: result.error, ...(run.continueUrl ? { fallbackUrl: run.continueUrl } : {}) });
  return result;
}

async function sellerFlow(browser: StoreBrowser, run: SellerRun, index: number, opts: FillCartsOptions, say: (e: CartEventBody) => void, result: CartResult): Promise<void> {
  const page = await browser.newPage();
  const shot = (what: string) => join(opts.screenshotDir, `${String(index + 1).padStart(2, '0')}-${slug(run.seller)}-${what}.png`);
  const tries = opts.popupTries ?? 2;

  // a. Homepage briefly, then the product page(s).
  say({ step: 'opening', seller: run.seller, shop: run.domain, url: run.storefront });
  await page.goto(`${run.storefront}/`);
  await closePopups(page, tries, run.seller, say);
  await page.pause(opts.homepageMs ?? 1500);

  let origin = run.storefront;
  for (const [i, line] of run.lines.entries()) {
    const out = result.lines[i]!;
    if (!line.variantId) {
      out.error = 'no numeric variant id in the URL or GID';
      say({ step: 'add-failed', seller: run.seller, title: line.title, error: out.error });
      continue;
    }
    const final = await page.goto(line.url);
    try {
      origin = new URL(final).origin;
    } catch {
      // keep the previous origin
    }
    await closePopups(page, tries, run.seller, say);
    const productShot = shot(`product-${i + 1}`);
    const shotOk = await page.screenshot(productShot).then(() => true, () => false);
    say({ step: 'product', seller: run.seller, title: line.title, url: final, ...(shotOk ? { screenshot: productShot } : {}) });

    // b. Add to cart: theme button first, /cart/add.js if it doesn't land within the button timeout.
    try {
      out.via = await addLine(page, line, line.variantId, opts);
      say({ step: 'added', seller: run.seller, title: line.title, quantity: line.quantity, via: out.via });
    } catch (e) {
      out.error = msg(e);
      say({ step: 'add-failed', seller: run.seller, title: line.title, error: out.error });
    }
  }

  // c. The store's /cart page, verified against /cart.js, screenshot. d. Stop here (tab stays open).
  result.cartUrl = `${origin}/cart`;
  say({ step: 'cart', seller: run.seller, cartUrl: result.cartUrl });
  await page.goto(result.cartUrl);
  await closePopups(page, tries, run.seller, say);
  const cart = await cartOf(page);
  const missing = run.lines.filter((l) => !l.variantId || qtyIn(cart, l.variantId) < l.quantity).map((l) => l.title);
  result.verified = !!cart && missing.length === 0;
  result.itemCount = cart?.item_count ?? 0;
  result.subtotal = cart ? Math.round(cart.total_price) / 100 : 0;
  result.currency = cart?.currency ?? 'USD';
  const cartShot = shot('cart');
  if (await page.screenshot(cartShot).then(() => true, () => false)) result.screenshot = cartShot;
  if (!cart) result.error = 'could not read /cart.js';
  say({
    step: 'cart-verified',
    seller: run.seller,
    cartUrl: result.cartUrl,
    verified: result.verified,
    itemCount: result.itemCount,
    subtotal: result.subtotal,
    currency: result.currency,
    missing,
    ...(result.screenshot ? { screenshot: result.screenshot } : {}),
  });
}

async function closePopups(page: StorePage, tries: number, seller: string, say: (e: CartEventBody) => void) {
  const n = await page.dismissPopups(tries).catch(() => 0);
  if (n > 0) say({ step: 'popup', seller, dismissed: n });
}

/** Button first; if the cart hasn't changed within the button timeout, /cart/add.js for what is still missing. */
async function addLine(page: StorePage, line: CartLine, variantId: string, opts: FillCartsOptions): Promise<AddVia> {
  const budget = opts.buttonTimeoutMs ?? 5000;
  const poll = opts.pollMs ?? 400;
  const before = qtyIn(await cartOf(page), variantId);
  const start = Date.now();
  let added = 0;
  const click = await withTimeout(page.clickAddToCart(variantId, line.quantity), budget, 'add-to-cart button').catch(() => 'no-button' as const);
  if (click === 'clicked') {
    do {
      added = qtyIn(await cartOf(page), variantId) - before;
      if (added >= line.quantity) return 'button';
      await sleep(poll);
    } while (Date.now() - start < Math.max(budget, 1500));
  }
  const rest = line.quantity - Math.max(0, added);
  await page.addViaCartApi(variantId, rest);
  return added > 0 ? 'button+cart-api' : 'cart-api';
}

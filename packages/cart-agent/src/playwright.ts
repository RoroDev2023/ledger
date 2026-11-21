// [Rahim] Playwright driver for the cart agent: one visible Chromium window, one tab per store.
// Safety belt on top of "we never click it": every navigation to a checkout page is aborted at the network
// layer (isCheckoutNavigation), so even a theme that redirects to checkout after add-to-cart stops at the cart.
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import type { ClickResult, StoreBrowser, StorePage } from './agent.js';

export interface LaunchOptions {
  /** Default false: the browser is meant to be watched. CART_AGENT_HEADLESS=1 overrides. */
  headless?: boolean;
  /** Default 300 ms per action so people can follow along. */
  slowMo?: number;
}

/** Text on a control we must never press (checkout, express pay). */
export const UNSAFE_TEXT = /check\s*-?\s*out|buy\s+(it\s+)?now|shop\s*pay|paypal|apple\s*pay|google\s*pay|place\s+order|pay\s+now/i;

/** True for a navigation that would leave the cart for a checkout (or a POST to /cart that asks for one). */
export function isCheckoutNavigation(url: string, method = 'GET', postData: string | null = null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname === 'shop.app' || u.hostname.endsWith('.shop.app')) return true;
  if (/(^|\/)checkouts?(\/|$)/i.test(u.pathname) || /\/cart\/checkout/i.test(u.pathname)) return true;
  if (/^\/cart\/?$/.test(u.pathname) && method === 'POST' && /(^|&)checkout(=|&|$)/i.test(postData ?? '')) return true;
  if (u.searchParams.has('checkout')) return true;
  return false;
}

/** Close buttons of common cookie banners and newsletter popups (Klaviyo, Privy, OneTrust, Shopify consent). */
const CLOSE_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#shopify-pc__banner__btn-accept',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  'button.klaviyo-close-form',
  '[aria-label="Close dialog"]',
  '[role="dialog"] [aria-label*="close" i]',
  '[aria-modal="true"] [aria-label*="close" i]',
  'button:has-text("No thanks")',
  'button:has-text("No, thanks")',
  '[class*="popup" i] [class*="close" i]',
  '[class*="modal" i] [class*="close" i]',
];

async function firstVisible(loc: Locator, max = 4): Promise<Locator | null> {
  const n = Math.min(await loc.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function safeText(el: Locator): Promise<string> {
  const [text, aria, name, value] = await Promise.all([
    el.innerText({ timeout: 500 }).catch(() => ''),
    el.getAttribute('aria-label', { timeout: 500 }).catch(() => ''),
    el.getAttribute('name', { timeout: 500 }).catch(() => ''),
    el.getAttribute('value', { timeout: 500 }).catch(() => ''),
  ]);
  return [text, aria, name, value].filter(Boolean).join(' ');
}

class PlaywrightStorePage implements StorePage {
  constructor(private readonly page: Page) {}

  async goto(url: string): Promise<string> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await this.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    return this.page.url();
  }

  async dismissPopups(tries: number): Promise<number> {
    let closed = 0;
    for (let t = 0; t < tries; t++) {
      let hit = false;
      for (const sel of CLOSE_SELECTORS) {
        const el = await firstVisible(this.page.locator(sel));
        if (!el || UNSAFE_TEXT.test(await safeText(el))) continue;
        if (await el.click({ timeout: 1000 }).then(() => true, () => false)) {
          closed++;
          hit = true;
          break;
        }
      }
      if (!hit) break;
      await this.page.waitForTimeout(400);
    }
    return closed;
  }

  async clickAddToCart(variantId: string, quantity: number): Promise<ClickResult> {
    const forms = this.page.locator('form[action*="/cart/add"]');
    const n = Math.min(await forms.count(), 8);
    let mismatch = false;
    for (let i = 0; i < n; i++) {
      const form = forms.nth(i);
      const btn = await firstVisible(form.locator('button[type="submit"], input[type="submit"], button[name="add"]'));
      if (!btn || UNSAFE_TEXT.test(await safeText(btn))) continue;
      if (await btn.isDisabled().catch(() => true)) continue;
      // Only the form for OUR variant (quick-add forms for other products share the action).
      const id = await form.locator('[name="id"]').first().inputValue({ timeout: 1000 }).catch(() => null);
      if (id && id !== variantId) {
        mismatch = true;
        continue;
      }
      if (quantity > 1) {
        const formId = await form.getAttribute('id').catch(() => null);
        const qty = (await firstVisible(form.locator('input[name="quantity"]'))) ?? (formId ? await firstVisible(this.page.locator(`input[name="quantity"][form="${formId}"]`)) : null);
        // The quantity field is the only thing we ever type into.
        if (qty) await qty.fill(String(quantity), { timeout: 1000 }).catch(() => {});
      }
      await btn.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await btn.click({ timeout: 3000 });
      return 'clicked';
    }
    if (!n) {
      const btn = await firstVisible(this.page.locator('button[name="add"]'));
      if (btn && !UNSAFE_TEXT.test(await safeText(btn)) && !(await btn.isDisabled().catch(() => true))) {
        await btn.click({ timeout: 3000 });
        return 'clicked';
      }
    }
    return mismatch ? 'variant-mismatch' : 'no-button';
  }

  async addViaCartApi(variantId: string, quantity: number): Promise<void> {
    const res = await this.page.evaluate(
      async ({ id, qty }) => {
        const r = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: [{ id, quantity: qty }] }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      },
      { id: Number(variantId), qty: quantity },
    );
    if (res.status < 200 || res.status >= 300) {
      let why = res.body;
      try {
        const j = JSON.parse(res.body) as { description?: string; message?: string };
        why = j.description ?? j.message ?? why;
      } catch {
        // keep the raw body
      }
      throw new Error(`/cart/add.js ${res.status}: ${why}`);
    }
  }

  async readCart(): Promise<unknown> {
    return this.page.evaluate(async () => {
      const r = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      return r.json();
    });
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, timeout: 5000 });
  }

  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}

class PlaywrightStoreBrowser implements StoreBrowser {
  constructor(
    private readonly context: BrowserContext,
    private readonly closeAll: () => Promise<void>,
  ) {}

  async newPage(): Promise<StorePage> {
    const page = await this.context.newPage();
    page.setDefaultTimeout(10_000);
    // Native dialogs (alert/confirm) would block the run: dismiss them.
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    return new PlaywrightStorePage(page);
  }

  close(): Promise<void> {
    return this.closeAll();
  }
}

export async function launchStoreBrowser(opts: LaunchOptions = {}): Promise<StoreBrowser> {
  const headless = process.env.CART_AGENT_HEADLESS === '1' ? true : (opts.headless ?? false);
  const browser = await chromium.launch({ headless, slowMo: opts.slowMo ?? 300 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'en-US' });
  // Network-level guard: abort any navigation into checkout. Only checkout-looking URLs and /cart are routed,
  // so normal page loads keep the HTTP cache; assets such as /checkouts/internal/preloads.js still load.
  await context.route(
    (u) => isCheckoutNavigation(u.href) || /^\/cart\/?$/.test(u.pathname),
    (route) => {
      const r = route.request();
      if (r.isNavigationRequest() && isCheckoutNavigation(r.url(), r.method(), r.postData())) return route.abort('blockedbyclient');
      return route.fallback();
    },
  );
  return new PlaywrightStoreBrowser(context, async () => {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  });
}

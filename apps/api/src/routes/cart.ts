// [Rahim] POST /units/:id/fixkit/cart -> { jobId, events } (202): the cart agent opens a VISIBLE Chromium on the
//   machine running the API, and for each seller in the stored fixkit.json shows the store, the product page,
//   adds the picked variant to the cart and stops on the store's /cart page (one tab per seller, left open).
//   It never checks out. Progress streams on GET /jobs/:jobId/events: `progress` (stage "cart"), `cart` (one per
//   step, with a feed line and a screenshot URL), then `done` { carts } or `error`.
//   ?wait=1 runs inline and returns { carts } (200). Body (optional JSON): { sellers?: string[], maxSellers?: number }.
//   409 if no fix kit yet or a run is already in progress. A new run closes the previous run's browser.
// GET  /units/:id/fixkit/cart              -> the last run's { createdAt, carts } (404 until a run)
// GET  /units/:id/fixkit/cart/shots/:file  -> a screenshot (PNG)
// POST /units/:id/fixkit/cart/close        -> closes the agent's browser window
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { describeCartEvent, fillCarts, launchStoreBrowser, type CartEvent, type CartResult, type StoreBrowser } from '@ledger/cart-agent';
import { FixKitSchema } from '@ledger/pipeline';
import type { Deps } from '../deps.js';
import type { CartSummary } from '../events.js';
import { HttpError } from '../storage.js';
import { loadUnit, paths } from '../units.js';

const BodySchema = z
  .object({
    sellers: z.array(z.string().min(1)).max(50).optional(),
    maxSellers: z.number().int().min(0).max(50).optional(),
  })
  .strict();

const StoredSchema = z.object({ createdAt: z.string(), carts: z.array(z.record(z.string(), z.unknown())) });
const SHOT_RE = /^[a-z0-9-]{1,80}\.png$/;

export interface CartRouteOptions {
  /** Test seam: a fake browser. Default: Playwright Chromium, headed (CART_AGENT_HEADLESS=1 for headless). */
  launch?: () => Promise<StoreBrowser>;
  timeboxMs?: number;
}

export function cartRoutes(d: Deps, opts: CartRouteOptions = {}) {
  const r = new Hono();
  let running = false;
  let closeBrowser: (() => Promise<void>) | null = null;

  const dirs = (unitId: string) => {
    const dir = paths(d.storage, unitId).dir;
    return { json: join(dir, 'cart.json'), shots: join(dir, 'cart-shots'), kit: join(dir, 'fixkit.json') };
  };
  const shotUrl = (unitId: string, path?: string) => (path ? `/units/${unitId}/fixkit/cart/shots/${basename(path)}` : undefined);
  const summary = (unitId: string, c: CartResult): CartSummary => {
    const screenshot = shotUrl(unitId, c.screenshot);
    return {
      seller: c.seller,
      shop: c.shop,
      cartUrl: c.cartUrl,
      verified: c.verified,
      itemCount: c.itemCount,
      subtotal: c.subtotal,
      currency: c.currency,
      lines: c.lines.map((l) => ({ title: l.title, quantity: l.quantity, ...(l.via ? { via: l.via } : {}), ...(l.error ? { error: l.error } : {}) })),
      ...(screenshot ? { screenshot } : {}),
      ...(c.error ? { error: c.error } : {}),
      ...(c.fallbackUrl ? { fallbackUrl: c.fallbackUrl } : {}),
    };
  };

  r.post('/:id/fixkit/cart', async (c) => {
    const unitId = c.req.param('id');
    await loadUnit(d.storage, unitId);
    const f = dirs(unitId);
    const kit = await d.storage.readJson(f.kit, FixKitSchema);
    if (!kit) throw new HttpError(409, 'no fix kit yet: POST /units/:id/fixkit first');
    const raw = (c.req.header('content-type') ?? '').includes('application/json') ? await c.req.json().catch(() => undefined) : {};
    const body = BodySchema.safeParse(raw ?? {});
    if (!body.success) throw new HttpError(400, `bad body: ${body.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
    if (running) throw new HttpError(409, 'the cart agent is already running');
    running = true;

    const jobId = `cart-${randomUUID().slice(0, 8)}`;
    d.jobs.create(jobId, unitId, 'cart');
    const run = async (): Promise<CartSummary[]> => {
      try {
        d.jobs.setStatus(jobId, 'running');
        // One agent window at a time: close the previous run's tabs.
        await closeBrowser?.().catch(() => {});
        closeBrowser = null;
        const onEvent = (e: CartEvent) => {
          const shown = 'screenshot' in e && e.screenshot ? { ...e, screenshot: shotUrl(unitId, e.screenshot) } : e;
          d.jobs.emit(jobId, { type: 'progress', stage: 'cart', done: e.done, total: e.total });
          d.jobs.emit(jobId, { type: 'cart', event: shown as CartEvent, text: describeCartEvent(e) });
        };
        const { carts, close } = await fillCarts(kit, {
          launch: opts.launch ?? (() => launchStoreBrowser()),
          onEvent,
          screenshotDir: f.shots,
          ...(body.data.sellers ? { sellers: body.data.sellers } : {}),
          ...(body.data.maxSellers !== undefined ? { maxSellers: body.data.maxSellers } : {}),
          ...(opts.timeboxMs ? { timeboxMs: opts.timeboxMs } : {}),
        });
        closeBrowser = close;
        const out = carts.map((x) => summary(unitId, x));
        await d.storage.writeJson(f.json, { createdAt: new Date().toISOString(), carts: out });
        d.jobs.emit(jobId, { type: 'done', result: { carts: out } });
        return out;
      } finally {
        running = false;
      }
    };

    if (c.req.query('wait') === '1') {
      try {
        return c.json({ carts: await run() });
      } catch (err) {
        d.jobs.emit(jobId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
    void run().catch((err: unknown) => d.jobs.emit(jobId, { type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return c.json({ jobId, events: `/jobs/${jobId}/events` }, 202);
  });

  r.get('/:id/fixkit/cart', async (c) => {
    const unitId = c.req.param('id');
    await loadUnit(d.storage, unitId);
    const stored = await d.storage.readJson(dirs(unitId).json, StoredSchema);
    if (!stored) throw new HttpError(404, 'no cart run yet: POST /units/:id/fixkit/cart');
    return c.json(stored);
  });

  r.get('/:id/fixkit/cart/shots/:file', async (c) => {
    const unitId = c.req.param('id');
    const file = c.req.param('file');
    if (!SHOT_RE.test(file)) throw new HttpError(400, 'bad screenshot name');
    await loadUnit(d.storage, unitId);
    const data = await readFile(join(dirs(unitId).shots, file)).catch(() => null);
    if (!data) throw new HttpError(404, 'screenshot not found');
    return c.body(new Uint8Array(data), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  });

  r.post('/:id/fixkit/cart/close', async (c) => {
    await loadUnit(d.storage, c.req.param('id'));
    const had = !!closeBrowser;
    await closeBrowser?.().catch(() => {});
    closeBrowser = null;
    return c.json({ closed: had });
  });

  return r;
}

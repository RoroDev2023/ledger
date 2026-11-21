import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoreBrowser } from '@ledger/cart-agent';
import type { FixKit } from '@ledger/pipeline';
import { createApp } from '../src/app.js';
import { mockPipeline } from '../src/pipeline.js';
import { cartRoutes } from '../src/routes/cart.js';
import { jobRoutes } from '../src/routes/jobs.js';
import { HttpError } from '../src/storage.js';

let dir: string;
let main: ReturnType<typeof createApp>;
let app: Hono;
let closed = 0;

/** A store whose button always works; cart in memory per origin. No real browser. */
const fakeLaunch = async (): Promise<StoreBrowser> => ({
  async newPage() {
    let origin = '';
    const cart = new Map<string, number>();
    return {
      async goto(url: string) {
        origin = new URL(url).origin;
        return url;
      },
      dismissPopups: async () => 0,
      async clickAddToCart(id: string, qty: number) {
        cart.set(id, (cart.get(id) ?? 0) + qty);
        return 'clicked' as const;
      },
      async addViaCartApi() {},
      async readCart() {
        const items = [...cart].map(([id, quantity]) => ({ variant_id: Number(id), quantity }));
        return { item_count: items.reduce((s, i) => s + i.quantity, 0), total_price: 249 * items.length, currency: 'USD', items, origin };
      },
      screenshot: async () => {},
      pause: async () => {},
    };
  },
  close: async () => void closed++,
});

const KIT: FixKit = {
  createdAt: '2026-11-21T00:00:00Z',
  items: [
    {
      key: 'k1',
      need: 'replacement-fixture',
      needLabel: 'replacement fixture',
      product: { id: 'gid://shopify/Product/1', title: 'Cabinet Knob' },
      variant: { id: 'gid://shopify/ProductVariant/39354942324817', options: [] },
      price: 2.49,
      seller: { name: 'Cosmas', domain: 'cosmas-hardware.myshopify.com' },
      url: 'https://cosmas-hardware.com/products/knob?variant=39354942324817&_gsid=X',
      quantity: 1,
      lineTotal: 2.49,
      confidence: 0.9,
      pickedBy: 'decisions',
      needsChoice: false,
      alternatives: [],
      query: 'cabinet knob',
      confirmed: true,
      forDiffItem: { surfaceId: 'bedroom.wall-w', issueType: 'missing-fixture', deductionUsd: 120 },
    },
  ],
  checkouts: [],
  missing: [],
  uncovered: [],
  warnings: [],
  diyTotal: 2.49,
  deductionTotal: 120,
  savings: 117.51,
  complete: true,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-api-cart-'));
  main = createApp({ dataDir: dir, pipeline: mockPipeline({ stepMs: 0 }) });
  app = new Hono();
  app.route('/units', cartRoutes(main.deps, { launch: fakeLaunch }));
  app.route('/jobs', jobRoutes(main.deps));
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500)));
  const fd = new FormData();
  fd.set('plan', new File([new Uint8Array([1, 2, 3])], 'plan.png'));
  fd.set('unitId', 'cart');
  expect((await main.app.request('/units', { method: 'POST', body: fd })).status).toBe(201);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Ev = { type: string; stage?: string; text?: string; event?: { step: string; screenshot?: string }; result?: { carts?: unknown[] } };

describe('POST /units/:id/fixkit/cart', () => {
  it('409 before a fix kit exists; GET 404 before a run', async () => {
    expect((await app.request('/units/cart/fixkit/cart', { method: 'POST' })).status).toBe(409);
    expect((await app.request('/units/cart/fixkit/cart')).status).toBe(404);
  });

  it('job: progress + cart steps with feed lines, then done { carts }; GET returns the run', async () => {
    await main.deps.storage.writeJson(join(main.deps.storage.unitDir('cart'), 'fixkit.json'), KIT);
    const res = await app.request('/units/cart/fixkit/cart', { method: 'POST' });
    expect(res.status).toBe(202);
    const { jobId, events } = (await res.json()) as { jobId: string; events: string };
    const text = await (await app.request(events)).text();
    const evs = text
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l.length > 6)
      .map((l) => JSON.parse(l.slice(6)) as Ev);
    expect(jobId).toMatch(/^cart-/);
    expect(evs.filter((e) => e.type === 'cart').map((e) => e.event?.step)).toEqual(['start', 'opening', 'product', 'added', 'cart', 'cart-verified', 'done']);
    expect(evs.filter((e) => e.type === 'cart').map((e) => e.text)).toContain('cart verified at Cosmas, 1 item, $2.49');
    expect(evs.some((e) => e.type === 'progress' && e.stage === 'cart')).toBe(true);
    expect(evs.at(-1)?.type).toBe('done');
    expect(evs.at(-1)?.result?.carts).toEqual([
      expect.objectContaining({ seller: 'Cosmas', cartUrl: 'https://cosmas-hardware.com/cart', verified: true, itemCount: 1, subtotal: 2.49, lines: [{ title: 'Cabinet Knob', quantity: 1, via: 'button' }] }),
    ]);
    const stored = (await (await app.request('/units/cart/fixkit/cart')).json()) as { carts: unknown[] };
    expect(stored.carts).toHaveLength(1);
  });

  it('?wait=1 returns { carts } and closes the previous run’s browser first', async () => {
    const before = closed;
    const res = await app.request('/units/cart/fixkit/cart?wait=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxSellers: 1 }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { carts: { verified: boolean }[] };
    expect(body.carts.map((c) => c.verified)).toEqual([true]);
    expect(closed).toBe(before + 1);
    expect(((await (await app.request('/units/cart/fixkit/cart/close', { method: 'POST' })).json()) as { closed: boolean }).closed).toBe(true);
  });

  it('rejects a bad body and bad screenshot names', async () => {
    const res = await app.request('/units/cart/fixkit/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkout: true }) });
    expect(res.status).toBe(400);
    expect((await app.request('/units/cart/fixkit/cart/shots/..%2Fplan.json')).status).toBe(400);
    expect((await app.request('/units/cart/fixkit/cart/shots/01-x-cart.png')).status).toBe(404);
  });
});

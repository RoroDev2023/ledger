import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCalls } from '@ledger/gemini';
import {
  ShopRpcError,
  ShopToolError,
  ShopToolNotAllowedError,
  callTool,
  createCheckout,
  getProduct,
  searchCatalog,
  type ShopTool,
} from '../src/index.js';

interface Seen {
  headers: IncomingMessage['headers'];
  body: { jsonrpc: string; id: number; method: string; params: { name: string; arguments: Record<string, unknown>; _meta: Record<string, unknown> } };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Local stand-in for https://mcp.shop.com/. `handle` returns [status, json]. */
async function fakeShop(handle: (s: Seen, n: number) => [number, unknown]) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const s: Seen = { headers: req.headers, body: JSON.parse(data) as Seen['body'] };
      seen.push(s);
      const [status, json] = handle(s, seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return { url: `http://127.0.0.1:${port}/`, seen };
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SHOP_MODE: 'live',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'ledger-shop-')),
    SHOP_FIXTURES_DIR: mkdtempSync(join(tmpdir(), 'ledger-shop-fx-')),
    SHOP_BACKOFF_MS: '1',
    SHOP_MAX_RETRY_WAIT_MS: '5',
    ...extra,
  };
}

const ok = (id: number, doc: unknown) => ({ jsonrpc: '2.0', id, result: { resultType: 'complete', isError: false, content: [{ type: 'text', text: JSON.stringify(doc) }], structuredContent: doc } });
const SEARCH_DOC = {
  products: [
    {
      id: 'gid://shopify/p/1',
      title: 'Touch Up Paint',
      variants: [
        {
          id: 'gid://shopify/ProductVariant/11',
          price: { amount: 1299, currency: 'USD' },
          availability: { available: true },
          url: 'https://paint.example/p?variant=11',
          seller: { name: 'Paint Co', domain: 'paint.myshopify.com' },
        },
      ],
    },
  ],
  messages: [],
};

describe('Shop MCP request shape (docs/vendor/shop-quickstart.md)', () => {
  it('sends the documented headers, JSON-RPC body and params._meta', async () => {
    const api = await fakeShop((s) => [200, ok(s.body.id, SEARCH_DOC)]);
    const e = env({ SHOP_MCP_URL: api.url });
    const doc = await searchCatalog({ query: 'wall touch up paint', country: 'US', currency: 'USD', maxPriceMinor: 4000, limit: 10 }, { env: e });
    expect(doc.products[0]!.variants[0]!.price.amount).toBe(1299);

    const s = api.seen[0]!;
    expect(s.headers['content-type']).toBe('application/json');
    expect(s.headers.accept).toBe('application/json, text/event-stream');
    expect(s.headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(s.headers['mcp-method']).toBe('tools/call');
    expect(s.headers['mcp-name']).toBe('search_catalog');
    expect(s.headers.authorization).toBeUndefined();
    expect(s.body.jsonrpc).toBe('2.0');
    expect(s.body.method).toBe('tools/call');
    expect(s.body.params.name).toBe(s.headers['mcp-name']);
    expect(s.body.params._meta).toEqual({
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'ledger-fixkit', version: '0.1.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    });
    expect(s.body.params.arguments).toEqual({
      catalog: {
        query: 'wall touch up paint',
        context: { address_country: 'US', currency: 'USD' },
        filters: { price: { max: 4000 } },
        pagination: { limit: 10 },
      },
    });
  });

  it('get_product and create_checkout arguments (shop-search.md, shop-checkout.md)', async () => {
    const api = await fakeShop((s) =>
      s.body.params.name === 'get_product'
        ? [200, ok(s.body.id, { product: SEARCH_DOC.products[0] })]
        : [200, ok(s.body.id, { id: 'gid://shopify/Checkout/abc?key=secret', status: 'incomplete', continue_url: 'https://paint.example/checkouts/abc?key=secret', messages: [] })],
    );
    const e = env({ SHOP_MCP_URL: api.url });
    await getProduct({ id: 'gid://shopify/p/1', country: 'US', currency: 'USD' }, { env: e });
    const co = await createCheckout({ shop: 'paint.myshopify.com', lines: [{ variantId: 'gid://shopify/ProductVariant/11', quantity: 2 }], country: 'US' }, { env: e });
    expect(co.continue_url).toContain('https://paint.example/checkouts/abc');

    expect(api.seen[0]!.body.params.arguments).toEqual({ catalog: { id: 'gid://shopify/p/1', context: { address_country: 'US', currency: 'USD' } } });
    const args = api.seen[1]!.body.params.arguments as { shop: string; checkout: unknown; meta: Record<string, string> };
    expect(args.shop).toBe('paint.myshopify.com');
    expect(args.checkout).toEqual({ line_items: [{ item: { id: 'gid://shopify/ProductVariant/11' }, quantity: 2 }], context: { address_country: 'US' } });
    expect(args.meta['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);

    // The call log never holds continue_url or the checkout id.
    const log = readFileSync(join(e.DATA_DIR!, 'calls.jsonl'), 'utf8');
    expect(log).not.toContain('secret');
    const calls = readCalls(e);
    expect(calls.map((c) => c.tag)).toEqual(['shop.get_product', 'shop.create_checkout']);
    expect(calls.every((c) => c.model === 'shop-mcp' && c.endpoint === 'shop' && c.questions === 0 && c.ok && c.source === 'live')).toBe(true);
  });
});

describe('errors and retries (docs/vendor/shop-errors.md)', () => {
  it('JSON-RPC error on HTTP 400 -> ShopRpcError, not retried', async () => {
    const api = await fakeShop((s) => [400, { jsonrpc: '2.0', id: s.body.id, error: { code: -32602, message: '$.catalog.pagination.limit: maximum constraint failed' } }]);
    const e = env({ SHOP_MCP_URL: api.url });
    await expect(searchCatalog({ query: 'x', country: 'US', currency: 'USD', limit: 51 }, { env: e })).rejects.toBeInstanceOf(ShopRpcError);
    expect(api.seen).toHaveLength(1);
    expect(readCalls(e)[0]).toMatchObject({ tag: 'shop.search_catalog', ok: false });
  });

  it('isError result -> ShopToolError with the _meta code', async () => {
    const api = await fakeShop((s) => [
      200,
      { jsonrpc: '2.0', id: s.body.id, result: { isError: true, content: [{ type: 'text', text: 'Product not found' }], structuredContent: { ucp: { status: 'error' }, messages: [{ type: 'error', code: 'not_found', content: 'Product not found' }] } } },
    ]);
    const err = await getProduct({ id: 'nope', country: 'US', currency: 'USD' }, { env: env({ SHOP_MCP_URL: api.url }) }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ShopToolError);
    expect((err as ShopToolError).code).toBe('not_found');
    expect(api.seen).toHaveLength(1);
  });

  it('reads retry on rate_limited and 5xx, then succeed', async () => {
    const api = await fakeShop((s, n) =>
      n === 1
        ? [200, { jsonrpc: '2.0', id: s.body.id, result: { isError: true, content: [{ type: 'text', text: 'rate-limited' }], _meta: { 'com.shopify/error': { code: 'rate_limited', retry_after: 30 } } } }]
        : n === 2
          ? [503, { oops: true }]
          : [200, ok(s.body.id, SEARCH_DOC)],
    );
    const doc = await searchCatalog({ query: 'paint', country: 'US', currency: 'USD' }, { env: env({ SHOP_MCP_URL: api.url }) });
    expect(doc.products).toHaveLength(1);
    expect(api.seen).toHaveLength(3);
  });

  it('create_checkout is not retried on 5xx (the write may have happened), but is on rate_limited with the same key', async () => {
    const api5 = await fakeShop(() => [503, {}]);
    await expect(createCheckout({ shop: 's.myshopify.com', lines: [{ variantId: 'v', quantity: 1 }], country: 'US' }, { env: env({ SHOP_MCP_URL: api5.url }) })).rejects.toThrow(/HTTP 503/);
    expect(api5.seen).toHaveLength(1);

    const api = await fakeShop((s, n) =>
      n === 1
        ? [200, { jsonrpc: '2.0', id: s.body.id, result: { isError: true, content: [{ type: 'text', text: 'slow down' }], _meta: { 'com.shopify/error': { code: 'rate_limited' } } } }]
        : [200, ok(s.body.id, { id: 'c1', status: 'incomplete', continue_url: 'https://x.example/c', messages: [] })],
    );
    await createCheckout({ shop: 's.myshopify.com', lines: [{ variantId: 'v', quantity: 1 }], country: 'US' }, { env: env({ SHOP_MCP_URL: api.url }) });
    expect(api.seen).toHaveLength(2);
    const key = (s: Seen) => (s.body.params.arguments.meta as Record<string, string>)['idempotency-key'];
    expect(key(api.seen[0]!)).toBe(key(api.seen[1]!));
  });

  it('refuses complete_checkout (and any other tool) before touching the network', async () => {
    const api = await fakeShop((s) => [200, ok(s.body.id, {})]);
    const e = env({ SHOP_MCP_URL: api.url });
    await expect(callTool('complete_checkout' as ShopTool, { shop: 's', id: 'c' }, { env: e })).rejects.toBeInstanceOf(ShopToolNotAllowedError);
    expect(api.seen).toHaveLength(0);
  });
});

describe('SHOP_MODE=mock / record / replay', () => {
  it('mock is deterministic, offline, available, under the cap, and logged as mock', async () => {
    const e = env({ SHOP_MODE: 'mock', SHOP_MCP_URL: 'http://127.0.0.1:9/' });
    const a = await searchCatalog({ query: 'spackle', country: 'US', currency: 'USD', maxPriceMinor: 1500 }, { env: e });
    const b = await searchCatalog({ query: 'spackle', country: 'US', currency: 'USD', maxPriceMinor: 1500 }, { env: e });
    expect(a).toEqual(b);
    expect(a.products.length).toBeGreaterThan(2);
    for (const p of a.products) {
      const v = p.variants[0]!;
      expect(v.availability?.available).toBe(true);
      expect(v.price.currency).toBe('USD');
      expect(v.price.amount).toBeLessThanOrEqual(1500);
    }
    const co = await createCheckout({ shop: a.products[0]!.variants[0]!.seller!.domain, lines: [{ variantId: a.products[0]!.variants[0]!.id, quantity: 1 }], country: 'US' }, { env: e });
    expect(co.continue_url).toMatch(/^https:\/\/checkout\.mock\.invalid\//);
    expect(readCalls(e).every((c) => c.source === 'mock')).toBe(true);
  });

  it('record saves reads (not checkouts); replay and mock serve them', async () => {
    const api = await fakeShop((s) =>
      s.body.params.name === 'search_catalog' ? [200, ok(s.body.id, SEARCH_DOC)] : [200, ok(s.body.id, { id: 'c', status: 'incomplete', continue_url: 'https://x.example/c?key=k', messages: [] })],
    );
    const e = env({ SHOP_MODE: 'record', SHOP_MCP_URL: api.url });
    await searchCatalog({ query: 'wall touch up paint', country: 'US', currency: 'USD' }, { env: e });
    await createCheckout({ shop: 's', lines: [{ variantId: 'v', quantity: 1 }], country: 'US' }, { env: e });

    const replay = { ...e, SHOP_MODE: 'replay' };
    const doc = await searchCatalog({ query: 'wall touch up paint', country: 'US', currency: 'USD' }, { env: replay });
    expect(doc.products[0]!.title).toBe('Touch Up Paint');
    await expect(createCheckout({ shop: 's', lines: [{ variantId: 'v', quantity: 1 }], country: 'US' }, { env: replay })).rejects.toThrow(/no recording/);

    // mock: closest recorded query by shared words
    const mock = await searchCatalog({ query: 'interior touch up paint, eggshell', country: 'US', currency: 'USD' }, { env: { ...e, SHOP_MODE: 'mock' } });
    expect(mock.products[0]!.title).toBe('Touch Up Paint');
    expect(api.seen).toHaveLength(2);
  });
});

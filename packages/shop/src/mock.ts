// [Rahim] SHOP_MODE=mock / record / replay fixtures. Deterministic: the same request always gets the same answer.
//   fixtures/<tool>/<key>.json     { tool, key, arguments, savedAt, result }   key = sha256(tool + arguments minus meta)
//   mock search miss               -> the recorded search whose query shares the most words, else a synthesized catalog
//   mock get_product / checkout    -> recorded / synthesized, never the network
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestKey } from '@ledger/gemini';
import { shopFixturesDir } from './env.js';

export interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RecordedCall {
  tool: string;
  key: string;
  arguments: Record<string, unknown>;
  savedAt: string;
  result: ToolResult;
}

/** Arguments without `meta` (the idempotency key is new on every write and must not change the key). */
export function fixtureKey(tool: string, args: Record<string, unknown>): string {
  const { meta: _meta, ...rest } = args;
  void _meta;
  return requestKey(tool, rest);
}

function fixturePath(tool: string, key: string, env: NodeJS.ProcessEnv): string {
  return join(shopFixturesDir(env), tool, `${key}.json`);
}

export function readFixture(tool: string, key: string, env: NodeJS.ProcessEnv = process.env): RecordedCall | undefined {
  const p = fixturePath(tool, key, env);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RecordedCall;
  } catch {
    return undefined;
  }
}

export function writeFixture(rec: RecordedCall, env: NodeJS.ProcessEnv = process.env): void {
  const p = fixturePath(rec.tool, rec.key, env);
  mkdirSync(join(p, '..'), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  renameSync(tmp, p);
}

function listFixtures(tool: string, env: NodeJS.ProcessEnv): RecordedCall[] {
  const dir = join(shopFixturesDir(env), tool);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as RecordedCall];
      } catch {
        return [];
      }
    });
}

// ---------------------------------------------------------------------------------------------

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
const catalogOf = (args: Record<string, unknown>) => (args.catalog ?? {}) as Record<string, unknown>;

function seed(...parts: string[]): number {
  return createHash('sha256').update(parts.join('\u0000')).digest().readUInt32LE(0);
}
function rng(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_SELLERS = [
  { id: 'gid://shopify/Shop/mock-1', name: 'Mock Paint Supply', url: 'https://paint-supply.mock.invalid', domain: 'paint-supply.mock.invalid' },
  { id: 'gid://shopify/Shop/mock-2', name: 'Mock Hardware Co.', url: 'https://hardware.mock.invalid', domain: 'hardware.mock.invalid' },
  { id: 'gid://shopify/Shop/mock-3', name: 'Mock Home Goods', url: 'https://home-goods.mock.invalid', domain: 'home-goods.mock.invalid' },
];
const FLAVORS = ['Pro', 'Classic', 'Quick-Dry', 'Value Pack', 'Premium', 'Compact'];

/** Products synthesized in this process, so mock get_product can find them again. */
const synthesized = new Map<string, Record<string, unknown>>();

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** A deterministic search result for any query: 6 products across 3 mock sellers, priced under the cap. */
export function synthSearch(args: Record<string, unknown>): ToolResult {
  const cat = catalogOf(args);
  const query = String(cat.query ?? 'item');
  const ctx = (cat.context ?? {}) as { currency?: string };
  const currency = ctx.currency ?? 'USD';
  const cap = ((cat.filters as { price?: { max?: number } } | undefined)?.price?.max ?? 3000) as number;
  const limit = Math.min(Number((cat.pagination as { limit?: number } | undefined)?.limit ?? 10), 6);
  const r = rng(seed(query, currency, String(cap)));
  const h = seed(query).toString(16);
  const products = Array.from({ length: limit }, (_, i) => {
    const seller = MOCK_SELLERS[i % MOCK_SELLERS.length]!;
    const amount = Math.max(99, Math.round((cap * (0.3 + 0.65 * r())) / 100) * 100 - 1);
    const pid = `gid://shopify/p/mock-${h}-${i}`;
    const vid = `gid://shopify/ProductVariant/mock-${h}-${i}`;
    const title = `${titleCase(query)} ${FLAVORS[i % FLAVORS.length]}`;
    const product = {
      id: pid,
      title,
      options: [{ name: 'Size', values: [{ label: 'Standard' }] }],
      price_range: { min: { amount, currency }, max: { amount, currency } },
      variants: [
        {
          id: vid,
          options: [{ name: 'Size', label: 'Standard' }],
          price: { amount, currency },
          availability: { available: true },
          url: `${seller.url}/products/mock-${h}-${i}?variant=${i}`,
          seller,
        },
      ],
    };
    synthesized.set(pid, product);
    return product;
  });
  return wrap({ ucp: { version: 'mock' }, products, messages: [{ type: 'info', code: 'mock', content: 'SHOP_MODE=mock: synthesized catalog, not real products.' }], pagination: { has_next_page: false, total_count: products.length } });
}

function wrap(doc: unknown): ToolResult {
  return { resultType: 'complete', isError: false, content: [{ type: 'text', text: JSON.stringify(doc) }], structuredContent: doc };
}

/** Mock answer for one tool call (no network). */
export function mockResult(tool: string, args: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): ToolResult {
  const exact = readFixture(tool, fixtureKey(tool, args), env);
  if (exact) return exact.result;

  if (tool === 'search_catalog') {
    const want = words(String(catalogOf(args).query ?? ''));
    let best: { rec: RecordedCall; score: number } | undefined;
    for (const rec of listFixtures('search_catalog', env)) {
      const have = words(String(catalogOf(rec.arguments).query ?? ''));
      const score = [...want].filter((w) => have.has(w)).length;
      if (score > 0 && (!best || score > best.score)) best = { rec, score };
    }
    return best ? best.rec.result : synthSearch(args);
  }

  if (tool === 'get_product') {
    const id = String(catalogOf(args).id ?? '');
    const known = synthesized.get(id);
    if (known) return wrap({ ucp: { version: 'mock' }, product: known });
    for (const rec of listFixtures('search_catalog', env)) {
      const doc = rec.result.structuredContent as { products?: { id: string }[] } | undefined;
      const p = doc?.products?.find((x) => x.id === id);
      if (p) return wrap({ ucp: { version: 'mock' }, product: p });
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `Product not found: ${id}` }],
      structuredContent: { ucp: { status: 'error' }, messages: [{ type: 'error', code: 'not_found', content: `Product not found: ${id}`, severity: 'unrecoverable' }] },
    };
  }

  if (tool === 'create_checkout') {
    const h = createHash('sha256').update(JSON.stringify(args.checkout ?? {})).update(String(args.shop)).digest('hex').slice(0, 16);
    const lines = ((args.checkout as { line_items?: { item: { id: string }; quantity: number }[] } | undefined)?.line_items ?? []).map((l, i) => ({
      id: `line-${i}`,
      item: l.item,
      quantity: l.quantity,
    }));
    return wrap({
      ucp: { version: 'mock' },
      id: `mock-checkout-${h}`,
      status: 'incomplete',
      currency: 'USD',
      line_items: lines,
      messages: [{ type: 'info', code: 'mock', content: 'SHOP_MODE=mock: not a real checkout.' }],
      continue_url: `https://checkout.mock.invalid/${String(args.shop)}/${h}`,
      expires_at: new Date(Date.UTC(2026, 10, 21, 23, 0, 0)).toISOString(),
    });
  }

  throw new Error(`mock: no stub for tool ${tool}`);
}

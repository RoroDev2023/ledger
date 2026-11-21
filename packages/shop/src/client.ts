// [Rahim] Shop MCP client: stateless JSON-RPC `tools/call` to https://mcp.shop.com/, no auth, no initialize.
// Wire format: docs/vendor/shop-quickstart.md. Arguments: shop-tools.md, shop-search.md, shop-checkout.md.
// Errors + retries: shop-errors.md. Every call is logged to the same calls.jsonl as packages/gemini (tag shop.*).
//
// Only three tools exist here. complete_checkout (pays and places an order) is deliberately not reachable:
// LEDGER hands the tenant the merchant's continue_url and never buys anything.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { logCall, type CallSource } from '@ledger/gemini';
import { CLIENT_INFO, MCP_PROTOCOL_VERSION, shopBackoffMs, shopMaxRetryWaitMs, shopMode, shopTimeoutMs, shopUrl } from './env.js';
import { fixtureKey, mockResult, readFixture, writeFixture, type ToolResult } from './mock.js';
import {
  CheckoutDocSchema,
  ProductDocSchema,
  SearchDocSchema,
  type CheckoutDoc,
  type ProductDoc,
  type SearchDoc,
} from './schemas.js';

/** The only tools this client will send. */
export const SHOP_TOOLS = ['search_catalog', 'get_product', 'create_checkout'] as const;
export type ShopTool = (typeof SHOP_TOOLS)[number];
const READ_ONLY: ReadonlySet<ShopTool> = new Set(['search_catalog', 'get_product']);

/** Logged as the call log's `model`. */
export const SHOP_MODEL = 'shop-mcp';

// ---------------------------------------------------------------------------------------------
// Errors

/** HTTP 400 with a JSON-RPC `error`: the request was rejected and no tool ran. Never retried. */
export class ShopRpcError extends Error {
  constructor(
    readonly tool: string,
    readonly code: number,
    readonly httpStatus: number,
    message: string,
  ) {
    super(`Shop MCP ${tool}: JSON-RPC ${code}: ${message}`);
    this.name = 'ShopRpcError';
  }
}

/** Any other non-2xx HTTP status (401/403/404/413/429/5xx). */
export class ShopHttpError extends Error {
  constructor(
    readonly tool: string,
    readonly status: number,
    body: string,
  ) {
    super(`Shop MCP ${tool}: HTTP ${status}: ${redact(body).slice(0, 300)}`);
    this.name = 'ShopHttpError';
  }
}

/** HTTP 200 with `result.isError: true`: the tool ran and failed. */
export class ShopToolError extends Error {
  constructor(
    readonly tool: string,
    /** `_meta["com.shopify/error"].code` (rate_limited, upstream_unavailable, …) or the first message code. */
    readonly code: string | undefined,
    /** Seconds, when the service gave one. */
    readonly retryAfter: number | undefined,
    text: string,
  ) {
    super(`Shop MCP ${tool}: ${code ?? 'tool error'}: ${redact(text).slice(0, 300)}`);
    this.name = 'ShopToolError';
  }
}

/** Not a shop tool we allow (e.g. complete_checkout). */
export class ShopToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`Shop MCP tool "${tool}" is not allowed: LEDGER only searches and opens checkouts, it never places orders.`);
    this.name = 'ShopToolNotAllowedError';
  }
}

/** Checkout IDs and continue_url carry an access key (shop-checkout.md): keep URLs and checkout IDs out of logs. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, '<url>').replace(/gid:\/\/shopify\/Checkout\/[^\s"']+/g, '<checkout-id>');
}

// ---------------------------------------------------------------------------------------------
// Transport

export interface ShopCallOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

let nextId = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The documented request: headers mirror the body's method and tool name (shop-quickstart.md). */
export function buildRequest(tool: string, args: Record<string, unknown>, id: number) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': tool,
    },
    body: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
  };
}

const RpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal('2.0').optional(),
    result: z.record(z.unknown()).optional(),
    error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** Shop answers with plain JSON; tolerate an SSE body (we Accept text/event-stream) by taking its last data line. */
function parseBody(text: string, contentType: string): unknown {
  if (contentType.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .at(-1);
    if (!data) throw new Error('empty event stream');
    return JSON.parse(data);
  }
  return JSON.parse(text);
}

async function postOnce(tool: string, args: Record<string, unknown>, opts: ShopCallOptions): Promise<ToolResult> {
  const env = opts.env ?? process.env;
  const req = buildRequest(tool, args, nextId++);
  const res = await (opts.fetchImpl ?? fetch)(shopUrl(env), {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(shopTimeoutMs(env)),
  });
  const text = await res.text();
  let parsed: z.infer<typeof RpcEnvelopeSchema> | undefined;
  try {
    parsed = RpcEnvelopeSchema.parse(parseBody(text, res.headers.get('content-type') ?? ''));
  } catch {
    parsed = undefined;
  }
  if (parsed?.error) throw new ShopRpcError(tool, parsed.error.code, res.status, parsed.error.message);
  if (!res.ok) throw new ShopHttpError(tool, res.status, text);
  if (!parsed?.result) throw new ShopHttpError(tool, res.status, `no JSON-RPC result: ${text.slice(0, 200)}`);
  return parsed.result as ToolResult;
}

/** Raise ShopToolError for `isError` results (shop-errors.md "Tool errors"). */
function checkResult(tool: string, r: ToolResult): void {
  const doc = r.structuredContent as { ucp?: { status?: string }; messages?: { type?: string; code?: string; content?: string }[] } | undefined;
  if (!r.isError && doc?.ucp?.status !== 'error') return;
  const meta = (r._meta?.['com.shopify/error'] ?? {}) as { code?: string; retry_after?: number };
  const firstError = doc?.messages?.find((m) => m.type === 'error');
  const text =
    r.content?.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n') ||
    doc?.messages?.map((m) => m.content).filter(Boolean).join('; ') ||
    'tool error';
  throw new ShopToolError(tool, meta.code ?? firstError?.code, typeof meta.retry_after === 'number' ? meta.retry_after : undefined, text);
}

/**
 * Retry policy (shop-errors.md "Retries"). Reads: HTTP 429/5xx, network errors and the "nothing ran" tool codes.
 * create_checkout: only when the docs say nothing ran (rate_limited, HTTP 429), resent with the same idempotency
 * key. Never after a timeout, a 5xx or ambiguous_outcome, because the write may have happened.
 */
function retryable(tool: ShopTool, e: unknown): boolean {
  if (e instanceof ShopRpcError || e instanceof ShopToolNotAllowedError) return false;
  const read = READ_ONLY.has(tool);
  if (e instanceof ShopHttpError) return e.status === 429 || (read && e.status >= 500);
  if (e instanceof ShopToolError) return e.code === 'rate_limited' || (read && e.code === 'upstream_unavailable');
  return read; // network error / timeout
}

export const SHOP_MAX_TRIES = 3;

export interface ShopCallResult {
  /** The tool's document (`structuredContent`, else the JSON in `content[0].text`). */
  doc: unknown;
  source: CallSource;
  latencyMs: number;
}

/** One logged tool call in the current SHOP_MODE. */
export async function callTool(tool: ShopTool, args: Record<string, unknown>, opts: ShopCallOptions = {}): Promise<ShopCallResult> {
  if (!(SHOP_TOOLS as readonly string[]).includes(tool)) throw new ShopToolNotAllowedError(tool);
  const env = opts.env ?? process.env;
  const mode = shopMode(env);
  const source: CallSource = mode === 'mock' ? 'mock' : mode === 'replay' ? 'replay' : 'live';
  const t0 = performance.now();
  const log = (ok: boolean, error?: string) =>
    logCall(
      { model: SHOP_MODEL, tag: `shop.${tool}`, latencyMs: performance.now() - t0, inTokens: 0, outTokens: 0, questions: 0, source, endpoint: 'shop', ok, ...(error ? { error: redact(error) } : {}) },
      env,
    );

  try {
    let result: ToolResult;
    if (mode === 'mock') {
      result = mockResult(tool, args, env);
      checkResult(tool, result);
    } else if (mode === 'replay') {
      const rec = readFixture(tool, fixtureKey(tool, args), env);
      if (!rec) throw new Error(`SHOP_MODE=replay: no recording for ${tool} (key ${fixtureKey(tool, args).slice(0, 12)}…). Record it with SHOP_MODE=record.`);
      result = rec.result;
      checkResult(tool, result);
    } else {
      result = await withRetries(tool, args, opts);
      if (mode === 'record' && READ_ONLY.has(tool)) {
        writeFixture({ tool, key: fixtureKey(tool, args), arguments: stripMeta(args), savedAt: new Date().toISOString(), result }, env);
      }
    }
    const doc = result.structuredContent ?? parseTextDoc(result);
    log(true);
    return { doc, source, latencyMs: performance.now() - t0 };
  } catch (e) {
    log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function withRetries(tool: ShopTool, args: Record<string, unknown>, opts: ShopCallOptions): Promise<ToolResult> {
  const env = opts.env ?? process.env;
  const base = shopBackoffMs(env);
  let last: unknown;
  for (let attempt = 1; attempt <= SHOP_MAX_TRIES; attempt++) {
    try {
      const r = await postOnce(tool, args, opts);
      checkResult(tool, r);
      return r;
    } catch (e) {
      last = e;
      if (attempt === SHOP_MAX_TRIES || !retryable(tool, e)) throw e;
      const after = e instanceof ShopToolError && e.retryAfter ? e.retryAfter * 1000 : 0;
      await sleep(Math.min(Math.max(after, base * 2 ** (attempt - 1)), shopMaxRetryWaitMs(env)));
    }
  }
  throw last;
}

function stripMeta(args: Record<string, unknown>): Record<string, unknown> {
  const { meta: _meta, ...rest } = args;
  void _meta;
  return rest;
}

function parseTextDoc(r: ToolResult): unknown {
  const text = r.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Shop MCP result has neither structuredContent nor text');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------------------------
// Typed tools

export interface SearchArgs {
  query: string;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  /** ISO 4217, e.g. "USD". Always set when filtering on price (shop-search.md). */
  currency: string;
  /** Per-unit price cap in minor units of `currency`. */
  maxPriceMinor?: number;
  /** 1–50, default 10. */
  limit?: number;
}

/**
 * search_catalog. Availability is left at the documented default (only buyable items are returned);
 * callers still check each variant's `availability`.
 */
export async function searchCatalog(a: SearchArgs, opts: ShopCallOptions = {}): Promise<SearchDoc> {
  const catalog: Record<string, unknown> = {
    query: a.query,
    context: { address_country: a.country, currency: a.currency },
    pagination: { limit: a.limit ?? 10 },
  };
  if (a.maxPriceMinor !== undefined) catalog.filters = { price: { max: a.maxPriceMinor } };
  const { doc } = await callTool('search_catalog', { catalog }, opts);
  return SearchDocSchema.parse(doc);
}

/** get_product: re-read one product (shop-search.md: call it again when the shopper picks a product). */
export async function getProduct(a: { id: string; country: string; currency: string }, opts: ShopCallOptions = {}): Promise<ProductDoc> {
  const { doc } = await callTool('get_product', { catalog: { id: a.id, context: { address_country: a.country, currency: a.currency } } }, opts);
  return ProductDocSchema.parse(doc);
}

export interface CheckoutLine {
  /** Variant ID exactly as search returned it. */
  variantId: string;
  quantity: number;
}

/**
 * create_checkout at one merchant (`shop` = the variant's seller.domain). Places no order: the tenant
 * reviews and pays on the merchant's page via `continue_url`. Sends a fresh idempotency key.
 */
export async function createCheckout(
  a: { shop: string; lines: CheckoutLine[]; country: string; idempotencyKey?: string },
  opts: ShopCallOptions = {},
): Promise<CheckoutDoc> {
  if (!a.lines.length) throw new Error('createCheckout: at least one line item is required');
  const args = {
    shop: a.shop,
    checkout: {
      line_items: a.lines.map((l) => ({ item: { id: l.variantId }, quantity: l.quantity })),
      context: { address_country: a.country },
    },
    meta: { 'idempotency-key': a.idempotencyKey ?? randomUUID() },
  };
  const { doc } = await callTool('create_checkout', args, opts);
  return CheckoutDocSchema.parse(doc);
}

/** What packages/pipeline takes as a dependency. There is intentionally no completeCheckout. */
export interface ShopClient {
  searchCatalog(a: SearchArgs): Promise<SearchDoc>;
  getProduct(a: { id: string; country: string; currency: string }): Promise<ProductDoc>;
  createCheckout(a: { shop: string; lines: CheckoutLine[]; country: string }): Promise<CheckoutDoc>;
}

export function shopClient(opts: ShopCallOptions = {}): ShopClient {
  return {
    searchCatalog: (a) => searchCatalog(a, opts),
    getProduct: (a) => getProduct(a, opts),
    createCheckout: (a) => createCheckout(a, opts),
  };
}

// [Rahim] SHOP_MODE and the Shop MCP endpoint. Request shapes: docs/vendor/shop-quickstart.md, shop-tools.md.
import { join } from 'node:path';

/**
 * live    real Shop MCP (https://mcp.shop.com/)
 * mock    no network: exact recorded fixture, else the recorded search closest to the query, else a
 *         deterministic synthesized catalog (default, like GEMINI_MODE)
 * record  live + save read-only tool responses to fixtures/ (never checkouts: their URLs carry an access key)
 * replay  exact recorded fixtures only; a miss is an error
 */
export type ShopMode = 'live' | 'mock' | 'record' | 'replay';
export const SHOP_MODES: readonly ShopMode[] = ['live', 'mock', 'record', 'replay'];

type Env = NodeJS.ProcessEnv;

export function shopMode(env: Env = process.env): ShopMode {
  const raw = (env.SHOP_MODE ?? 'mock').split('#')[0]!.trim().toLowerCase();
  if (!(SHOP_MODES as readonly string[]).includes(raw)) {
    throw new Error(`SHOP_MODE must be one of ${SHOP_MODES.join(' | ')}, got "${env.SHOP_MODE}"`);
  }
  return raw as ShopMode;
}

/** Shop MCP lives only at the root (shop-errors.md: 404 = wrong path). SHOP_MCP_URL points tests at a fake server. */
export function shopUrl(env: Env = process.env): string {
  return env.SHOP_MCP_URL?.trim() || 'https://mcp.shop.com/';
}

/** Fixtures for mock/record/replay (default packages/shop/fixtures). */
export function shopFixturesDir(env: Env = process.env): string {
  return env.SHOP_FIXTURES_DIR?.trim() || join(import.meta.dirname, '..', 'fixtures');
}

/** Base backoff between retries (tests set it to ~1 ms). */
export function shopBackoffMs(env: Env = process.env): number {
  return Number(env.SHOP_BACKOFF_MS ?? 1000);
}

/** Cap on a server-requested `retry_after` wait before we retry a read. */
export function shopMaxRetryWaitMs(env: Env = process.env): number {
  return Number(env.SHOP_MAX_RETRY_WAIT_MS ?? 10_000);
}

export function shopTimeoutMs(env: Env = process.env): number {
  return Number(env.SHOP_TIMEOUT_MS ?? 30_000);
}

/** MCP protocol version sent in the header and in params._meta (shop-quickstart.md). */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/** Our client name in params._meta. Names the software only; no user or project details. */
export const CLIENT_INFO = { name: 'ledger-fixkit', version: '0.1.0' } as const;

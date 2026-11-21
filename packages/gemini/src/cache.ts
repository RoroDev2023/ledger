// [Rahim] Disk cache in .data/cache/, same key as record/replay. p-limit(4), backoff on 429/5xx.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { apiBase, apiKey, cacheEnabled, dataDir } from './env.js';

// ---------------------------------------------------------------------------------------------
// Keys

/** JSON with object keys sorted, so the same request always hashes the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`;
}

/** sha256(model + inputs): the key for the disk cache, record and replay. */
export function requestKey(model: string, body: unknown): string {
  return createHash('sha256').update(model).update('\n').update(stableStringify(body)).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Disk stores (.data/cache for dev, .data/recordings for record/replay)

export type StoreName = 'cache' | 'recordings';

export function storeDir(name: StoreName, env: NodeJS.ProcessEnv = process.env): string {
  if (name === 'recordings' && env.GEMINI_RECORDINGS_DIR) return env.GEMINI_RECORDINGS_DIR;
  return join(dataDir(env), name);
}

export interface StoredResponse {
  key: string;
  model: string;
  tag: string;
  endpoint: 'interactions' | 'decisions';
  savedAt: string;
  /** The raw API response body, exactly as received. Parsing and validation re-run on every read. */
  response: unknown;
}

function storePath(name: StoreName, key: string, env: NodeJS.ProcessEnv): string {
  return join(storeDir(name, env), key.slice(0, 2), `${key}.json`);
}

export function readStore(name: StoreName, key: string, env: NodeJS.ProcessEnv = process.env): StoredResponse | undefined {
  if (name === 'cache' && !cacheEnabled(env)) return undefined;
  const p = storePath(name, key, env);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as StoredResponse;
  } catch {
    return undefined; // a torn write; treat as a miss
  }
}

export function writeStore(name: StoreName, entry: StoredResponse, env: NodeJS.ProcessEnv = process.env): void {
  if (name === 'cache' && !cacheEnabled(env)) return;
  const p = storePath(name, entry.key, env);
  mkdirSync(join(p, '..'), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry));
  renameSync(tmp, p); // atomic, so concurrent readers never see half a file
}

// ---------------------------------------------------------------------------------------------
// HTTP: one shared limiter, backoff on 429/5xx

/** At most 4 requests in flight across the whole process (all models share the project quota). */
export const limit = pLimit(4);

export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly endpoint: string,
  ) {
    super(`Gemini ${endpoint} HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = 'GeminiHttpError';
  }
}

export const MAX_TRIES = 3;

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PostOptions {
  env?: NodeJS.ProcessEnv;
  /** Base delay for the exponential backoff (tests set it to ~0). */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * POST JSON to `${apiBase}/${endpoint}` with the x-goog-api-key header. Up to 3 tries with exponential
 * backoff (base, 2×base, plus jitter) on 429, 5xx and network errors; other 4xx fail at once.
 */
export async function postJson(endpoint: string, body: unknown, opts: PostOptions = {}): Promise<unknown> {
  const env = opts.env ?? process.env;
  const key = apiKey(env);
  const url = `${apiBase(env)}/${endpoint}`;
  const base = opts.backoffMs ?? Number(env.GEMINI_BACKOFF_MS ?? 1000);
  const doFetch = opts.fetchImpl ?? fetch;

  return limit(async () => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': key,
            // Interactions API revision used throughout docs/vendor/gemini-quickstart.md.
            ...(endpoint === 'interactions' ? { 'Api-Revision': '2026-05-20' } : {}),
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as unknown;
        const err = new GeminiHttpError(res.status, text, endpoint);
        if (!retryable(res.status)) throw err;
        lastErr = err;
      } catch (e) {
        if (e instanceof GeminiHttpError && !retryable(e.status)) throw e;
        lastErr = e;
      }
      if (attempt < MAX_TRIES) await sleep(base * 2 ** (attempt - 1) * (1 + Math.random() * 0.25));
    }
    throw lastErr;
  });
}

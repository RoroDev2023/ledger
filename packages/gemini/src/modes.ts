// [Rahim] GEMINI_MODE: live | mock (fixtures/) | record | replay, keyed by sha256(model + inputs).
//   live    real API; the disk cache (.data/cache) serves repeats for free
//   mock    deterministic stubs (fixtures/ overrides, else synthesized); no network, no key
//   record  live + save every response to .data/recordings (GEMINI_RECORDINGS_DIR)
//   replay  recordings only; a miss is an error, never a live call (demo fallback, reproducible eval)
import { performance } from 'node:perf_hooks';
import { postJson, readStore, requestKey, writeStore, type StoredResponse } from './cache.js';
import { logCall, type CallSource } from './callLog.js';
import { geminiMode } from './env.js';

export class ReplayMissError extends Error {
  constructor(
    readonly tag: string,
    readonly key: string,
  ) {
    super(`GEMINI_MODE=replay: no recording for ${tag} (key ${key.slice(0, 12)}…). Record it first with GEMINI_MODE=record.`);
    this.name = 'ReplayMissError';
  }
}

export interface CallSpec {
  endpoint: 'interactions' | 'decisions';
  model: string;
  tag: string;
  /** The exact request body; also the cache/recording key input. */
  body: Record<string, unknown>;
  /** Decisions questions in this request (0 for generate). */
  questions: number;
  /** Raw response stub for mock mode, same shape as the live API's. */
  mock: () => unknown;
  /** Token counts from a raw response, for the call log. */
  usage: (raw: unknown) => { inTokens: number; outTokens: number };
  env?: NodeJS.ProcessEnv;
}

export interface CallResult {
  raw: unknown;
  source: CallSource;
  latencyMs: number;
  key: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one API request in the current mode and log it to calls.jsonl (success or failure). */
export async function callModel(spec: CallSpec): Promise<CallResult> {
  const env = spec.env ?? process.env;
  const mode = geminiMode(env);
  const key = requestKey(spec.model, spec.body);
  const t0 = performance.now();
  let source: CallSource = mode === 'mock' ? 'mock' : mode === 'replay' ? 'replay' : 'live';
  const entry = (response: unknown): StoredResponse => ({
    key,
    model: spec.model,
    tag: spec.tag,
    endpoint: spec.endpoint,
    savedAt: new Date().toISOString(),
    response,
  });

  try {
    let raw: unknown;
    if (mode === 'mock') {
      const delay = Number(env.GEMINI_MOCK_LATENCY_MS ?? 0); // lets the demo panel show plausible timings
      if (delay > 0) await sleep(delay);
      raw = spec.mock();
    } else if (mode === 'replay') {
      const rec = readStore('recordings', key, env);
      if (!rec) throw new ReplayMissError(spec.tag, key);
      raw = rec.response;
    } else {
      const hit = readStore('cache', key, env);
      if (hit) {
        source = 'cache';
        raw = hit.response;
      } else {
        raw = await postJson(spec.endpoint, spec.body, { env });
        writeStore('cache', entry(raw), env);
      }
      if (mode === 'record') writeStore('recordings', entry(raw), env);
    }
    const latencyMs = performance.now() - t0;
    const { inTokens, outTokens } = spec.usage(raw);
    logCall({ model: spec.model, tag: spec.tag, latencyMs, inTokens, outTokens, questions: spec.questions, source, endpoint: spec.endpoint, ok: true }, env);
    return { raw, source, latencyMs, key };
  } catch (e) {
    logCall(
      {
        model: spec.model,
        tag: spec.tag,
        latencyMs: performance.now() - t0,
        inTokens: 0,
        outTokens: 0,
        questions: spec.questions,
        source,
        endpoint: spec.endpoint,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      env,
    );
    throw e;
  }
}

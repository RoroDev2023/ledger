// [Rahim] Append { ts, model, tag, latencyMs, inTokens, outTokens, cached, questions } to .data/calls.jsonl per request. Count questions after chunking. The demo displays live counts and latency.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir } from './env.js';

/** Where a response came from. Only `live` cost money and real latency. */
export type CallSource = 'live' | 'cache' | 'replay' | 'mock';

export interface CallRecord {
  ts: string;
  model: string;
  tag: string;
  /** Wall time of this request (cache hits and replays are ~0). */
  latencyMs: number;
  inTokens: number;
  outTokens: number;
  /** true when served from the disk cache or a recording, i.e. not a paid live call. */
  cached: boolean;
  /** Decisions question count in this request (after chunking); 0 for generate. Read by packages/eval. */
  questions: number;
  /** Same value as `questions` (alias requested for the R1 ticket). */
  questionCount: number;
  source: CallSource;
  endpoint: 'interactions' | 'decisions' | 'files' | 'shop';
  ok: boolean;
  error?: string;
}

export function callLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'calls.jsonl');
}

type Listener = (r: CallRecord) => void;
const listeners = new Set<Listener>();

/** Subscribe to every call as it is logged (apps/api pushes these over SSE). Returns unsubscribe. */
export function onCall(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function logCall(
  r: Omit<CallRecord, 'ts' | 'questionCount' | 'cached'> & { ts?: string },
  env: NodeJS.ProcessEnv = process.env,
): CallRecord {
  const rec: CallRecord = {
    ts: r.ts ?? new Date().toISOString(),
    model: r.model,
    tag: r.tag,
    latencyMs: Math.round(r.latencyMs),
    inTokens: r.inTokens,
    outTokens: r.outTokens,
    cached: r.source === 'cache' || r.source === 'replay',
    questions: r.questions,
    questionCount: r.questions,
    source: r.source,
    endpoint: r.endpoint,
    ok: r.ok,
    ...(r.error ? { error: r.error.slice(0, 300) } : {}),
  };
  const p = callLogPath(env);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(rec)}\n`);
  for (const fn of listeners) {
    try {
      fn(rec);
    } catch {
      // a broken listener must never fail a model call
    }
  }
  return rec;
}

export function readCalls(env: NodeJS.ProcessEnv = process.env): CallRecord[] {
  const p = callLogPath(env);
  if (!existsSync(p)) return [];
  const out: CallRecord[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CallRecord);
    } catch {
      // skip a torn last line
    }
  }
  return out;
}

export interface CallStats {
  /** Requests matching the filter (all sources). */
  calls: number;
  /** Decisions questions asked across those requests. */
  questions: number;
  /** Latency of the most recent request. */
  lastLatencyMs: number;
  /** Mean latency over requests that actually hit a model (live + mock), not cache hits or replays. */
  avgLatencyMs: number;
  inTokens: number;
  outTokens: number;
  bySource: Record<CallSource, number>;
  errors: number;
}

export interface CallStatsFilter {
  /** Exact model ID. */
  model?: string;
  /** Only Decisions API requests. */
  decisions?: boolean;
  /** ISO timestamp or epoch ms; only calls at or after it (e.g. when a job started). */
  since?: string | number;
  /** Tag prefix, e.g. "localize." */
  tagPrefix?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Totals for the demo's Decisions panel and the eval. The first four fields match apps/api's
 * DecisionsStat ({ calls, questions, lastLatencyMs, avgLatencyMs }).
 */
export function readCallStats(filter: CallStatsFilter = {}): CallStats {
  const env = filter.env ?? process.env;
  const since = filter.since === undefined ? undefined : new Date(filter.since).getTime();
  const rows = readCalls(env).filter(
    (r) =>
      (!filter.model || r.model === filter.model) &&
      (!filter.decisions || r.endpoint === 'decisions') &&
      (since === undefined || new Date(r.ts).getTime() >= since) &&
      (!filter.tagPrefix || r.tag.startsWith(filter.tagPrefix)),
  );
  const bySource: Record<CallSource, number> = { live: 0, cache: 0, replay: 0, mock: 0 };
  let questions = 0, inTokens = 0, outTokens = 0, errors = 0, latSum = 0, latN = 0;
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    questions += r.questions ?? 0;
    inTokens += r.inTokens ?? 0;
    outTokens += r.outTokens ?? 0;
    if (r.ok === false) errors++;
    if (!r.cached) {
      latSum += r.latencyMs;
      latN++;
    }
  }
  return {
    calls: rows.length,
    questions,
    lastLatencyMs: rows.at(-1)?.latencyMs ?? 0,
    avgLatencyMs: latN ? Math.round(latSum / latN) : 0,
    inTokens,
    outTokens,
    bySource,
    errors,
  };
}

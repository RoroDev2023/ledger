// [Rahim] Reads GEMINI_API_KEY, GEMINI_MODE and MODEL_* from the environment. Never hardcode model IDs.
import { isAbsolute, join } from 'node:path';

export type GeminiMode = 'live' | 'mock' | 'record' | 'replay';
export const GEMINI_MODES: readonly GeminiMode[] = ['live', 'mock', 'record', 'replay'];

/** Which job a model does. Each role maps to one MODEL_* env var (AGENTS.md "Pipeline"). */
export type ModelRole = 'plan' | 'fast' | 'deep' | 'decide' | 'baseline';
export const MODEL_ENV: Record<ModelRole, string> = {
  plan: 'MODEL_PLAN', // Argon
  fast: 'MODEL_FAST', // Hydrogen
  deep: 'MODEL_DEEP', // Carbon
  decide: 'MODEL_DECIDE', // Decision 1
  baseline: 'MODEL_BASELINE', // Neon
};

type Env = NodeJS.ProcessEnv;

export function geminiMode(env: Env = process.env): GeminiMode {
  const raw = (env.GEMINI_MODE ?? 'mock').split('#')[0]!.trim().toLowerCase();
  if (!(GEMINI_MODES as readonly string[]).includes(raw)) {
    throw new Error(`GEMINI_MODE must be one of ${GEMINI_MODES.join(' | ')}, got "${env.GEMINI_MODE}"`);
  }
  return raw as GeminiMode;
}

/**
 * Model ID for a role, read from MODEL_*. In mock mode a missing var resolves to `mock:<VAR>` so tests
 * and fixtures run without config; every other mode fails loudly instead of guessing an ID.
 */
export function modelId(role: ModelRole, env: Env = process.env): string {
  const name = MODEL_ENV[role];
  const v = env[name]?.trim();
  if (v) return v;
  if (geminiMode(env) === 'mock') return `mock:${name}`;
  throw new Error(`${name} is not set. Copy the MODEL_* lines from .env.example into .env.`);
}

export function apiKey(env: Env = process.env): string {
  const k = env.GEMINI_API_KEY?.trim();
  if (!k || k === 'fake') throw new Error('GEMINI_API_KEY is not set (needed for GEMINI_MODE=live/record).');
  return k;
}

/** Repo root: LEDGER_ROOT, else three levels up from packages/gemini/src (same rule as packages/eval). */
export function repoRoot(env: Env = process.env): string {
  return env.LEDGER_ROOT ?? join(import.meta.dirname, '..', '..', '..');
}

/** DATA_DIR resolved against the repo root (default .data), so every package writes to the same place. */
export function dataDir(env: Env = process.env): string {
  const d = env.DATA_DIR?.trim() || '.data';
  return isAbsolute(d) ? d : join(repoRoot(env), d);
}

/** Disk cache on by default; GEMINI_CACHE=0 turns it off (the smoke test does). */
export function cacheEnabled(env: Env = process.env): boolean {
  return !['0', 'false', 'off', 'no'].includes((env.GEMINI_CACHE ?? '').trim().toLowerCase());
}

/** REST base URL (v1beta). GEMINI_API_BASE overrides it, e.g. for a local fake server in tests. */
export function apiBase(env: Env = process.env): string {
  return (env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
}

// [Rahim] One live call each to Hydrogen, Argon, Carbon, Neon and Decision 1; prints status + latency.
//   pnpm --filter @ledger/gemini smoke
// Reads .env at the repo root; MODEL_* missing there fall back to .env.example. Always live, cache off.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { GeminiHttpError, decide, generate, modelId, repoRoot, type ModelRole } from '../src/index.js';

const root = repoRoot();
for (const f of ['.env', '.env.example']) {
  // loadEnvFile never overrides a variable that is already set, so .env wins over .env.example.
  if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));
}
process.env.GEMINI_MODE = 'live';
process.env.GEMINI_CACHE = '0';

const Pong = z.object({ ok: z.boolean(), word: z.string() });
const prompt = 'Health check. Reply with JSON: ok = true, word = any single English word.';

interface Row {
  role: ModelRole;
  model: string;
  status: string;
  latencyMs: number;
  detail: string;
}

async function timed(role: ModelRole, fn: (model: string) => Promise<string>): Promise<Row> {
  let model = '?';
  const t0 = performance.now();
  try {
    model = modelId(role);
    const detail = await fn(model);
    return { role, model, status: '200 ok', latencyMs: performance.now() - t0, detail };
  } catch (e) {
    const status = e instanceof GeminiHttpError ? `${e.status} error` : 'error';
    const msg = e instanceof GeminiHttpError ? e.body : e instanceof Error ? e.message : String(e);
    return { role, model, status, latencyMs: performance.now() - t0, detail: msg.replace(/\s+/g, ' ').slice(0, 160) };
  }
}

const gen = (role: ModelRole) =>
  timed(role, async (model) => {
    const r = await generate({ model, input: prompt, schema: Pong, tag: `smoke.${role}` });
    return `ok=${r.ok} word=${r.word}`;
  });

const rows = await Promise.all([
  gen('fast'),
  gen('plan'),
  gen('deep'),
  gen('baseline'),
  timed('decide', async (model) => {
    const r = await decide({
      model,
      input: 'The blue mug I ordered on Monday arrived cracked on Wednesday.',
      questions: { damaged: { type: 'noul', instructions: 'Did the item arrive damaged?' } },
      tag: 'smoke.decide',
    });
    return `P(damaged)=${r.answers.damaged.noul} inTokens=${r.usage.total_input_tokens}`;
  }),
]);

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad('role', 9)}${pad('model', 22)}${pad('status', 11)}${pad('latency', 10)}detail`);
for (const r of rows) {
  console.log(`${pad(r.role, 9)}${pad(r.model, 22)}${pad(r.status, 11)}${pad(`${Math.round(r.latencyMs)} ms`, 10)}${r.detail}`);
}
process.exitCode = rows.every((r) => r.status.startsWith('200')) ? 0 : 1;

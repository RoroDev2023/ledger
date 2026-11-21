// [Rahim] GEMINI_MODE=mock stubs. Deterministic: the same request always gets the same answer.
//   generate: fixtures/generate/<tag>.json (tag prefixes tried too), else a value synthesized from the zod schema
//   decide:   fixtures/decide/<tag>.json rules ({ match: regex on instructions, noul | choice | level }),
//             else probabilities derived from sha256(request)
// GEMINI_FIXTURES_DIR points other packages' tests at their own fixtures.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { stableStringify } from './cache.js';
import { estimateInputTokens, estimateQuestionTokens, estimateTextTokens } from './chunk.js';
import type { DecisionAnswer, DecisionInput, DecisionQuestion } from './decide.js';

export function fixturesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_FIXTURES_DIR ?? join(import.meta.dirname, '..', 'fixtures');
}

/** fixtures/<kind>/<tag>.json, then the same with trailing ".segment"s and "#chunk" removed. */
function findFixture(kind: 'generate' | 'decide', tag: string, env: NodeJS.ProcessEnv): unknown {
  let t = tag.split('#')[0]!;
  for (;;) {
    const p = join(fixturesDir(env), kind, `${t.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as unknown;
    const i = t.lastIndexOf('.');
    if (i <= 0) return undefined;
    t = t.slice(0, i);
  }
}

// ---------------------------------------------------------------------------------------------
// Seeded randomness

function seedFrom(...parts: string[]): number {
  return createHash('sha256').update(parts.join('\u0000')).digest().readUInt32LE(0);
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// Synthesize a value from a zod (v3) schema

type AnyDef = { typeName?: string } & Record<string, unknown>;

function synth(schema: z.ZodTypeAny, r: () => number, path: string, depth = 0): unknown {
  const def = schema._def as AnyDef;
  if (depth > 12) return null;
  const next = (s: z.ZodTypeAny, p = path) => synth(s, r, p, depth + 1);
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, next(v, path ? `${path}.${k}` : k)]));
    }
    case 'ZodArray': {
      const d = def as unknown as { type: z.ZodTypeAny; minLength: { value: number } | null; exactLength: { value: number } | null; maxLength: { value: number } | null };
      const n = d.exactLength?.value ?? Math.min(Math.max(d.minLength?.value ?? 0, 2), d.maxLength?.value ?? 2);
      return Array.from({ length: n }, (_, i) => next(d.type, `${path}[${i}]`));
    }
    case 'ZodTuple':
      return (def.items as z.ZodTypeAny[]).map((s, i) => next(s, `${path}[${i}]`));
    case 'ZodRecord':
      return { [`${path || 'key'}-0`]: next(def.valueType as z.ZodTypeAny) };
    case 'ZodString': {
      const checks = (def.checks as { kind: string; value?: number }[]) ?? [];
      const min = checks.find((c) => c.kind === 'min' || c.kind === 'length')?.value ?? 0;
      const max = checks.find((c) => c.kind === 'max' || c.kind === 'length')?.value ?? Infinity;
      let s = `mock ${path || 'text'}`;
      while (s.length < min) s += ' x';
      return s.slice(0, Math.max(min, Math.min(max, s.length)));
    }
    case 'ZodNumber': {
      const checks = (def.checks as { kind: string; value?: number }[]) ?? [];
      const isInt = checks.some((c) => c.kind === 'int');
      let lo = checks.find((c) => c.kind === 'min')?.value ?? (checks.some((c) => c.kind === 'max') ? undefined : 0);
      let hi = checks.find((c) => c.kind === 'max')?.value;
      if (lo === undefined) lo = (hi ?? 10) - 10;
      if (hi === undefined) hi = lo + 10;
      const v = lo + (hi - lo) * (0.1 + 0.8 * r());
      return isInt ? Math.min(Math.floor(hi), Math.max(Math.ceil(lo), Math.round(v))) : round(v);
    }
    case 'ZodBigInt':
      return 0;
    case 'ZodBoolean':
      return r() < 0.5;
    case 'ZodLiteral':
      return def.value;
    case 'ZodEnum': {
      const vals = def.values as string[];
      return vals[Math.floor(r() * vals.length)];
    }
    case 'ZodNativeEnum': {
      const vals = Object.values(def.values as Record<string, string | number>);
      return vals[Math.floor(r() * vals.length)];
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = [...((def.options as z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>) ?? [])].map((o) => (Array.isArray(o) ? o[1] : o)) as z.ZodTypeAny[];
      return next(opts[Math.floor(r() * opts.length)]!);
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodReadonly':
    case 'ZodCatch':
      return next(def.innerType as z.ZodTypeAny);
    case 'ZodEffects':
      return next(def.schema as z.ZodTypeAny);
    case 'ZodBranded':
      return next(def.type as z.ZodTypeAny);
    case 'ZodPipeline':
      return next(def.in as z.ZodTypeAny);
    case 'ZodLazy':
      return next((def.getter as () => z.ZodTypeAny)());
    case 'ZodNull':
    case 'ZodUndefined':
    case 'ZodVoid':
      return null;
    default:
      return null; // ZodAny, ZodUnknown, ...
  }
}

/**
 * A deterministic value that passes `schema`. Tries a few seeds so refinements (e.g. bbox ymin < ymax)
 * usually pass; returns the last attempt otherwise, and the caller's validation reports why.
 */
export function synthesize(schema: z.ZodTypeAny, seedText: string): unknown {
  let v: unknown;
  for (let i = 0; i < 32; i++) {
    v = synth(schema, rng(seedFrom(seedText, String(i))), '');
    if (schema.safeParse(v).success) return v;
  }
  return v;
}

/** Raw Interactions-shaped response for mock mode, so mock goes through the same parsing as live. */
export function mockInteractionResponse(body: { model: string; input: unknown }, schema: z.ZodTypeAny, tag: string, env: NodeJS.ProcessEnv = process.env): unknown {
  const fixture = findFixture('generate', tag, env);
  const value = fixture !== undefined ? fixture : synthesize(schema, stableStringify({ tag, model: body.model, input: body.input }));
  const text = JSON.stringify(value);
  return {
    id: `mock_${seedFrom(text).toString(16)}`,
    object: 'interaction',
    status: 'completed',
    model: body.model,
    steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
    usage: {
      total_input_tokens: estimateInputTokens(body.input as DecisionInput),
      total_output_tokens: estimateTextTokens(text),
      total_tokens: estimateInputTokens(body.input as DecisionInput) + estimateTextTokens(text),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Decisions

interface DecideRule {
  match: string;
  noul?: number;
  choice?: string;
  level?: number;
}

function instructionsText(q: DecisionQuestion): string {
  const i = q.instructions;
  if (typeof i === 'string') return i;
  return (Array.isArray(i) ? i : [i]).map((t) => t.text).join('');
}

function distribution(keys: string[], r: () => number, forced?: string): Record<string, number> {
  const w = keys.map((k) => (forced === undefined ? r() ** 3 + 1e-3 : k === forced ? 1 : 0.1 / Math.max(1, keys.length - 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, round(w[i]! / sum)]));
}

function argmax(p: Record<string, number>, keys: string[]): string {
  return keys.reduce((best, k) => (p[k]! > p[best]! ? k : best), keys[0]!);
}

function mockAnswer(q: DecisionQuestion, r: () => number, rule: DecideRule | undefined): DecisionAnswer {
  if (q.type === 'noul') {
    const p = rule?.noul ?? round(0.01 + 0.98 * r(), 2);
    const noul = Math.min(0.99, Math.max(0.01, p));
    return { type: 'noul', noul, confidence: round(Math.max(noul, 1 - noul)) };
  }
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const forced = rule?.choice && keys.includes(rule.choice) ? rule.choice : undefined;
    const probabilities = distribution(keys, r, forced);
    const choice = argmax(probabilities, keys);
    return { type: 'choice', choice, probabilities, confidence: probabilities[choice]! };
  }
  const levels = q.criteria.map((_, i) => String(i));
  const forced = rule?.level !== undefined ? String(Math.max(0, Math.min(levels.length - 1, rule.level))) : undefined;
  const probabilities = distribution(levels, r, forced);
  const score = round(levels.reduce((s, l) => s + Number(l) * probabilities[l]!, 0));
  const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]));
  return { type: 'score', score, probabilities, legend, confidence: probabilities[argmax(probabilities, levels)]! };
}

/** Raw Decisions-shaped response for mock mode. */
export function mockDecisionsResponse(
  body: { model: string; input: DecisionInput; questions: Record<string, DecisionQuestion> },
  tag: string,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const fixture = findFixture('decide', tag, env) as { rules?: DecideRule[] } | undefined;
  const rules = (fixture?.rules ?? []).map((rule) => ({ ...rule, re: new RegExp(rule.match, 'i') }));
  const inputDigest = createHash('sha256').update(stableStringify(body.input)).digest('hex');
  const answers: Record<string, DecisionAnswer> = {};
  let qTokens = 0;
  for (const [k, q] of Object.entries(body.questions)) {
    const text = instructionsText(q);
    const rule = rules.find((x) => x.re.test(text));
    answers[k] = mockAnswer(q, rng(seedFrom(inputDigest, stableStringify(q))), rule);
    qTokens += estimateQuestionTokens(q);
  }
  const inTokens = estimateInputTokens(body.input) + qTokens;
  return {
    answers,
    usage: {
      total_input_tokens: inTokens,
      input_tokens_by_modality: [{ modality: 'text', tokens: inTokens }],
      total_output_tokens: 0,
      total_tokens: inTokens,
    },
  };
}

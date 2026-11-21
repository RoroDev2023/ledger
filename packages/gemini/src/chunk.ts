// [Rahim] Split Decisions requests at 1,000 questions and 262,144 tokens; merge answers and sum usage across chunks.
import type { Content, DecisionAnswer, DecisionInput, DecisionQuestion, DecisionUsage } from './decide.js';

/** docs/vendor/decisions-api.md "Limits". */
export const MAX_QUESTIONS_PER_REQUEST = 1000;
export const CONTEXT_TOKENS = 262_144;

// Token estimates. The docs give no per-block token formula, so these are deliberately conservative
// (overestimating only costs an extra request). Callers that know better pass `inputTokens`.
const TEXT_BYTES_PER_TOKEN = 3;
const IMAGE_TOKENS: Record<string, number> = { low: 280, medium: 560, high: 1120, ultra_high: 2240 };
const IMAGE_TOKENS_DEFAULT = 1120;
const VIDEO_TOKENS_DEFAULT = 60_000;
const AUDIO_TOKENS_DEFAULT = 15_000;
const DOCUMENT_TOKENS_DEFAULT = 25_000;
const QUESTION_OVERHEAD_TOKENS = 12;

export function estimateTextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / TEXT_BYTES_PER_TOKEN);
}

function blockTokens(c: Content): number {
  switch (c.type) {
    case 'text':
      return estimateTextTokens(c.text);
    case 'image':
      return IMAGE_TOKENS[c.resolution ?? ''] ?? IMAGE_TOKENS_DEFAULT;
    case 'video':
      return VIDEO_TOKENS_DEFAULT;
    case 'audio':
      return AUDIO_TOKENS_DEFAULT;
    case 'document':
      return DOCUMENT_TOKENS_DEFAULT;
  }
}

/** Estimated tokens of the shared input (counted again in every chunk, since it is repeated). */
export function estimateInputTokens(input: DecisionInput): number {
  if (typeof input === 'string') return estimateTextTokens(input);
  const blocks = Array.isArray(input) ? input : [input];
  return blocks.reduce((n, b) => n + blockTokens(b), 0);
}

/** Estimated tokens of one question: instructions, criteria and JSON formatting. */
export function estimateQuestionTokens(q: DecisionQuestion): number {
  return estimateTextTokens(JSON.stringify(q)) + QUESTION_OVERHEAD_TOKENS;
}

export class DecisionsBudgetError extends Error {
  constructor(
    readonly keys: string[],
    readonly inputTokens: number,
    readonly budget: number,
  ) {
    super(
      `Decisions input (~${inputTokens} tokens) plus ${keys.length === 1 ? 'question' : 'questions'} ${keys
        .slice(0, 5)
        .join(', ')} exceed the ${budget}-token context even alone. Shrink the input (lower resolution, fewer frames) or split it.`,
    );
    this.name = 'DecisionsBudgetError';
  }
}

export interface ChunkOptions {
  inputTokens: number;
  maxQuestions?: number;
  budget?: number;
}

/**
 * Greedy split of question keys into chunks that each respect both limits: ≤ maxQuestions questions and
 * input + questions ≤ budget tokens. Order is preserved, so the same request always chunks the same way
 * (stable cache keys). Throws DecisionsBudgetError if any single question cannot fit with the input.
 */
export function chunkQuestions<Q extends DecisionQuestion>(
  questions: [string, Q][],
  opts: ChunkOptions,
): [string, Q][][] {
  const maxQ = opts.maxQuestions ?? MAX_QUESTIONS_PER_REQUEST;
  const budget = opts.budget ?? CONTEXT_TOKENS;
  const tooBig = questions.filter(([, q]) => opts.inputTokens + estimateQuestionTokens(q) > budget).map(([k]) => k);
  if (tooBig.length) throw new DecisionsBudgetError(tooBig, opts.inputTokens, budget);

  const chunks: [string, Q][][] = [];
  let cur: [string, Q][] = [];
  let tokens = opts.inputTokens;
  for (const entry of questions) {
    const t = estimateQuestionTokens(entry[1]);
    if (cur.length && (cur.length >= maxQ || tokens + t > budget)) {
      chunks.push(cur);
      cur = [];
      tokens = opts.inputTokens;
    }
    cur.push(entry);
    tokens += t;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Sum native usage across chunks, including per-modality counts for the repeated input. */
export function mergeUsage(parts: DecisionUsage[]): DecisionUsage {
  const byModality = new Map<string, number>();
  let input = 0, output = 0, total = 0;
  for (const u of parts) {
    input += u.total_input_tokens ?? 0;
    output += u.total_output_tokens ?? 0;
    total += u.total_tokens ?? (u.total_input_tokens ?? 0) + (u.total_output_tokens ?? 0);
    for (const m of u.input_tokens_by_modality ?? []) byModality.set(m.modality, (byModality.get(m.modality) ?? 0) + m.tokens);
  }
  return {
    total_input_tokens: input,
    input_tokens_by_modality: [...byModality].map(([modality, tokens]) => ({ modality, tokens })),
    total_output_tokens: output,
    total_tokens: total,
  };
}

/** Merge answer maps from chunks by key. Duplicate keys across chunks are a bug, so they throw. */
export function mergeAnswers(parts: Record<string, DecisionAnswer>[]): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  for (const p of parts) {
    for (const [k, a] of Object.entries(p)) {
      if (k in out) throw new Error(`question key ${k} answered by two chunks`);
      out[k] = a;
    }
  }
  return out;
}

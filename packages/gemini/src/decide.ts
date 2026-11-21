// [Rahim] decide(): Decisions API wrapper (noul / choice / score). Returns native { answers, usage } under our question keys.
// Request/response shapes: docs/vendor/decisions-api.md ("Request and response reference", "Limits").
import { z } from 'zod';
import { GeminiHttpError } from './cache.js';
import { chunkQuestions, estimateInputTokens, mergeAnswers, mergeUsage } from './chunk.js';
import { modelId } from './env.js';
import { mockDecisionsResponse } from './mock.js';
import { callModel } from './modes.js';

// ---------------------------------------------------------------------------------------------
// Content blocks (shared with the Interactions API input)

export type Resolution = 'low' | 'medium' | 'high' | 'ultra_high';
type Media = { data: string; uri?: undefined } | { uri: string; data?: undefined };
export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; mime_type: string; resolution?: Resolution } & Media;
export type VideoContent = { type: 'video'; mime_type: string; resolution?: Resolution } & Media;
export type AudioContent = { type: 'audio'; mime_type: string } & Media;
export type DocumentContent = { type: 'document'; mime_type: string } & Media;
export type Content = TextContent | ImageContent | VideoContent | AudioContent | DocumentContent;

/** `string | Content | Content[]`, as in the docs. */
export type DecisionInput = string | Content | Content[];

// ---------------------------------------------------------------------------------------------
// Questions and answers

export type Instructions = string | TextContent | TextContent[];

export interface NoulQuestion {
  type: 'noul';
  instructions: Instructions;
  criteria?: { true_description?: string; false_description?: string };
}
export interface ChoiceQuestion<K extends string = string> {
  type: 'choice';
  instructions: Instructions;
  /** option ID -> description ("" when self-explanatory). 2-255 options. */
  criteria: Record<K, string>;
}
export interface ScoreQuestion {
  type: 'score';
  instructions: Instructions;
  /** Ordered level descriptions, lowest first. 2-255 levels. */
  criteria: string[];
}
export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: 'noul';
  /** P(yes), 0.01-0.99. */
  noul: number;
  confidence: number;
}
export interface ChoiceAnswer<K extends string = string> {
  type: 'choice';
  choice: K;
  probabilities: Record<K, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: 'score';
  /** Probability-weighted mean level index (may fall between levels). */
  score: number;
  /** level index ("0", "1", ...) -> probability */
  probabilities: Record<string, number>;
  /** level index -> description */
  legend: Record<string, string>;
  confidence: number;
}
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerFor<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer K>
    ? ChoiceAnswer<K>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : DecisionAnswer;

export interface DecisionUsage {
  total_input_tokens: number;
  input_tokens_by_modality: { modality: string; tokens: number }[];
  total_output_tokens: number;
  total_tokens: number;
}

export interface DecideResult<Qs extends Record<string, DecisionQuestion>> {
  /** One native answer per question, under the caller's original keys. */
  answers: { [K in keyof Qs]: AnswerFor<Qs[K]> };
  /** Native usage, summed across chunks (the shared input is counted once per chunk). */
  usage: DecisionUsage;
}

export interface DecideArgs<Qs extends Record<string, DecisionQuestion>> {
  input: DecisionInput;
  /** Keyed by our own IDs (any string: surface IDs, "q17", ...). Re-keyed for the wire and mapped back. */
  questions: Qs;
  /** Call-log tag, e.g. "localize.surface". */
  tag: string;
  /** Defaults to MODEL_DECIDE. */
  model?: string;
  /** Override the shared-input token estimate used for chunking (e.g. a measured count for a video). */
  inputTokens?: number;
  env?: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------------------------
// Response validation (native shape, extra fields kept)

const prob = z.number().finite().min(0).max(1);
const NoulAnswerSchema = z.object({ type: z.literal('noul'), noul: prob, confidence: prob }).passthrough();
const ChoiceAnswerSchema = z
  .object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), prob), confidence: prob })
  .passthrough();
const ScoreAnswerSchema = z
  .object({
    type: z.literal('score'),
    score: z.number().finite(),
    probabilities: z.record(z.string(), prob),
    legend: z.record(z.string(), z.string()),
    confidence: prob,
  })
  .passthrough();
const AnswerSchema = z.discriminatedUnion('type', [NoulAnswerSchema, ChoiceAnswerSchema, ScoreAnswerSchema]);
const UsageSchema = z
  .object({
    total_input_tokens: z.number().nonnegative().default(0),
    input_tokens_by_modality: z.array(z.object({ modality: z.string(), tokens: z.number() })).default([]),
    total_output_tokens: z.number().nonnegative().default(0),
    total_tokens: z.number().nonnegative().optional(),
  })
  .passthrough();
export const DecisionsResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  usage: UsageSchema.default({}),
});

function validateQuestion(key: string, q: DecisionQuestion): void {
  const instr = typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions);
  if (!instr.trim()) throw new Error(`question ${key}: empty instructions`);
  if (q.type === 'choice') {
    const n = Object.keys(q.criteria ?? {}).length;
    if (n < 2 || n > 255) throw new Error(`question ${key}: choice needs 2-255 options, got ${n}`);
  } else if (q.type === 'score') {
    const n = q.criteria?.length ?? 0;
    if (n < 2 || n > 255 || q.criteria.some((c) => !c.trim())) {
      throw new Error(`question ${key}: score needs 2-255 non-empty levels, got ${n}`);
    }
  } else if (q.type !== 'noul') {
    throw new Error(`question ${key}: unknown type ${(q as { type: string }).type}`);
  }
}

function checkAnswer(key: string, q: DecisionQuestion, a: DecisionAnswer | undefined): DecisionAnswer {
  if (!a) throw new Error(`Decisions response has no answer for question ${key}`);
  if (a.type !== q.type) throw new Error(`question ${key}: asked ${q.type}, answered ${a.type}`);
  if (a.type === 'choice' && !(a.choice in (q as ChoiceQuestion).criteria)) {
    throw new Error(`question ${key}: choice "${a.choice}" is not one of the options`);
  }
  return a;
}

function isContextOverflow(e: unknown): boolean {
  return e instanceof GeminiHttpError && e.status === 400 && /token|context|too (long|large)|exceed/i.test(e.body);
}

// ---------------------------------------------------------------------------------------------

/**
 * Ask typed questions about one shared input. Splits into requests of ≤ 1,000 questions and
 * ≤ 262,144 estimated tokens (shared input repeated per request), runs them concurrently (shared
 * p-limit(4)), validates each response, and merges answers by key and usage by sum. Every request is
 * logged separately to calls.jsonl with its question count.
 */
export async function decide<Qs extends Record<string, DecisionQuestion>>(args: DecideArgs<Qs>): Promise<DecideResult<Qs>> {
  const env = args.env ?? process.env;
  const model = args.model ?? modelId('decide', env);
  const callerKeys = Object.keys(args.questions);
  if (!callerKeys.length) throw new Error('decide: at least one question is required');
  if (typeof args.input === 'string' ? !args.input : Array.isArray(args.input) && !args.input.length) {
    throw new Error('decide: input cannot be empty');
  }

  // Wire keys: compact q0..qN in caller order (always valid, short, and stable for the cache).
  const wire: [string, DecisionQuestion][] = callerKeys.map((k, i) => {
    const q = args.questions[k]!;
    validateQuestion(k, q);
    return [`q${i}`, q];
  });
  const toCaller = new Map(wire.map(([w], i) => [w, callerKeys[i]!]));

  const inputTokens = args.inputTokens ?? estimateInputTokens(args.input);
  const chunks = chunkQuestions(wire, { inputTokens });

  const runChunk = async (chunk: [string, DecisionQuestion][], part: string): Promise<z.infer<typeof DecisionsResponseSchema>[]> => {
    const questions = Object.fromEntries(chunk);
    const body = { model, input: args.input, questions };
    try {
      const { raw } = await callModel({
        endpoint: 'decisions',
        model,
        tag: part ? `${args.tag}#${part}` : args.tag,
        body,
        questions: chunk.length,
        env,
        mock: () => mockDecisionsResponse(body, args.tag, env),
        usage: (r) => {
          const u = (r as { usage?: { total_input_tokens?: number; total_output_tokens?: number } }).usage;
          return { inTokens: u?.total_input_tokens ?? 0, outTokens: u?.total_output_tokens ?? 0 };
        },
      });
      const parsed = DecisionsResponseSchema.parse(raw);
      for (const [w, q] of chunk) checkAnswer(w, q, parsed.answers[w] as DecisionAnswer | undefined);
      return [parsed];
    } catch (e) {
      // Our token estimate was too low: halve the chunk and retry both halves.
      if (isContextOverflow(e) && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        const [a, b] = await Promise.all([runChunk(chunk.slice(0, mid), `${part}a`), runChunk(chunk.slice(mid), `${part}b`)]);
        return [...a, ...b];
      }
      throw e;
    }
  };

  const results = (await Promise.all(chunks.map((c, i) => runChunk(c, chunks.length > 1 ? String(i) : '')))).flat();
  const wireAnswers = mergeAnswers(results.map((r) => r.answers as Record<string, DecisionAnswer>));
  const answers: Record<string, DecisionAnswer> = {};
  for (const [w, a] of Object.entries(wireAnswers)) {
    const k = toCaller.get(w);
    if (k !== undefined) answers[k] = a;
  }
  for (const k of callerKeys) if (!(k in answers)) throw new Error(`Decisions response has no answer for question ${k}`);

  const usage = mergeUsage(
    results.map((r) => ({
      total_input_tokens: r.usage.total_input_tokens,
      input_tokens_by_modality: r.usage.input_tokens_by_modality,
      total_output_tokens: r.usage.total_output_tokens,
      total_tokens: r.usage.total_tokens ?? r.usage.total_input_tokens + r.usage.total_output_tokens,
    })),
  );
  return { answers: answers as DecideResult<Qs>['answers'], usage };
}

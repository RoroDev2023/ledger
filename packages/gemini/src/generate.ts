// [Rahim] generate<T>(): Interactions API call with a JSON response schema, zod validation, one retry with the error appended.
// Request/response shapes: docs/vendor/gemini-quickstart.md ("Use structured output", REST tab):
//   POST /v1beta/interactions { model, input, response_format: { type: 'text', mime_type: 'application/json', schema } }
//   -> { status, steps: [{ type: 'model_output', content: [{ type: 'text', text }] }], usage: { total_input_tokens, total_output_tokens } }
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Content } from './decide.js';
import { mockInteractionResponse } from './mock.js';
import { callModel } from './modes.js';

export type Part = Content;

export interface GenerateArgs<T> {
  /** A model ID from MODEL_* (use modelId(role)). */
  model: string;
  /** Text or content blocks (text, image, video, audio, document). */
  input?: string | Part[];
  /** Same as `input` as an array; the name packages/plan and packages/eval use. */
  parts?: Part[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Call-log tag, e.g. "plan.parse". */
  tag: string;
  /** Extra top-level request fields, passed through verbatim (check docs/vendor before using one). */
  extra?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}

export class GenerateValidationError extends Error {
  constructor(
    readonly tag: string,
    readonly errors: string[],
    readonly lastText: string,
  ) {
    super(`generate(${tag}): model output failed validation twice:\n- ${errors.join('\n- ')}`);
    this.name = 'GenerateValidationError';
  }
}

/** JSON Schema for response_format, inlined (no $ref) and without the $schema marker. */
export function toResponseSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  delete js.$schema;
  return noTupleItems(js) as Record<string, unknown>;
}

/**
 * z.tuple() becomes draft-07 tuple form `items: [a, b]`, which the Interactions API rejects with a misleading
 * "Invalid JSON payload: syntax error" (seen live with @ledger/plan's [x, y] points). Rewrite it as one item
 * schema (or anyOf when the positions differ). minItems/maxItems keep the length, and the zod schema still
 * checks each position when the reply is validated.
 */
export function noTupleItems(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(noTupleItems);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = noTupleItems(v);
  if (Array.isArray(out.items)) {
    const list = out.items as unknown[];
    const same = list.every((x) => JSON.stringify(x) === JSON.stringify(list[0]));
    out.items = list.length === 0 ? {} : same ? list[0] : { anyOf: list };
    out.minItems ??= list.length;
    out.maxItems ??= list.length;
    delete out.additionalItems;
  }
  return out;
}

const InteractionSchema = z
  .object({
    status: z.string().optional(),
    output_text: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            type: z.string(),
            content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z.object({ total_input_tokens: z.number().optional(), total_output_tokens: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

/** Concatenated text of the model_output steps (what the SDKs expose as output_text). */
export function outputText(raw: unknown): string {
  const r = InteractionSchema.parse(raw);
  if (r.status && r.status !== 'completed') throw new Error(`interaction status "${r.status}"`);
  if (typeof r.output_text === 'string') return r.output_text;
  return (r.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

function interactionUsage(raw: unknown): { inTokens: number; outTokens: number } {
  const u = (raw as { usage?: { total_input_tokens?: number; total_output_tokens?: number } } | null)?.usage;
  return { inTokens: u?.total_input_tokens ?? 0, outTokens: u?.total_output_tokens ?? 0 };
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}

function describe(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return e instanceof Error ? e.message : String(e);
}

/**
 * One structured call through the Interactions API. The output is JSON-parsed and validated with
 * `schema`; on a parse or validation error it retries once with the error appended to the input.
 */
export async function generate<T>(args: GenerateArgs<T>): Promise<T> {
  const env = args.env ?? process.env;
  const base: Part[] =
    args.parts ?? (typeof args.input === 'string' ? [{ type: 'text', text: args.input }] : args.input ?? []);
  if (!base.length) throw new Error(`generate(${args.tag}): input is empty`);
  const responseFormat = { type: 'text', mime_type: 'application/json', schema: toResponseSchema(args.schema as z.ZodTypeAny) };

  const errors: string[] = [];
  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const input: Part[] =
      attempt === 0
        ? base
        : [
            ...base,
            {
              type: 'text',
              text: `\n\nYour previous reply failed validation: ${errors.at(-1)}\nPrevious reply:\n${lastText.slice(0, 20_000)}\nReturn corrected JSON only, matching the schema.`,
            },
          ];
    const body = { model: args.model, input, response_format: responseFormat, ...args.extra };
    const tag = attempt === 0 ? args.tag : `${args.tag}.retry`;
    const { raw } = await callModel({
      endpoint: 'interactions',
      model: args.model,
      tag,
      body,
      questions: 0,
      env,
      mock: () => mockInteractionResponse(body, args.schema as z.ZodTypeAny, args.tag, env),
      usage: interactionUsage,
    });
    try {
      lastText = outputText(raw);
      return args.schema.parse(parseJson(lastText));
    } catch (e) {
      errors.push(describe(e));
    }
  }
  throw new GenerateValidationError(args.tag, errors, lastText);
}

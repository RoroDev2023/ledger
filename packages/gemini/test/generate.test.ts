import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BBoxSchema, IssueTypeSchema } from '@ledger/shared';
import { GenerateValidationError, gemini, generate, modelId, readCallStats, readCalls, toResponseSchema } from '../src/index.js';
import { fakeApi, interaction, testEnv } from './helpers.js';

const Landmarks = z.object({
  frames: z.array(z.object({ frameIdx: z.number().int().min(0), landmarks: z.array(z.string()), objects: z.array(z.string()) })).min(1),
});

const CarbonFinding = z.object({
  present: z.boolean(),
  type: IssueTypeSchema,
  severity: z.number().int().min(1).max(5),
  bbox: BBoxSchema.nullable(),
  note: z.string().min(1),
});

describe('generate (mock)', () => {
  it('synthesizes a value that passes the schema, deterministically', async () => {
    const env = testEnv();
    const a = await generate({ model: modelId('fast', env), input: 'captions please', schema: Landmarks, tag: 'landmarks', env });
    expect(Landmarks.safeParse(a).success).toBe(true);
    const b = await generate({ model: modelId('fast', env), input: 'captions please', schema: Landmarks, tag: 'landmarks', env });
    expect(b).toEqual(a);
    const c = await generate({ model: 'm', parts: [{ type: 'image', data: 'AA==', mime_type: 'image/jpeg' }], schema: CarbonFinding, tag: 'carbon', env });
    expect(CarbonFinding.safeParse(c).success).toBe(true); // bbox refinement included
    expect(readCalls(env).every((r) => r.source === 'mock' && r.questions === 0 && r.endpoint === 'interactions')).toBe(true);
  });

  it('serves fixtures/generate/<tag>.json, trying tag prefixes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-fx-'));
    mkdirSync(join(dir, 'generate'));
    writeFileSync(join(dir, 'generate', 'plan.json'), JSON.stringify({ frames: [{ frameIdx: 3, landmarks: ['window'], objects: ['chair'] }] }));
    const env = testEnv({ GEMINI_FIXTURES_DIR: dir });
    const r = await generate({ model: 'm', input: 'x', schema: Landmarks, tag: 'plan.repair.1', env });
    expect(r.frames[0]).toEqual({ frameIdx: 3, landmarks: ['window'], objects: ['chair'] });
  });

  it('works with no MODEL_* set in mock mode, and fails loudly outside it', () => {
    expect(modelId('plan', { GEMINI_MODE: 'mock' })).toBe('mock:MODEL_PLAN');
    expect(() => modelId('plan', { GEMINI_MODE: 'live' })).toThrow(/MODEL_PLAN/);
    expect(modelId('deep', { GEMINI_MODE: 'live', MODEL_DEEP: 'gemini-4-carbon' })).toBe('gemini-4-carbon');
  });

  it('fits the PlanModel / BaselineModel interfaces other packages declare', async () => {
    type Part = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string } | { type: 'video'; uri: string; mime_type: string };
    interface Model {
      generate<T>(args: { model: string; parts: Part[]; schema: z.ZodType<T>; tag: string }): Promise<T>;
    }
    const m: Model = gemini;
    expect(typeof m.generate).toBe('function');
  });

  it('builds an inline JSON schema for response_format', () => {
    const js = toResponseSchema(CarbonFinding);
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe('object');
    expect(JSON.stringify(js)).not.toContain('$ref');
  });
});

describe('generate (live against a local fake API)', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('posts the documented body and parses model_output text', async () => {
    const api = await fakeApi(() => [200, interaction('{"frames":[{"frameIdx":0,"landmarks":["door"],"objects":[]}]}')]);
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    const r = await generate({ model: 'gemini-4-hydrogen', input: 'hi', schema: Landmarks, tag: 'live.gen', env });
    expect(r.frames[0]!.landmarks).toEqual(['door']);
    const req = api.seen[0]!;
    expect(req.path).toBe('/v1beta/interactions');
    expect(req.headers['x-goog-api-key']).toBe('k');
    expect(req.body).toMatchObject({ model: 'gemini-4-hydrogen', input: [{ type: 'text', text: 'hi' }], response_format: { type: 'text', mime_type: 'application/json' } });
    expect(readCallStats({ env })).toMatchObject({ calls: 1, inTokens: 12, outTokens: 34, questions: 0 });
  });

  it('retries once with the validation error appended', async () => {
    const api = await fakeApi((_req, n) => [200, interaction(n === 1 ? '{"frames":[]}' : '{"frames":[{"frameIdx":1,"landmarks":[],"objects":["sofa"]}]}')]);
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    const r = await generate({ model: 'm', input: 'hi', schema: Landmarks, tag: 'live.retry', env });
    expect(r.frames[0]!.objects).toEqual(['sofa']);
    expect(api.seen).toHaveLength(2);
    const retryInput = api.seen[1]!.body.input as { text: string }[];
    expect(retryInput.at(-1)!.text).toMatch(/failed validation: frames/);
    expect(readCalls(env).map((x) => x.tag)).toEqual(['live.retry', 'live.retry.retry']);
  });

  it('throws after the second invalid reply', async () => {
    const api = await fakeApi(() => [200, interaction('not json')]);
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    await expect(generate({ model: 'm', input: 'hi', schema: Landmarks, tag: 'live.bad', env })).rejects.toBeInstanceOf(GenerateValidationError);
    expect(api.seen).toHaveLength(2);
  });
});

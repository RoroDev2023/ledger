import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeminiHttpError, ReplayMissError, decide, readCallStats, readCalls, type DecisionQuestion } from '../src/index.js';
import { answerAll, fakeApi, testEnv } from './helpers.js';

const questions = {
  'bedroom.wall-n|visible': { type: 'noul', instructions: 'Is the north wall of the bedroom visible?' },
  room: {
    type: 'choice',
    instructions: 'Which room is this frame in?',
    criteria: { bedroom: 'Has the bed.', kitchen: 'Has the stove.', other: 'Hallway or anything else.' },
  },
  severity: {
    type: 'score',
    instructions: 'How severe is the crack on the north wall?',
    criteria: ['faint trace', 'minor mark', 'moderate', 'extensive', 'severe'],
  },
} satisfies Record<string, DecisionQuestion>;

describe('decide (mock)', () => {
  it('returns native typed answers under our original keys', async () => {
    const env = testEnv();
    const r = await decide({ input: 'frame 12', questions, tag: 'test.mock', env });
    expect(Object.keys(r.answers).sort()).toEqual(Object.keys(questions).sort());
    const v = r.answers['bedroom.wall-n|visible'];
    expect(v.type).toBe('noul');
    expect(v.noul).toBeGreaterThanOrEqual(0.01);
    expect(v.noul).toBeLessThanOrEqual(0.99);
    expect(v.confidence).toBeCloseTo(Math.max(v.noul, 1 - v.noul), 3);
    const room = r.answers.room;
    expect(['bedroom', 'kitchen', 'other']).toContain(room.choice);
    expect(Object.values(room.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    const sev = r.answers.severity;
    expect(sev.score).toBeGreaterThanOrEqual(0);
    expect(sev.score).toBeLessThanOrEqual(4);
    expect(sev.legend['4']).toBe('severe');
    expect(r.usage.total_output_tokens).toBe(0);
    expect(r.usage.total_input_tokens).toBeGreaterThan(0);
  });

  it('is deterministic for the same request', async () => {
    const env = testEnv();
    const a = await decide({ input: 'frame 12', questions, tag: 'test.det', env });
    const b = await decide({ input: 'frame 12', questions, tag: 'test.det', env });
    expect(b.answers).toEqual(a.answers);
  });

  it('applies fixture rules by tag prefix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-fx-'));
    mkdirSync(join(dir, 'decide'));
    writeFileSync(
      join(dir, 'decide', 'findings.json'),
      JSON.stringify({ rules: [{ match: 'visible', noul: 0.93 }, { match: 'which room', choice: 'kitchen' }, { match: 'severe', level: 3 }] }),
    );
    const env = testEnv({ GEMINI_FIXTURES_DIR: dir });
    const r = await decide({ input: 'frame', questions, tag: 'findings.checklist', env });
    expect(r.answers['bedroom.wall-n|visible'].noul).toBe(0.93);
    expect(r.answers.room.choice).toBe('kitchen');
    expect(r.answers.severity.score).toBeGreaterThan(2.5);
  });

  it('chunks 2,100 questions into 3 requests and logs each with its question count', async () => {
    const env = testEnv();
    const many: Record<string, DecisionQuestion> = {};
    for (let i = 0; i < 2100; i++) many[`surface.${i}.wall-n`] = { type: 'noul', instructions: `Is wall ${i} visible?` };
    const r = await decide({ input: 'frame', questions: many, tag: 'test.chunks', env });
    expect(Object.keys(r.answers)).toHaveLength(2100);
    const rows = readCalls(env);
    expect(rows.map((x) => x.questions)).toEqual([1000, 1000, 100]);
    expect(rows.every((x) => x.questionCount === x.questions && x.source === 'mock' && x.endpoint === 'decisions')).toBe(true);
    const stats = readCallStats({ decisions: true, env });
    expect(stats).toMatchObject({ calls: 3, questions: 2100 });
    expect(r.usage.total_input_tokens).toBe(rows.reduce((n, x) => n + x.inTokens, 0));
  });

  it('rejects malformed questions before calling the API', async () => {
    const env = testEnv();
    await expect(
      decide({ input: 'x', questions: { bad: { type: 'choice', instructions: 'one option', criteria: { a: '' } } }, tag: 't', env }),
    ).rejects.toThrow(/2-255 options/);
    await expect(decide({ input: '', questions, tag: 't', env })).rejects.toThrow(/empty/);
  });
});

describe('decide (live against a local fake API)', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('sends the documented request shape and caches repeats', async () => {
    const api = await fakeApi((req) => [200, answerAll(req.body)]);
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'test-key', GEMINI_API_BASE: api.base });
    const r = await decide({ input: [{ type: 'text', text: 'BEFORE' }], questions, tag: 'live.shape', env });
    expect(api.seen).toHaveLength(1);
    const req = api.seen[0]!;
    expect(req.path).toBe('/v1beta/decisions');
    expect(req.headers['x-goog-api-key']).toBe('test-key');
    expect(req.body.model).toBe('gemini-decision-1');
    for (const k of Object.keys(req.body.questions as object)) expect(k).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(r.answers.room.choice).toBe('bedroom');
    expect(r.answers.severity.legend['0']).toBe('faint trace');

    await decide({ input: [{ type: 'text', text: 'BEFORE' }], questions, tag: 'live.shape', env });
    expect(api.seen).toHaveLength(1); // served from .data/cache
    expect(readCalls(env).map((x) => x.source)).toEqual(['live', 'cache']);
    expect(readCalls(env)[1]!.cached).toBe(true);
  });

  it('retries 429 and 5xx with backoff, at most 3 tries', async () => {
    const api = await fakeApi((req, n) => (n < 3 ? [n === 1 ? 429 : 503, { error: { message: 'slow down' } }] : [200, answerAll(req.body)]));
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base, GEMINI_CACHE: '0' });
    await decide({ input: 'x', questions, tag: 'live.retry', env });
    expect(api.seen).toHaveLength(3);

    const down = await fakeApi(() => [500, { error: { message: 'boom' } }]);
    const env2 = { ...env, GEMINI_API_BASE: down.base };
    await expect(decide({ input: 'x', questions, tag: 'live.down', env: env2 })).rejects.toBeInstanceOf(GeminiHttpError);
    expect(down.seen).toHaveLength(3);
    expect(readCalls(env2).at(-1)).toMatchObject({ ok: false, tag: 'live.down' });
    await down.close();
  });

  it('does not retry other 4xx', async () => {
    const api = await fakeApi(() => [400, { error: { code: 'safety', message: 'blocked' } }]);
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    await expect(decide({ input: 'x', questions, tag: 'live.400', env })).rejects.toThrow(/HTTP 400/);
    expect(api.seen).toHaveLength(1);
  });

  it('halves a chunk when the API says it is over the context limit', async () => {
    const api = await fakeApi((req) => {
      const n = Object.keys(req.body.questions as object).length;
      return n > 2 ? [400, { error: { message: 'Request exceeds the 262144 token context window' } }] : [200, answerAll(req.body)];
    });
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    const qs: Record<string, DecisionQuestion> = {};
    for (let i = 0; i < 5; i++) qs[`k${i}`] = { type: 'noul', instructions: `q${i}?` };
    const r = await decide({ input: 'x', questions: qs, tag: 'live.split', env });
    expect(Object.keys(r.answers).sort()).toEqual(Object.keys(qs).sort());
    expect(r.usage.total_input_tokens).toBe(300); // three successful requests (2 + 1 + 2), 100 each
    expect(r.usage.input_tokens_by_modality).toEqual([{ modality: 'text', tokens: 180 }, { modality: 'image', tokens: 120 }]);
  });

  it('records, then replays without the network; a replay miss is an error', async () => {
    const api = await fakeApi((req) => [200, answerAll(req.body, 0.42)]);
    const rec = mkdtempSync(join(tmpdir(), 'ledger-rec-'));
    const env = testEnv({ GEMINI_MODE: 'record', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base, GEMINI_RECORDINGS_DIR: rec });
    const live = await decide({ input: 'frame 7', questions, tag: 'rec', env });
    await api.close();

    const replayEnv = testEnv({ GEMINI_MODE: 'replay', GEMINI_RECORDINGS_DIR: rec });
    const again = await decide({ input: 'frame 7', questions, tag: 'rec', env: replayEnv });
    expect(again).toEqual(live);
    expect(readCalls(replayEnv)[0]).toMatchObject({ source: 'replay', cached: true });
    await expect(decide({ input: 'frame 8', questions, tag: 'rec', env: replayEnv })).rejects.toBeInstanceOf(ReplayMissError);
  });
});

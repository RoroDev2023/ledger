import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TOKENS,
  DecisionsBudgetError,
  QuestionKeys,
  chunkQuestions,
  estimateInputTokens,
  isValidQuestionKey,
  mergeUsage,
  type DecisionQuestion,
} from '../src/index.js';

describe('QuestionKeys', () => {
  it('round-trips long IDs and IDs that differ only by punctuation', () => {
    const qk = new QuestionKeys();
    const long = `${'very-long-room-name.'.repeat(20)}wall-n`;
    const ids = ['bed-1.wall-n', 'bed_1.wall_n', 'bed 1/wall n', long, 'kitchen.floor'];
    const keys = ids.map((id) => qk.key(id, 'visible'));
    expect(new Set(keys).size).toBe(ids.length);
    for (const k of keys) expect(isValidQuestionKey(k)).toBe(true);
    keys.forEach((k, i) => expect(qk.decode(k)).toEqual({ surfaceId: ids[i], purpose: 'visible' }));
  });

  it('gives the same pair the same key and different purposes different keys', () => {
    const qk = new QuestionKeys();
    expect(qk.key('a.wall-n', 'visible')).toBe(qk.key('a.wall-n', 'visible'));
    expect(qk.key('a.wall-n', 'visible')).not.toBe(qk.key('a.wall-n', 'crack'));
    expect(qk.key('a', 'b.c')).not.toBe(qk.key('a.b', 'c'));
    expect(qk.size).toBe(4);
    expect(() => qk.decode('q99')).toThrow(/unknown/);
  });

  it('rejects invalid keys per the API rule', () => {
    expect(isValidQuestionKey('a.b')).toBe(false);
    expect(isValidQuestionKey('x'.repeat(65))).toBe(false);
    expect(isValidQuestionKey('Ok_key-1')).toBe(true);
  });
});

const noul = (text: string): DecisionQuestion => ({ type: 'noul', instructions: text });

describe('chunkQuestions', () => {
  it('splits at 1,000 questions', () => {
    const qs = Array.from({ length: 2500 }, (_, i) => [`q${i}`, noul('Is it visible?')] as [string, DecisionQuestion]);
    const chunks = chunkQuestions(qs, { inputTokens: 1000 });
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.flat().map(([k]) => k)).toEqual(qs.map(([k]) => k));
  });

  it('splits on the token budget with the shared input repeated in every chunk', () => {
    const big = 'x'.repeat(30_000); // ~10k tokens each
    const qs = Array.from({ length: 30 }, (_, i) => [`q${i}`, noul(big)] as [string, DecisionQuestion]);
    const inputTokens = 200_000;
    const chunks = chunkQuestions(qs, { inputTokens });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const t = inputTokens + c.reduce((n, [, q]) => n + Math.ceil(JSON.stringify(q).length / 3) + 12, 0);
      expect(t).toBeLessThanOrEqual(CONTEXT_TOKENS);
    }
    expect(chunks.flat()).toHaveLength(30);
  });

  it('reports a question that cannot fit even alone', () => {
    const qs: [string, DecisionQuestion][] = [['ok', noul('small')], ['huge', noul('x'.repeat(200_000))]];
    expect(() => chunkQuestions(qs, { inputTokens: 200_000 })).toThrow(DecisionsBudgetError);
    try {
      chunkQuestions(qs, { inputTokens: 200_000 });
    } catch (e) {
      expect((e as DecisionsBudgetError).keys).toEqual(['huge']);
    }
  });

  it('estimates images by resolution', () => {
    const img = (resolution: 'low' | 'high') => ({ type: 'image' as const, data: 'AA==', mime_type: 'image/jpeg', resolution });
    expect(estimateInputTokens([img('low')])).toBeLessThan(estimateInputTokens([img('high')]));
  });
});

describe('mergeUsage', () => {
  it('sums totals and per-modality counts', () => {
    const u = mergeUsage([
      { total_input_tokens: 100, input_tokens_by_modality: [{ modality: 'text', tokens: 40 }, { modality: 'image', tokens: 60 }], total_output_tokens: 0, total_tokens: 100 },
      { total_input_tokens: 70, input_tokens_by_modality: [{ modality: 'image', tokens: 60 }, { modality: 'text', tokens: 10 }], total_output_tokens: 0, total_tokens: 70 },
    ]);
    expect(u).toEqual({
      total_input_tokens: 170,
      input_tokens_by_modality: [{ modality: 'text', tokens: 50 }, { modality: 'image', tokens: 120 }],
      total_output_tokens: 0,
      total_tokens: 170,
    });
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiffItem } from '@ledger/shared';
import { loadDotEnv } from '../src/runPair.js';
import { buildStatement, isCharged } from '../src/statement.js';

const item = (over: Partial<DiffItem>): DiffItem => ({ surfaceId: 'a.wall-n', verdict: 'new-damage', reason: 'New stain.', confidence: 0.9, ...over });

describe('buildStatement', () => {
  it('totals only provable new damage, dueBy = move-out + 14 days', () => {
    const s = buildStatement('unit-1', '2026-11-21', [
      item({ surfaceId: 'a.wall-n', costUsd: 72.72 }),
      item({ surfaceId: 'a.wall-s', issueType: 'hole', costUsd: 153.4 }),
      item({ surfaceId: 'b.wall-e', verdict: 'not-visible', reason: 'Not provable: only 1 of the 2 required pairs.', costUsd: 50 }),
      item({ surfaceId: 'a.floor', verdict: 'moved', reason: 'Moved: chair.', costUsd: 40 }),
      item({ surfaceId: 'b.wall-w', verdict: 'new-damage', reason: 'Not provable: suspected crack.', costUsd: 30 }),
      item({ surfaceId: 'b.floor', verdict: 'no-change', reason: 'No change.' }),
    ]);
    expect(s.totalUsd).toBe(226.12);
    expect(s.dueBy).toBe('2026-12-05');
    expect(s.moveOutDate).toBe('2026-11-21');
    expect(s.items.map((i) => i.surfaceId)).toEqual(['a.wall-n', 'a.wall-s', 'a.floor', 'b.wall-e', 'b.wall-w']);
    expect(s.items.filter((i) => !isCharged(i)).every((i) => i.costUsd === 0)).toBe(true);
    expect(s.disclaimer).toMatch(/not legal advice/);
  });

  it('crosses month and year ends', () => {
    expect(buildStatement('u', '2026-12-25T10:00:00Z', []).dueBy).toBe('2027-01-08');
  });
});

describe('run:pair .env loading', () => {
  it('never overrides GEMINI_MODE set on the command line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-env-'));
    writeFileSync(join(dir, '.env'), 'GEMINI_MODE=mock            # live | mock\nMODEL_DECIDE=gemini-decision-1\nQUOTED="a b"\n');
    const env: NodeJS.ProcessEnv = { GEMINI_MODE: 'live' };
    loadDotEnv(join(dir, '.env'), env);
    expect(env.GEMINI_MODE).toBe('live');
    expect(env.MODEL_DECIDE).toBe('gemini-decision-1');
    expect(env.QUOTED).toBe('a b');
  });
});

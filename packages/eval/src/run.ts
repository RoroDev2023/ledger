// pnpm eval [--split test|dev]  ->  eval/results.md
// Labels:   data/labels/<pairId>.json            (PairLabel, written with label.html)
// Ours:     .data/units/<pairId>/diff.json       (DiffItem[] from the pipeline's run:pair)
// Baseline: .data/eval/baseline/<pairId>.json    (DiffItem[] from runBaseline)
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DiffItemSchema, IssueTypeSchema } from '@ledger/shared';
import { renderReport, summarize, summarizeCalls } from './report.js';
import type { PairLabel } from './metrics.js';

const root = process.env.LEDGER_ROOT ?? join(import.meta.dirname, '..', '..', '..');
const dataDir = process.env.DATA_DIR ? join(root, process.env.DATA_DIR) : join(root, '.data');
const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] ?? 'test' : 'test';

const LabelSchema = z.object({
  pairId: z.string(),
  split: z.enum(['dev', 'test']),
  newDamage: z.array(z.object({ surfaceId: z.string(), issueType: IssueTypeSchema })),
  preExisting: z.array(z.object({ surfaceId: z.string(), issueType: IssueTypeSchema })).default([]),
  moved: z.array(z.object({ object: z.string(), fromSurfaceId: z.string().optional(), toSurfaceId: z.string().optional() })).default([]),
  cleanReshoot: z.boolean().optional(),
  frames: z.record(z.string(), z.string()).optional(),
});

function readJson<T>(path: string, schema: z.ZodType<T>): T | undefined {
  if (!existsSync(path)) return undefined;
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const labelDir = join(root, 'data', 'labels');
const labels: PairLabel[] = (existsSync(labelDir) ? readdirSync(labelDir).filter((f) => f.endsWith('.json')) : [])
  .map((f) => LabelSchema.parse(JSON.parse(readFileSync(join(labelDir, f), 'utf8'))))
  .filter((l) => l.split === split);

const diffs = z.array(DiffItemSchema);
const ours = { name: 'LEDGER', byPair: Object.fromEntries(labels.map((l) => [l.pairId, readJson(join(dataDir, 'units', l.pairId, 'diff.json'), diffs)])) };
const base = { name: 'Neon one-call baseline', byPair: Object.fromEntries(labels.map((l) => [l.pairId, readJson(join(dataDir, 'eval', 'baseline', `${l.pairId}.json`), diffs)])) };

const callsPath = join(dataDir, 'calls.jsonl');
const costs = summarizeCalls(existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n') : []);
const summaries = [summarize(ours, labels), summarize(base, labels)];
const md = renderReport(summaries, labels, { split, generatedAt: new Date().toISOString(), costs });
mkdirSync(join(root, 'eval'), { recursive: true });
writeFileSync(join(root, 'eval', 'results.md'), md);
// Structured copy for the proof slide (pnpm --filter @ledger/eval proof-slide).
writeFileSync(join(root, 'eval', 'results.json'), JSON.stringify({ split, generatedAt: new Date().toISOString(), pairs: labels.length, cleanPairs: labels.filter((l) => l.cleanReshoot).length, systems: summaries }, null, 2));
console.log(labels.length ? `Scored ${labels.length} ${split} pairs -> eval/results.md` : `No ${split} labels in data/labels/ yet; wrote an empty table to eval/results.md`);

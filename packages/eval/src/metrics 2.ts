// Scoring for E4. Both systems (ours and the one-call Neon baseline) are scored by the same code.
import type { DiffItem, IssueType, Verdict } from '@ledger/shared';

/** Ground truth for one pair, written by someone outside the team before any output is seen. */
export interface PairLabel {
  pairId: string;
  split: 'dev' | 'test';
  /** New damage at move-out, keyed by (surfaceId, issueType). */
  newDamage: { surfaceId: string; issueType: IssueType }[];
  /** Objects that moved between walkthroughs (must never be charged). */
  moved: { object: string; fromSurfaceId?: string; toSurfaceId?: string }[];
  /** Damage already there at move-in. */
  preExisting: { surfaceId: string; issueType: IssueType }[];
  /** True for a clean re-shoot with no change at all (false-alarm test). */
  cleanReshoot?: boolean;
}

export interface Counts { tp: number; fp: number; fn: number }
export interface Scores extends Counts { precision: number; recall: number; f1: number }

const key = (s: string, t?: string) => `${s}|${t ?? 'other'}`;

export function score(c: Counts): Scores {
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { ...c, precision, recall, f1 };
}

/** New-damage detection at (surface, issue type): what a deposit deduction actually depends on. */
export function changeCounts(pred: DiffItem[], label: PairLabel): Counts {
  const truth = new Set(label.newDamage.map((d) => key(d.surfaceId, d.issueType)));
  const said = new Set(pred.filter((d) => d.verdict === 'new-damage').map((d) => key(d.surfaceId, d.issueType)));
  let tp = 0;
  for (const k of said) if (truth.has(k)) tp++;
  return { tp, fp: said.size - tp, fn: truth.size - tp };
}

/** Dollars charged on items that are not true new damage (e.g. the moved chair, old marks). */
export function wronglyChargedUsd(pred: DiffItem[], label: PairLabel): number {
  const truth = new Set(label.newDamage.map((d) => key(d.surfaceId, d.issueType)));
  return pred
    .filter((d) => (d.costUsd ?? 0) > 0 && !(d.verdict === 'new-damage' && truth.has(key(d.surfaceId, d.issueType))))
    .reduce((s, d) => s + (d.costUsd ?? 0), 0);
}

export type Confusion = Record<Verdict, Record<Verdict, number>>;
const VERDICTS: Verdict[] = ['new-damage', 'pre-existing', 'wear', 'moved', 'not-visible', 'no-change'];

export function emptyConfusion(): Confusion {
  return Object.fromEntries(VERDICTS.map((a) => [a, Object.fromEntries(VERDICTS.map((b) => [b, 0]))])) as Confusion;
}

export function addCounts(a: Counts, b: Counts): Counts {
  return { tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn };
}

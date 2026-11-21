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
  /** Frame filename -> true surface id (or 'none'), from label.html; scores localization. */
  frames?: Record<string, string>;
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

/** A charge = a new-damage verdict (with or without a price yet). "Not provable" items are never charges. */
export function charges(pred: DiffItem[]): DiffItem[] {
  return pred.filter((d) => d.verdict === 'new-damage');
}

/** Headline 1: charges made on a clean re-shoot (nothing changed), i.e. every charge is false. */
export function falseChargesOnClean(pred: DiffItem[], label: PairLabel): number {
  return label.cleanReshoot ? charges(pred).length : 0;
}

/** Surfaces touched by a moved object that have no true new damage. */
function movedOnlySurfaces(label: PairLabel): Set<string> {
  const damaged = new Set(label.newDamage.map((d) => d.surfaceId));
  const s = new Set<string>();
  for (const m of label.moved) for (const id of [m.fromSurfaceId, m.toSurfaceId]) if (id && !damaged.has(id)) s.add(id);
  return s;
}

/** Headline 2: charges on surfaces where only an object moved (count and dollars, dollars only if priced). */
export function movedObjectCharges(pred: DiffItem[], label: PairLabel): { count: number; usd: number } {
  const moved = movedOnlySurfaces(label);
  const hits = charges(pred).filter((d) => moved.has(d.surfaceId));
  return { count: hits.length, usd: hits.reduce((s, d) => s + (d.costUsd ?? 0), 0) };
}

/** Not-provable items, encoded as not-visible with a reason starting "Not provable:" until the contract adds a verdict. */
export function notProvable(pred: DiffItem[]): number {
  return pred.filter((d) => d.verdict === 'not-visible' && /^not provable:/i.test(d.reason)).length;
}

export function confusionFor(pred: DiffItem[], label: PairLabel, into: Confusion = emptyConfusion()): Confusion {
  const truth = new Map<string, Verdict>();
  for (const d of label.preExisting) truth.set(d.surfaceId, 'pre-existing');
  for (const id of movedOnlySurfaces(label)) truth.set(id, 'moved');
  for (const d of label.newDamage) truth.set(d.surfaceId, 'new-damage');
  const said = new Map(pred.map((d) => [d.surfaceId, d.verdict] as const));
  for (const id of new Set([...truth.keys(), ...said.keys()])) {
    const t = truth.get(id) ?? 'no-change';
    const p = said.get(id) ?? 'no-change';
    into[t][p]++;
  }
  return into;
}

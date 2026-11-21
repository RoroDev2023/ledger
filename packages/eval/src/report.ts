// E4 · eval/results.md: ours vs the one-call Neon baseline on the same pairs and the same scorer.
// Headline numbers first (false charges on clean re-shoots, charges for moved objects), raw counts always.
import type { DiffItem } from '@ledger/shared';
import {
  addCounts, changeCounts, confusionFor, emptyConfusion, falseChargesOnClean, movedObjectCharges, notProvable, score,
  type Confusion, type Counts, type PairLabel,
} from './metrics.js';

export interface SystemRun { name: string; byPair: Record<string, DiffItem[] | undefined> }

export interface SystemSummary {
  name: string;
  pairsScored: number;
  pairsMissing: string[];
  cleanPairs: number;
  falseChargesOnClean: number;
  movedChargeCount: number;
  movedChargeUsd: number;
  notProvable: number;
  change: Counts;
  confusion: Confusion;
}

export function summarize(run: SystemRun, labels: PairLabel[]): SystemSummary {
  const s: SystemSummary = {
    name: run.name, pairsScored: 0, pairsMissing: [], cleanPairs: 0, falseChargesOnClean: 0,
    movedChargeCount: 0, movedChargeUsd: 0, notProvable: 0, change: { tp: 0, fp: 0, fn: 0 }, confusion: emptyConfusion(),
  };
  for (const label of labels) {
    const pred = run.byPair[label.pairId];
    if (!pred) { s.pairsMissing.push(label.pairId); continue; }
    s.pairsScored++;
    if (label.cleanReshoot) s.cleanPairs++;
    s.falseChargesOnClean += falseChargesOnClean(pred, label);
    const mv = movedObjectCharges(pred, label);
    s.movedChargeCount += mv.count;
    s.movedChargeUsd += mv.usd;
    s.notProvable += notProvable(pred);
    s.change = addCounts(s.change, changeCounts(pred, label));
    confusionFor(pred, label, s.confusion);
  }
  return s;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function renderReport(systems: SystemSummary[], labels: PairLabel[], extra: { split: string; generatedAt: string; costs?: string }): string {
  const L: string[] = [];
  L.push('# Eval results', '');
  L.push(`Split: **${extra.split}** · ${labels.length} labelled pairs (${labels.filter((l) => l.cleanReshoot).length} clean re-shoots) · generated ${extra.generatedAt}`);
  L.push('', 'Protocol: `docs/eval-protocol.md` (changes staged and labelled by people outside the team, ground truth written before any output was seen). Both systems see the same pairs and the same scorer. Small sample: raw counts are shown next to percentages.', '');
  L.push('## Headline', '');
  L.push('| System | False charges on clean re-shoots | Charges for moved objects | Not provable ($0) |');
  L.push('|---|---|---|---|');
  for (const s of systems)
    L.push(`| ${s.name} | ${s.falseChargesOnClean} on ${s.cleanPairs} clean pairs | ${s.movedChargeCount} ($${s.movedChargeUsd.toFixed(2)}) | ${s.notProvable} |`);
  L.push('', '## New-damage detection at (surface, issue type)', '');
  L.push('| System | Correct (TP) | False (FP) | Missed (FN) | Precision | Recall | F1 | Pairs scored |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const s of systems) {
    const r = score(s.change);
    L.push(`| ${s.name} | ${r.tp} | ${r.fp} | ${r.fn} | ${pct(r.precision)} (${r.tp}/${r.tp + r.fp}) | ${pct(r.recall)} (${r.tp}/${r.tp + r.fn}) | ${r.f1.toFixed(2)} | ${s.pairsScored}${s.pairsMissing.length ? ` (missing: ${s.pairsMissing.join(', ')})` : ''} |`);
  }
  for (const s of systems) {
    const verdicts = Object.keys(s.confusion) as (keyof Confusion)[];
    L.push('', `## Verdict confusion · ${s.name} (rows = truth, columns = predicted)`, '');
    L.push(`| truth \\ predicted | ${verdicts.join(' | ')} |`);
    L.push(`|---|${verdicts.map(() => '---').join('|')}|`);
    for (const t of verdicts) L.push(`| ${t} | ${verdicts.map((p) => s.confusion[t][p]).join(' | ')} |`);
  }
  if (extra.costs) L.push('', '## Cost and time', '', extra.costs);
  L.push('', 'Failures and fixes: see `eval/failures.md`.', '');
  return L.join('\n');
}

/** Summarize .data/calls.jsonl lines: calls, questions, latency and tokens per model. */
export function summarizeCalls(lines: string[]): string {
  const by = new Map<string, { calls: number; questions: number; ms: number; inTok: number; outTok: number }>();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line) as { model?: string; latencyMs?: number; inTokens?: number; outTokens?: number; questions?: number; cached?: boolean };
      if (c.cached) continue;
      const k = c.model ?? 'unknown';
      const v = by.get(k) ?? { calls: 0, questions: 0, ms: 0, inTok: 0, outTok: 0 };
      v.calls++; v.questions += c.questions ?? 0; v.ms += c.latencyMs ?? 0; v.inTok += c.inTokens ?? 0; v.outTok += c.outTokens ?? 0;
      by.set(k, v);
    } catch { /* skip malformed line */ }
  }
  if (!by.size) return 'No calls logged yet (.data/calls.jsonl).';
  const rows = [...by].map(([m, v]) => `| ${m} | ${v.calls} | ${v.questions} | ${(v.ms / v.calls).toFixed(0)} ms | ${v.inTok} | ${v.outTok} |`);
  return ['| Model | Calls | Decisions questions | Avg latency | Input tokens | Output tokens |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

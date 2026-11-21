// [Rahim] R3: Viterbi smoothing over surfaces (self 0.8, neighbor 0.15, other 0.05) + forward-backward posteriors.
// Emissions are the classifier's per-frame probabilities (hybrid HMM); walkthroughs are continuous pans,
// so a single-frame flip to a far wall costs more than it gains.

import { LOCALIZE } from './localizeConfig.js';

export interface TransitionWeights {
  self: number;
  neighbor: number;
  other: number;
}

/**
 * Row-stochastic transition matrix. `adjacent(i, j)` says whether state j is next to state i.
 * Each class's mass is split evenly over its members, then each row is normalized.
 */
export function transitionMatrix(
  n: number,
  adjacent: (i: number, j: number) => boolean,
  w: TransitionWeights = LOCALIZE.TRANSITION,
): number[][] {
  const T: number[][] = [];
  for (let i = 0; i < n; i++) {
    const nb: number[] = [];
    const ot: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) (adjacent(i, j) ? nb : ot).push(j);
    const row = new Array<number>(n).fill(0);
    row[i] = w.self;
    for (const j of nb) row[j] = w.neighbor / nb.length;
    for (const j of ot) row[j] = w.other / ot.length;
    const sum = row.reduce((a, b) => a + b, 0) || 1;
    T.push(row.map((x) => x / sum));
  }
  return T;
}

function floorRow(e: number[], floor: number): number[] {
  return e.map((x) => Math.max(floor, Number.isFinite(x) ? x : 0));
}

/** Most likely state path. `emissions[t][s]`; uniform start. */
export function viterbi(emissions: number[][], T: number[][], floor = LOCALIZE.EMISSION_FLOOR): number[] {
  const n = T.length;
  if (!emissions.length || !n) return [];
  const logT = T.map((r) => r.map((x) => Math.log(Math.max(x, 1e-300))));
  let score = floorRow(emissions[0]!, floor).map((x) => Math.log(x) - Math.log(n));
  const back: number[][] = [];
  for (let t = 1; t < emissions.length; t++) {
    const e = floorRow(emissions[t]!, floor);
    const ptr = new Array<number>(n).fill(0);
    const next = new Array<number>(n).fill(-Infinity);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = score[i]! + logT[i]![j]!;
        if (v > next[j]!) {
          next[j] = v;
          ptr[j] = i;
        }
      }
      next[j] = next[j]! + Math.log(e[j]!);
    }
    back.push(ptr);
    score = next;
  }
  let best = 0;
  for (let j = 1; j < n; j++) if (score[j]! > score[best]!) best = j;
  const path = [best];
  for (let t = back.length - 1; t >= 0; t--) path.unshift(back[t]![path[0]!]!);
  return path;
}

/** Per-frame posterior P(state_t = s | all emissions), scaled forward-backward. */
export function forwardBackward(emissions: number[][], T: number[][], floor = LOCALIZE.EMISSION_FLOOR): number[][] {
  const n = T.length;
  const N = emissions.length;
  if (!N || !n) return [];
  const E = emissions.map((e) => floorRow(e, floor));
  const alpha: number[][] = [];
  const norm = (v: number[]) => {
    const s = v.reduce((a, b) => a + b, 0) || 1;
    return v.map((x) => x / s);
  };
  alpha.push(norm(E[0]!.map((x) => x / n)));
  for (let t = 1; t < N; t++) {
    const prev = alpha[t - 1]!;
    alpha.push(norm(E[t]!.map((e, j) => e * prev.reduce((a, p, i) => a + p * T[i]![j]!, 0))));
  }
  const beta: number[][] = new Array(N);
  beta[N - 1] = new Array<number>(n).fill(1);
  for (let t = N - 2; t >= 0; t--) {
    const b1 = beta[t + 1]!;
    beta[t] = norm(T.map((row) => row.reduce((a, p, j) => a + p * E[t + 1]![j]! * b1[j]!, 0)));
  }
  return alpha.map((a, t) => norm(a.map((x, s) => x * beta[t]![s]!)));
}

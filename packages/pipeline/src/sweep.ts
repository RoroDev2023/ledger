// [Elmir] Pair sweep: catch new damage even when the single-frame checklist (R4) missed it or the wall
// label (R3) was wrong. For every move-out keyframe, code picks the most similar move-in keyframes (pixel
// similarity, no model), and ONE Decisions call per pair asks: same spot? new damage in AFTER? only an
// object moved? what kind of damage? bigger than ordinary wear? The proof rule is unchanged: a charge needs
// 2 independent supporting pairs of the same spot, else nothing is charged. Supporting pairs are grouped by
// what the frames show (pixels), and the wall is the majority label of the group (move-in labels count
// double), so one mislabeled frame cannot move or hide the charge.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { decide, type ChoiceQuestion, type Content, type NoulQuestion } from '@ledger/gemini';
import type { Frame, IssueType, Localization } from '@ledger/shared';
import { independentPairs } from './diff.js';
import type { DiffConfig } from './diffConfig.js';

export const SWEEP_ISSUES = ['scuff', 'stain', 'hole', 'crack', 'other'] as const satisfies readonly IssueType[];

export interface SweepAnswer {
  sameRegion: number;
  newDamage: number;
  movedOnly: number;
  /** Probability that the mark is larger than ordinary wear (a small scuff or nail hole). */
  beyondWear: number;
  issue: IssueType;
}
export type SweepAsker = (before: Frame, after: Frame) => Promise<SweepAnswer>;

export interface SweepPair extends SweepAnswer {
  beforeFrameId: string;
  afterFrameId: string;
  similarity: number;
  supports: boolean;
  moved: boolean;
}
export interface SweepHit {
  surfaceId: string;
  issue: IssueType;
  proof: [SweepPair, SweepPair];
  wear: boolean;
  confidence: number;
}
export interface SweepResult { pairs: SweepPair[]; hits: SweepHit[]; movedPairs: SweepPair[] }

// ---------------------------------------------------------------------------------------------
// Similarity (code only)

const W = 32;
const H = 18;

/** A small blurred grayscale thumbnail, mean-centred and unit-length, for cosine similarity. */
export async function signature(path: string): Promise<Float64Array> {
  const raw = await sharp(await readFile(path)).resize(W, H, { fit: 'fill' }).blur(1).greyscale().raw().toBuffer();
  const v = new Float64Array(raw.length);
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i]!;
  mean /= raw.length;
  let norm = 0;
  for (let i = 0; i < raw.length; i++) {
    v[i] = raw[i]! - mean;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

/** Best cosine similarity over small horizontal/vertical shifts (a pan moves the wall sideways). */
export function shiftedSimilarity(a: Float64Array, b: Float64Array, maxShift = 4): number {
  let best = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let s = 0;
      let na = 0;
      let nb = 0;
      for (let y = 0; y < H; y++) {
        const yb = y + dy;
        if (yb < 0 || yb >= H) continue;
        for (let x = 0; x < W; x++) {
          const xb = x + dx;
          if (xb < 0 || xb >= W) continue;
          const p = a[y * W + x]!;
          const q = b[yb * W + xb]!;
          s += p * q;
          na += p * p;
          nb += q * q;
        }
      }
      const c = s / (Math.sqrt(na * nb) || 1);
      if (c > best) best = c;
    }
  }
  return best;
}

/** For each AFTER frame, the `k` most similar BEFORE frames (by pixels), most similar first. */
export function candidatePairs(before: { id: string; sig: Float64Array }[], after: { id: string; sig: Float64Array }[], k: number) {
  return after.flatMap((a) =>
    before
      .map((b) => ({ beforeFrameId: b.id, afterFrameId: a.id, similarity: shiftedSimilarity(b.sig, a.sig) }))
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, k),
  );
}

// ---------------------------------------------------------------------------------------------
// The Decisions question (wording from docs/ideas/decisions-before-after-spike.md: concrete beats vague)

export function decisionsSweepAsker(opts: { env?: NodeJS.ProcessEnv; resolution?: 'low' | 'medium' | 'high'; decideFn?: typeof decide } = {}): SweepAsker {
  const decideFn = opts.decideFn ?? decide;
  const cache = new Map<string, Promise<string>>();
  const b64 = (path: string) => {
    let p = cache.get(path);
    if (!p) cache.set(path, (p = readFile(path).then((b) => b.toString('base64'))));
    return p;
  };
  return async (before, after) => {
    const input: Content[] = [
      { type: 'text', text: 'BEFORE: a move-in photo of an apartment wall.' },
      { type: 'image', mime_type: 'image/jpeg', data: await b64(before.path), resolution: opts.resolution ?? 'medium' },
      { type: 'text', text: 'AFTER: a move-out photo, taken later from a different position and possibly in different light.' },
      { type: 'image', mime_type: 'image/jpeg', data: await b64(after.path), resolution: opts.resolution ?? 'medium' },
    ];
    const ignore = 'Ignore differences in camera angle, distance, framing, blur, lighting and colour balance.';
    const questions = {
      same_region: {
        type: 'noul',
        instructions: `Do BEFORE and AFTER show the same part of the same wall, so that a spot in one can be found in the other? Use fixed features: doors, windows, outlets, switches, posters, corners, furniture against the wall. ${ignore}`,
        criteria: { true_description: 'The same wall area is visible in both photos.', false_description: 'Different walls, or no shared area.' },
      },
      new_damage: {
        type: 'noul',
        instructions: `On the wall itself, does AFTER show a dark mark, scratch, line, scuff, stain, tape, hole or crack that is NOT present anywhere in BEFORE? ${ignore}`,
        criteria: { true_description: 'AFTER has a new mark on the wall that BEFORE does not have.', false_description: 'No new mark on the wall: the same marks are in both, or the only differences are angle, light or moved objects.' },
      },
      moved_only: {
        type: 'noul',
        instructions: `Is the only real difference that a movable object (bag, chair, box, furniture, decor) was moved, added or removed, while the wall itself looks the same? ${ignore}`,
        criteria: { true_description: 'Only an object moved; the wall is unchanged.', false_description: 'The wall itself changed, or nothing changed.' },
      },
      beyond_wear: {
        type: 'noul',
        instructions: 'If AFTER has a new mark on the wall, is it more than ordinary wear, i.e. clearly visible from a step back (not a tiny scuff or a single nail hole)?',
        criteria: { true_description: 'A clearly visible new mark, more than normal wear.', false_description: 'No new mark, or only a tiny scuff or nail hole.' },
      },
      kind: {
        type: 'choice',
        instructions: 'If AFTER has a new mark on the wall, what kind is it?',
        criteria: { scuff: 'scratch, scuff, line or marker mark', stain: 'stain, spot, tape or sticker', hole: 'hole or dent', crack: 'crack', other: 'something else, or no new mark' },
      } satisfies ChoiceQuestion<(typeof SWEEP_ISSUES)[number]>,
    } satisfies Record<string, NoulQuestion | ChoiceQuestion>;
    const { answers } = await decideFn({ input, questions, tag: 'diff.sweep', env: opts.env });
    const kind = answers.kind as unknown as { choice?: string };
    return {
      sameRegion: answers.same_region.noul,
      newDamage: answers.new_damage.noul,
      movedOnly: answers.moved_only.noul,
      beyondWear: answers.beyond_wear.noul,
      issue: (SWEEP_ISSUES as readonly string[]).includes(kind.choice ?? '') ? (kind.choice as IssueType) : 'other',
    };
  };
}

// ---------------------------------------------------------------------------------------------
// The sweep

export interface SweepInput {
  baseFrames: Frame[];
  outFrames: Frame[];
  localizations: Localization[];
  ask: SweepAsker;
  cfg: DiffConfig;
  /** Candidate BEFORE frames per AFTER frame. */
  perAfter?: number;
  /** Cap on Decisions calls. */
  maxPairs?: number;
  /** Override for tests: frame id -> signature. */
  signatures?: Map<string, Float64Array>;
  /** P(new damage) a pair needs to support a charge (dev-tuned; see SWEEP_CHANGE_YES). */
  changeYes?: number;
  /** AFTER frames at least this similar (pixels) show the same spot. */
  sameSpot?: number;
}

export async function pairSweep(input: SweepInput): Promise<SweepResult> {
  const { cfg } = input;
  const sig = async (f: Frame) => input.signatures?.get(f.id) ?? (await signature(f.path));
  const before = await Promise.all(input.baseFrames.map(async (f) => ({ id: f.id, sig: await sig(f) })));
  const after = await Promise.all(input.outFrames.map(async (f) => ({ id: f.id, sig: await sig(f) })));
  const cands = candidatePairs(before, after, input.perAfter ?? 2)
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, input.maxPairs ?? 40);
  const byId = new Map([...input.baseFrames, ...input.outFrames].map((f) => [f.id, f]));
  const pairs: SweepPair[] = await Promise.all(
    cands.map(async (c) => {
      const a = await input.ask(byId.get(c.beforeFrameId)!, byId.get(c.afterFrameId)!);
      const moved = a.movedOnly >= cfg.MOVED_YES && a.newDamage < (input.changeYes ?? cfg.CHANGE_YES);
      const supports = a.sameRegion >= cfg.SAME_REGION_YES && a.newDamage >= (input.changeYes ?? cfg.CHANGE_YES) && a.movedOnly < cfg.MOVED_YES;
      return { ...c, ...a, supports, moved };
    }),
  );

  // Group supporting pairs that show the same spot (their AFTER frames look alike, by pixels), so one
  // mislabeled frame cannot split the proof across walls. Wall = majority label over the group's frames,
  // move-in labels first (the move-in walkthrough is the reference map).
  const sigOf = new Map([...before, ...after].map((x) => [x.id, x.sig]));
  const loc = new Map(input.localizations.map((l) => [l.frameId, l.surfaceId]));
  const supporting = pairs.filter((p) => p.supports).sort((a, b) => b.newDamage - a.newDamage);
  const groups: SweepPair[][] = [];
  for (const p of supporting) {
    const g = groups.find((gr) => gr.some((q) => q.afterFrameId === p.afterFrameId || shiftedSimilarity(sigOf.get(q.afterFrameId)!, sigOf.get(p.afterFrameId)!) >= (input.sameSpot ?? 0.9)));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const hits: SweepHit[] = [];
  for (const ps of groups) {
    const proof = independentPairs(ps, byId, cfg.DISTINCT_HAMMING);
    if (!proof) continue;
    const votes = new Map<string, number>();
    for (const p of ps)
      for (const [id, w] of [[p.beforeFrameId, 2], [p.afterFrameId, 1]] as const) {
        const sId = loc.get(id);
        if (sId && sId !== 'none' && sId !== 'other') votes.set(sId, (votes.get(sId) ?? 0) + w);
      }
    const surfaceId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!surfaceId) continue;
    const kinds = new Map<IssueType, number>();
    for (const p of ps) kinds.set(p.issue, (kinds.get(p.issue) ?? 0) + 1);
    const issue = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const wear = Math.max(proof[0].beyondWear, proof[1].beyondWear) < 0.5;
    hits.push({ surfaceId, issue, proof, wear, confidence: Math.min(proof[0].newDamage, proof[1].newDamage) * Math.min(proof[0].sameRegion, proof[1].sameRegion) });
  }
  return { pairs, hits, movedPairs: pairs.filter((p) => p.moved && p.sameRegion >= cfg.SAME_REGION_YES) };
}

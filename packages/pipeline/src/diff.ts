// [Rahim] R5: Gate each BEFORE/AFTER pair on same region. Use 2×2 crops for uncertain matches.
// A deduction needs two distinct pairs supporting the same change. Keep both pairs' frame IDs.
// Insufficient proof yields a $0 not-visible item with a reason beginning “Not provable:”.
//
// We never compare video to video: both walkthroughs are pinned to the plan (R3), and here we only
// compare frames of the SAME plan surface. Models answer yes/no questions (Decisions API) and write
// one sentence (Carbon); verdicts, the proof rule and every dollar are code.

import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { decide, generate, modelId, type Content, type ImageContent, type NoulQuestion } from '@ledger/gemini';
import {
  DiffItemSchema,
  type DiffItem,
  type Finding,
  type FloorPlan,
  type Frame,
  type IssueType,
  type Localization,
  type Surface,
} from '@ledger/shared';
import { DIFF, type DiffConfig } from './diffConfig.js';
import { hammingHex } from './frames.js';
import type { FrameCaption } from './landmarks.js';
import { describePrice, loadPricing, priceDamage, usd, type DepreciationOptions, type PriceBreakdown, type Pricing } from './price.js';
import type { OnProgress } from './progress.js';
import { NOT_PROVABLE_PREFIX } from './statement.js';
import { decisionsSweepAsker, pairSweep, type SweepAsker, type SweepPair } from './sweep.js';

// ---------------------------------------------------------------------------------------------
// Inputs

/** Per-surface coverage of one walkthrough: R3's type, re-exported so both modules name the same declaration. */
import type { SurfaceCoverage } from './localize.js';
export type { SurfaceCoverage };

/** Everything R2–R4 produced for one walkthrough. */
export interface WalkthroughEvidence {
  walkthroughId: string;
  /** R4 findings. Each finding carries the severity of its own issue type. */
  findings: Finding[];
  /** Keyframes (image paths + dHash). Frames not listed here can't be sent as evidence. */
  frames: Frame[];
  /** R3 coverage by surface ID. Undefined = the walkthrough failed: nothing in it can be compared. */
  coverage?: Record<string, SurfaceCoverage>;
  /** R3 localizations + R2 captions: enable Hydrogen-object "moved" detection when both are given. */
  localizations?: Localization[];
  captions?: FrameCaption[];
}

// ---------------------------------------------------------------------------------------------
// Askers (injectable; defaults call the Decisions API / Carbon through @ledger/gemini)

export type Quadrant = 'tl' | 'tr' | 'bl' | 'br';
export const QUADRANTS: readonly Quadrant[] = ['tl', 'tr', 'bl', 'br'];
export const QUADRANT_NAME: Record<Quadrant, string> = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };
/** Normalized [ymin, xmin, ymax, xmax] of each quadrant (the shared bbox convention). */
export const QUADRANT_BOX: Record<Quadrant, [number, number, number, number]> = {
  tl: [0, 0, 0.5, 0.5],
  tr: [0, 0.5, 0.5, 1],
  bl: [0.5, 0, 1, 0.5],
  br: [0.5, 0.5, 1, 1],
};

export interface PairContext {
  plan: FloorPlan;
  surface: Surface;
  issueType: IssueType;
  before: Frame;
  after: Frame;
}

export interface ChangeAnswer {
  /** P(AFTER shows this issue on this surface and BEFORE does not). */
  newDamage: number;
  /** P(the same damage got clearly worse). */
  worse: number;
  /** P(the only difference is an object that moved). */
  movedOnly: number;
}

export type SameRegionAsker = (ctx: PairContext) => Promise<number>;
export type QuadrantAsker = (ctx: PairContext) => Promise<Record<Quadrant, number>>;
export type ChangeAsker = (ctx: PairContext & { quadrant?: Quadrant }) => Promise<ChangeAnswer>;

export interface ReasonInput {
  surface: Surface;
  issueType: IssueType;
  pairs: number;
  price: PriceBreakdown;
  /** The deterministic sentence used when the writer's output is rejected. */
  fallback: string;
}
/** Writes the one-sentence reason for a deduction from the computed numbers. Never computes money. */
export type ReasonWriter = (input: ReasonInput) => Promise<string>;

export interface DiffDeps {
  askSameRegion?: SameRegionAsker;
  askQuadrants?: QuadrantAsker;
  askChange?: ChangeAsker;
  writeReason?: ReasonWriter;
  /** [Elmir] Pair sweep asker (one Decisions call per BEFORE/AFTER pair); see sweep.ts. */
  askSweep?: SweepAsker;
}

// ---------------------------------------------------------------------------------------------
// Output

export type PairRole = 'supports' | 'moved' | 'unchanged' | 'unclear';

export interface PairResult {
  beforeFrameId: string;
  afterFrameId: string;
  /** P(same region of the surface), full frames. */
  sameRegion: number;
  /** Only when sameRegion was unsure: P(same region) per quadrant. */
  quadrants?: Record<Quadrant, number>;
  quadrant?: Quadrant;
  /** Rough box on the AFTER frame from the matching quadrant. */
  bbox?: [number, number, number, number];
  status: 'compared' | 'skipped';
  skipReason?: string;
  change?: ChangeAnswer;
  /** The change question this suspected change is judged on. */
  signal?: number;
  role?: PairRole;
}

export interface SurfaceEvidence {
  surfaceId: string;
  issueType?: IssueType;
  verdict: DiffItem['verdict'];
  moveOutFindingId?: string;
  baselineFindingId?: string;
  /** Which change question decided it: new damage, or the same damage getting worse (severity +≥2). */
  signal?: 'newDamage' | 'worse';
  beforeFrameIds: string[];
  afterFrameIds: string[];
  pairs: PairResult[];
  /** The two independent supporting pairs behind a charge (both kept for the evidence panel). */
  proof?: [PairResult, PairResult];
  /** Max independent supporting pairs found (0, 1 or 2). */
  supportingPairs: number;
  bbox?: [number, number, number, number];
  price?: PriceBreakdown;
  reasonSource?: 'carbon' | 'template';
}

export interface DiffResult {
  items: DiffItem[];
  evidence: SurfaceEvidence[];
  warnings: string[];
}

export interface DiffInput {
  plan: FloorPlan;
  /** Missing = no usable move-in record: every suspected change is not-visible, $0. */
  baseline?: WalkthroughEvidence;
  addendum?: WalkthroughEvidence;
  moveOut: WalkthroughEvidence;
  deps?: DiffDeps;
  config?: Partial<DiffConfig>;
  pricing?: Pricing;
  depreciation?: DepreciationOptions;
  onProgress?: OnProgress;
  env?: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const ISSUE_PHRASE: Record<IssueType, string> = {
  crack: 'a crack',
  stain: 'a stain or discoloration',
  hole: 'a hole (for example a nail or anchor hole, or a puncture)',
  scuff: 'a scuff or scrape mark',
  'missing-fixture': 'a missing or removed fixture (for example a handle, outlet cover, light or towel bar)',
  other: 'physical damage',
};

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function describeSurfaceForDiff(s: Surface): string {
  const marks = s.landmarks?.length ? ` (with ${s.landmarks.join(', ')})` : '';
  return `${s.label || s.id}${marks}`;
}

const HEX = /^[0-9a-f]{1,16}$/i;

/** Two frames are the same evidence if they share an ID or their dHashes are near-identical. */
export function sameFrame(a: Frame, b: Frame, maxHamming: number = DIFF.DISTINCT_HAMMING): boolean {
  if (a.id === b.id) return true;
  if (!HEX.test(a.phash) || !HEX.test(b.phash)) return false;
  return hammingHex(a.phash, b.phash) <= maxHamming;
}

/**
 * Up to `max` mutually distinct frames: `preferred` IDs first (in order), then `pool` IDs by sharpness.
 * Unknown IDs (no image on disk) are skipped.
 */
export function pickFrames(preferred: string[], pool: string[], frames: Map<string, Frame>, max: number, maxHamming: number): Frame[] {
  const out: Frame[] = [];
  const add = (f: Frame | undefined) => {
    if (f && out.length < max && !out.some((o) => sameFrame(o, f, maxHamming))) out.push(f);
  };
  for (const id of preferred) add(frames.get(id));
  const rest = pool.map((id) => frames.get(id)).filter((f): f is Frame => !!f);
  for (const f of rest.sort((a, b) => b.sharpness - a.sharpness)) add(f);
  return out;
}

/** Two pairs are independent when they use two distinct BEFORE frames and two distinct AFTER frames. */
export function independentPairs<P extends { beforeFrameId: string; afterFrameId: string }>(
  pairs: P[],
  frames: Map<string, Frame>,
  maxHamming: number = DIFF.DISTINCT_HAMMING,
): [P, P] | undefined {
  const distinct = (x: string, y: string) => {
    const a = frames.get(x);
    const b = frames.get(y);
    return a && b ? !sameFrame(a, b, maxHamming) : x !== y;
  };
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const p = pairs[i]!;
      const q = pairs[j]!;
      if (distinct(p.beforeFrameId, q.beforeFrameId) && distinct(p.afterFrameId, q.afterFrameId)) return [p, q];
    }
  }
  return undefined;
}

/** All (before, after) index pairs, diagonal first, so the first two tried are already independent. */
function pairOrder(nBefore: number, nAfter: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < nBefore; i++) for (let j = 0; j < nAfter; j++) out.push([i, j]);
  const n = Math.max(nBefore, nAfter);
  return out.sort(([a, b], [c, d]) => (((b - a) % n) + n) % n - ((((d - c) % n) + n) % n) || a - c);
}

function mergeCoverage(
  a: Record<string, SurfaceCoverage> | undefined,
  b: Record<string, SurfaceCoverage> | undefined,
): Record<string, SurfaceCoverage> | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: Record<string, SurfaceCoverage> = { ...a };
  for (const [id, c] of Object.entries(b)) {
    const prev = out[id];
    out[id] = prev
      ? { frames: prev.frames + c.frames, frameIds: [...prev.frameIds, ...c.frameIds], notVisible: prev.notVisible && c.notVisible }
      : c;
  }
  return out;
}

function covered(cov: Record<string, SurfaceCoverage> | undefined, surfaceId: string): boolean {
  const c = cov?.[surfaceId];
  return !!c && !c.notVisible;
}

// ---------------------------------------------------------------------------------------------
// Default askers (Decisions API) and reason writer (Carbon)

export interface DefaultAskerOptions {
  env?: NodeJS.ProcessEnv;
  config?: Partial<DiffConfig>;
  /** Defaults to @ledger/gemini decide (tests wrap it to inspect requests). */
  decideFn?: typeof decide;
}

function imageLoader(cfg: DiffConfig) {
  const full = new Map<string, Promise<Buffer>>();
  const crops = new Map<string, Promise<Record<Quadrant, Buffer>>>();
  const bytes = (path: string) => {
    let p = full.get(path);
    if (!p) full.set(path, (p = readFile(path)));
    return p;
  };
  const block = (data: Buffer): ImageContent => ({
    type: 'image',
    mime_type: 'image/jpeg',
    data: data.toString('base64'),
    resolution: cfg.IMAGE_RESOLUTION,
  });
  const quadrants = (path: string) => {
    let p = crops.get(path);
    if (!p) {
      p = (async () => {
        const buf = await bytes(path);
        const { width = 0, height = 0 } = await sharp(buf).metadata();
        if (width < 2 || height < 2) throw new Error(`frame too small to split 2x2: ${path}`);
        const w = Math.floor(width / 2);
        const h = Math.floor(height / 2);
        const cut = (left: number, top: number) => sharp(buf).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer();
        const [tl, tr, bl, br] = await Promise.all([cut(0, 0), cut(w, 0), cut(0, h), cut(w, h)]);
        return { tl, tr, bl, br };
      })();
      crops.set(path, p);
    }
    return p;
  };
  return { full: async (path: string) => block(await bytes(path)), quadrant: async (path: string, q: Quadrant) => block((await quadrants(path))[q]) };
}

/** BEFORE/AFTER as two labeled image blocks in one input (never a composite). */
async function pairInput(
  img: ReturnType<typeof imageLoader>,
  ctx: PairContext,
  quadrant?: Quadrant,
): Promise<Content[]> {
  const where = quadrant ? ` (${QUADRANT_NAME[quadrant]} quarter of the photo)` : '';
  const load = (f: Frame) => (quadrant ? img.quadrant(f.path, quadrant) : img.full(f.path));
  return [
    { type: 'text', text: `BEFORE: move-in walkthrough photo${where} of the ${describeSurfaceForDiff(ctx.surface)}.` },
    await load(ctx.before),
    { type: 'text', text: `AFTER: move-out walkthrough photo${where} of the same apartment.` },
    await load(ctx.after),
  ];
}

export function decisionsSameRegionAsker(opts: DefaultAskerOptions = {}): SameRegionAsker {
  const cfg = { ...DIFF, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  const img = imageLoader(cfg);
  return async (ctx) => {
    const label = describeSurfaceForDiff(ctx.surface);
    const { answers } = await decideFn({
      input: await pairInput(img, ctx),
      questions: {
        same_region: {
          type: 'noul',
          instructions: `Do the BEFORE photo and the AFTER photo show the same region of the ${label}? The camera angle, distance and lighting may differ.`,
          criteria: {
            true_description: `Both photos show the same part of the ${label}, so a mark at one spot in BEFORE could be found at the same spot in AFTER.`,
            false_description: 'The photos show different surfaces, different parts of the surface, or too little overlap to compare.',
          },
        } satisfies NoulQuestion,
      },
      tag: 'diff.same-region',
      env: opts.env,
    });
    return answers.same_region.noul;
  };
}

export function decisionsQuadrantAsker(opts: DefaultAskerOptions = {}): QuadrantAsker {
  const cfg = { ...DIFF, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  const img = imageLoader(cfg);
  return async (ctx) => {
    const label = describeSurfaceForDiff(ctx.surface);
    const input: Content[] = [
      { type: 'text', text: `Move-in (BEFORE) and move-out (AFTER) photos of the ${label}, each split into four quarters.` },
    ];
    for (const q of QUADRANTS) {
      input.push({ type: 'text', text: `BEFORE ${QUADRANT_NAME[q]}:` }, await img.quadrant(ctx.before.path, q));
      input.push({ type: 'text', text: `AFTER ${QUADRANT_NAME[q]}:` }, await img.quadrant(ctx.after.path, q));
    }
    const questions: Record<string, NoulQuestion> = {};
    for (const q of QUADRANTS) {
      questions[q] = {
        type: 'noul',
        instructions: `Do the crops labeled "BEFORE ${QUADRANT_NAME[q]}" and "AFTER ${QUADRANT_NAME[q]}" show the same region of the ${label}?`,
        criteria: {
          true_description: `Both ${QUADRANT_NAME[q]} crops show the same part of the ${label}.`,
          false_description: 'The two crops show different things or too little of the same surface to compare.',
        },
      };
    }
    const { answers } = await decideFn({ input, questions, tag: 'diff.quadrants', env: opts.env });
    return { tl: answers.tl!.noul, tr: answers.tr!.noul, bl: answers.bl!.noul, br: answers.br!.noul };
  };
}

/** The three change questions, asked in ONE Decisions request per valid pair. */
export function decisionsChangeAsker(opts: DefaultAskerOptions = {}): ChangeAsker {
  const cfg = { ...DIFF, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  const img = imageLoader(cfg);
  return async (ctx) => {
    const label = describeSurfaceForDiff(ctx.surface);
    const issue = ISSUE_PHRASE[ctx.issueType];
    const lead = `Compare the BEFORE (move-in) photo with the AFTER (move-out) photo of the ${label}.`;
    const questions = {
      new_damage: {
        type: 'noul',
        instructions: `${lead} Does AFTER show ${issue} on the ${label} that is not present at that spot in BEFORE?`,
        criteria: {
          true_description: `AFTER shows ${issue} on the ${label} that BEFORE does not show at the same spot.`,
          false_description: 'The same mark is in both photos, there is no such damage, or the difference is only lighting, angle, blur or a moved object.',
        },
      },
      worse: {
        type: 'noul',
        instructions: `${lead} Is there ${issue} on the ${label} that is visible in BEFORE and clearly worse (larger, deeper or more extensive) in AFTER?`,
        criteria: {
          true_description: 'The same damage is in both photos and it is clearly worse in AFTER.',
          false_description: 'There is no such damage in BEFORE, or it looks the same in both photos.',
        },
      },
      moved_only: {
        type: 'noul',
        instructions: `${lead} Is the only difference between BEFORE and AFTER that a movable object (furniture, a box, a rug, decor) was moved, added or removed, while the ${label} itself is unchanged?`,
        criteria: {
          true_description: `An object moved, appeared or disappeared, and the ${label} itself looks the same.`,
          false_description: `The ${label} itself looks different (damage, marks, missing parts), or nothing differs.`,
        },
      },
    } satisfies Record<string, NoulQuestion>;
    const { answers } = await decideFn({ input: await pairInput(img, ctx, ctx.quadrant), questions, tag: 'diff.change', env: opts.env });
    return { newDamage: answers.new_damage.noul, worse: answers.worse.noul, movedOnly: answers.moved_only.noul };
  };
}

const ReasonSchema = z.object({ reason: z.string().min(1).max(400) });

/**
 * Accept a model-written reason only if it is one short sentence, quotes the computed charge exactly,
 * and mentions no dollar figure other than the computed ones.
 */
export function acceptReason(text: string, price: PriceBreakdown): boolean {
  const t = text.trim();
  if (!t || t.length > 300) return false;
  // Sentence ends: [.!?] followed by whitespace + capital letter (decimals like 5.70 don't count).
  if ((t.match(/[.!?]\s+(?=[A-Z])/g) ?? []).length > 0) return false;
  const cost = usd(price.costUsd);
  if (!t.includes(cost)) return false;
  const allowed = new Set([cost, usd(price.ratePerM2Usd), usd(price.flatUsd)]);
  for (const m of t.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
    const v = Number(m[1]!.replace(/,/g, ''));
    if (!allowed.has(usd(v))) return false;
  }
  return true;
}

export function carbonReasonWriter(opts: { env?: NodeJS.ProcessEnv } = {}): ReasonWriter {
  return async ({ surface, issueType, pairs, price }) => {
    const facts = [
      `Surface: ${describeSurfaceForDiff(surface)}`,
      `Issue: new ${issueType} found at move-out that is not in the move-in record`,
      `Evidence: ${pairs} independent before/after photo pairs agree it is the same spot and that it changed`,
      `Computed charge (already final, do not recompute): ${usd(price.costUsd)} = ${describePrice(price)}`,
    ];
    const out = await generate({
      model: modelId('deep', opts.env),
      tag: 'diff.reason',
      schema: ReasonSchema,
      env: opts.env,
      parts: [
        {
          type: 'text',
          text: [
            'Write ONE plain sentence (max 40 words) explaining this line of an itemized security-deposit statement to a tenant.',
            `Use only the facts below. State the charge as exactly ${usd(price.costUsd)}. Do not invent or compute any other amount.`,
            ...facts,
            'Return JSON {"reason":"..."}.',
          ].join('\n'),
        },
      ],
    });
    return out.reason;
  };
}

// ---------------------------------------------------------------------------------------------
// Pair evaluation

async function evaluatePair(
  ctx: PairContext,
  signalKey: 'newDamage' | 'worse',
  deps: Required<Pick<DiffDeps, 'askSameRegion' | 'askQuadrants' | 'askChange'>>,
  cfg: DiffConfig,
): Promise<PairResult> {
  const base = { beforeFrameId: ctx.before.id, afterFrameId: ctx.after.id };
  const sameRegion = round3(clamp01(await deps.askSameRegion(ctx)));
  if (sameRegion <= cfg.SAME_REGION_NO) {
    return { ...base, sameRegion, status: 'skipped', skipReason: 'not the same region' };
  }
  let quadrant: Quadrant | undefined;
  let quadrants: Record<Quadrant, number> | undefined;
  if (sameRegion < cfg.SAME_REGION_YES) {
    const raw = await deps.askQuadrants(ctx);
    quadrants = Object.fromEntries(QUADRANTS.map((q) => [q, round3(clamp01(raw[q]))])) as Record<Quadrant, number>;
    const best = QUADRANTS.reduce((a, b) => (quadrants![b] > quadrants![a] ? b : a));
    if (quadrants[best] < cfg.QUADRANT_YES) {
      return { ...base, sameRegion, quadrants, status: 'skipped', skipReason: 'unsure, and no quadrant matched' };
    }
    quadrant = best;
  }
  const raw = await deps.askChange({ ...ctx, quadrant });
  const change: ChangeAnswer = { newDamage: round3(clamp01(raw.newDamage)), worse: round3(clamp01(raw.worse)), movedOnly: round3(clamp01(raw.movedOnly)) };
  const signal = change[signalKey];
  const moved = change.movedOnly >= cfg.MOVED_YES;
  const role: PairRole =
    signal >= cfg.CHANGE_YES && !moved ? 'supports' : moved && signal < cfg.CHANGE_YES ? 'moved' : signal <= cfg.CHANGE_NO && !moved ? 'unchanged' : 'unclear';
  return {
    ...base,
    sameRegion,
    ...(quadrants ? { quadrants, quadrant, bbox: QUADRANT_BOX[quadrant!] } : {}),
    status: 'compared',
    change,
    signal,
    role,
  };
}

// ---------------------------------------------------------------------------------------------
// Main

const label = (s: Surface) => s.label || s.id;
const ev_ids = (h: { proof: [SweepPair, SweepPair] }) => new Set(h.proof.flatMap((p) => [p.beforeFrameId, p.afterFrameId]));

/**
 * Baseline (+ tenant addendum) vs move-out, surface by surface. Every plan surface gets a verdict:
 * findings get pair-checked verdicts, surfaces hidden in either walkthrough are not-visible, the rest
 * are no-change. Only `new-damage` backed by 2 independent same-region pairs is priced.
 */
export async function diffWalkthroughs(input: DiffInput): Promise<DiffResult> {
  const cfg: DiffConfig = { ...DIFF, ...input.config };
  const { plan, env } = input;
  const pricing = input.pricing ?? loadPricing();
  const deps = {
    askSameRegion: input.deps?.askSameRegion ?? decisionsSameRegionAsker({ env, config: cfg }),
    askQuadrants: input.deps?.askQuadrants ?? decisionsQuadrantAsker({ env, config: cfg }),
    askChange: input.deps?.askChange ?? decisionsChangeAsker({ env, config: cfg }),
    writeReason: input.deps?.writeReason ?? carbonReasonWriter({ env }),
  };
  const warnings: string[] = [];
  const surfaces = new Map(plan.surfaces.map((s) => [s.id, s]));

  // Baseline = baseline ∪ tenant addendum. A failed walkthrough (no coverage) contributes no evidence.
  const baseParts = [input.baseline, input.addendum].filter((w): w is WalkthroughEvidence => !!w && !!w.coverage);
  const baseCoverage = baseParts.reduce<Record<string, SurfaceCoverage> | undefined>((acc, w) => mergeCoverage(acc, w.coverage), undefined);
  const baseFindings = baseParts.flatMap((w) => w.findings);
  const frames = new Map<string, Frame>();
  for (const w of [...baseParts, input.moveOut]) for (const f of w.frames) frames.set(f.id, f);
  const outCoverage = input.moveOut.coverage;

  const moveOutFindings = input.moveOut.findings.filter((f) => {
    if (surfaces.has(f.surfaceId)) return true;
    warnings.push(`move-out finding ${f.id} is on unknown surface ${f.surfaceId}; skipped`);
    return false;
  });
  const sweepOn = cfg.PAIR_SWEEP && baseParts.length > 0 && input.moveOut.frames.length > 0;
  const total = moveOutFindings.length + 1 + (sweepOn ? 1 : 0);
  let done = 0;
  const tick = () => input.onProgress?.('diff', ++done, total);

  const judged = await Promise.all(
    moveOutFindings.map(async (m) => {
      const r = await judgeFinding(m);
      tick();
      return r;
    }),
  );

  async function judgeFinding(m: Finding): Promise<{ item: DiffItem; evidence: SurfaceEvidence }> {
    const s = surfaces.get(m.surfaceId)!;
    const ev: SurfaceEvidence = {
      surfaceId: s.id,
      issueType: m.type,
      verdict: 'not-visible',
      moveOutFindingId: m.id,
      beforeFrameIds: [],
      afterFrameIds: [],
      pairs: [],
      supportingPairs: 0,
    };
    const item = (verdict: DiffItem['verdict'], reason: string, confidence: number, extra: Partial<DiffItem> = {}) => {
      ev.verdict = verdict;
      return {
        item: DiffItemSchema.parse({ surfaceId: s.id, verdict, issueType: m.type, reason, confidence: round3(clamp01(confidence)), costUsd: 0, ...extra }),
        evidence: ev,
      };
    };

    // 1. No usable move-in record for this surface → nothing can be proven.
    if (!baseCoverage) {
      return item('not-visible', `Not visible at move-in: there is no usable move-in walkthrough, so this ${m.type} on the ${label(s)} cannot be compared. $0.`, 1);
    }
    if (!covered(baseCoverage, s.id)) {
      const n = baseCoverage[s.id]?.frames ?? 0;
      return item('not-visible', `Not visible at move-in: the ${label(s)} appears clearly in ${n} move-in keyframe(s), too few to compare this ${m.type}. $0.`, 1);
    }
    if (outCoverage && !covered(outCoverage, s.id)) {
      const n = outCoverage[s.id]?.frames ?? 0;
      return item('not-visible', `Not visible at move-out: the ${label(s)} appears clearly in only ${n} move-out keyframe(s). $0.`, 1);
    }

    // 2. Same issue type already recorded at move-in (severity is per issue type).
    const prior = baseFindings.filter((b) => b.surfaceId === s.id && b.type === m.type).sort((a, b) => b.severity - a.severity)[0];
    if (prior) ev.baselineFindingId = prior.id;
    if (prior && m.severity - prior.severity < cfg.SEVERITY_JUMP) {
      return item(
        'pre-existing',
        `Pre-existing: the move-in record already shows a ${m.type} on the ${label(s)} (severity ${prior.severity}, now ${m.severity}). Not charged.`,
        Math.min(m.confidence, prior.confidence),
        { beforeFrameId: prior.frameIds[0], afterFrameId: m.frameIds[0] },
      );
    }
    const signalKey = prior ? 'worse' : 'newDamage';
    ev.signal = signalKey;

    // 3. Suspected change: pair-check distinct BEFORE × AFTER frames of this surface.
    const before = pickFrames(prior?.frameIds ?? [], baseCoverage[s.id]?.frameIds ?? [], frames, cfg.MAX_BEFORE, cfg.DISTINCT_HAMMING);
    const after = pickFrames(m.frameIds, outCoverage?.[s.id]?.frameIds ?? [], frames, cfg.MAX_AFTER, cfg.DISTINCT_HAMMING);
    ev.beforeFrameIds = before.map((f) => f.id);
    ev.afterFrameIds = after.map((f) => f.id);
    const changeWord = prior ? `got worse (severity ${prior.severity} → ${m.severity})` : 'is new';

    for (const [i, j] of pairOrder(before.length, after.length)) {
      const pr = await evaluatePair({ plan, surface: s, issueType: m.type, before: before[i]!, after: after[j]! }, signalKey, deps, cfg);
      ev.pairs.push(pr);
      const proof = independentPairs(ev.pairs.filter((p) => p.role === 'supports'), frames, cfg.DISTINCT_HAMMING);
      if (proof) {
        ev.proof = proof;
        break;
      }
    }
    const supporting = ev.pairs.filter((p) => p.role === 'supports');
    const moved = ev.pairs.filter((p) => p.role === 'moved');
    const compared = ev.pairs.filter((p) => p.status === 'compared').length;
    ev.supportingPairs = ev.proof ? 2 : supporting.length ? 1 : 0;
    const first = ev.proof?.[0] ?? supporting[0] ?? moved[0];
    ev.bbox = first?.bbox ?? m.bbox;
    const frameRefs = first ? { beforeFrameId: first.beforeFrameId, afterFrameId: first.afterFrameId } : { afterFrameId: m.frameIds[0] };

    if (ev.proof) {
      const conf = Math.min(ev.proof[0].signal!, ev.proof[1].signal!) * m.confidence;
      // Wear: small scuffs and nail holes are normal wear and tear, never charged.
      if (cfg.WEAR_TYPES.includes(m.type) && m.severity <= cfg.WEAR_MAX_SEVERITY) {
        return item('wear', `Wear: 2 independent before/after pairs show a new ${m.type} on the ${label(s)}, but at severity ${m.severity} it is normal wear and tear. Not charged.`, conf, frameRefs);
      }
      const price = priceDamage({ plan, surfaceId: s.id, issueType: m.type, pricing, depreciation: input.depreciation });
      ev.price = price;
      const fallback = `New ${m.type} on the ${label(s)}: 2 independent before/after pairs agree it is the same spot and that it ${changeWord}; ${describePrice(price)} (placeholder rates).`;
      let reason = fallback;
      ev.reasonSource = 'template';
      try {
        const written = (await deps.writeReason({ surface: s, issueType: m.type, pairs: 2, price, fallback })).trim();
        if (acceptReason(written, price)) {
          reason = written;
          ev.reasonSource = 'carbon';
        }
      } catch (e) {
        warnings.push(`reason writer failed for ${s.id}: ${e instanceof Error ? e.message : String(e)}; used the template`);
      }
      return item('new-damage', reason, conf, { ...frameRefs, costUsd: price.costUsd, ...(price.areaM2 !== undefined ? { areaM2: price.areaM2 } : {}) });
    }

    if (moved.length && moved.length >= supporting.length) {
      return item('moved', `Moved: in ${moved.length} before/after pair(s) of the ${label(s)} the only difference is an object that moved. Furniture moves are never charged.`, Math.max(...moved.map((p) => p.change!.movedOnly)), frameRefs);
    }
    const unchanged = independentPairs(ev.pairs.filter((p) => p.role === 'unchanged'), frames, cfg.DISTINCT_HAMMING);
    if (unchanged) {
      return item(
        'pre-existing',
        `Pre-existing: 2 independent before/after pairs show this ${m.type} on the ${label(s)} was already there at move-in${prior ? ' and did not get worse' : ''}. Not charged.`,
        1 - Math.max(unchanged[0].signal!, unchanged[1].signal!),
        { beforeFrameId: unchanged[0].beforeFrameId, afterFrameId: unchanged[0].afterFrameId },
      );
    }
    const why =
      !before.length || !after.length
        ? `no usable ${!before.length ? 'move-in' : 'move-out'} frames of the ${label(s)}`
        : `only ${ev.supportingPairs} of the ${cfg.MIN_PAIRS} required independent before/after pairs show the same spot and that it ${changeWord} (${compared} of ${ev.pairs.length} pairs passed the same-region check)`;
    return item('not-visible', `${NOT_PROVABLE_PREFIX} suspected ${m.type} on the ${label(s)}: ${why}. $0.`, m.confidence, frameRefs);
  }

  // 3b. [Elmir] Pair sweep: frame-to-frame comparison that does not depend on R4 having flagged the spot.
  //     Only adds verdicts for surfaces the findings path did not already settle as damage/pre-existing/wear.
  const sweepJudged: { item: DiffItem; evidence: SurfaceEvidence }[] = [];
  if (sweepOn) {
    try {
      const settled = new Set(judged.filter((j) => ['new-damage', 'pre-existing', 'wear'].includes(j.item.verdict)).map((j) => j.item.surfaceId));
      const sweep = await pairSweep({
        baseFrames: baseParts.flatMap((w) => w.frames),
        outFrames: input.moveOut.frames,
        localizations: [...baseParts, input.moveOut].flatMap((w) => w.localizations ?? []),
        ask: input.deps?.askSweep ?? decisionsSweepAsker({ env, resolution: cfg.IMAGE_RESOLUTION }),
        cfg,
        perAfter: cfg.SWEEP_PER_AFTER,
        maxPairs: cfg.SWEEP_MAX_PAIRS,
        changeYes: cfg.SWEEP_CHANGE_YES,
      });
      const asPair = (p: SweepPair): PairResult => ({
        beforeFrameId: p.beforeFrameId,
        afterFrameId: p.afterFrameId,
        sameRegion: round3(p.sameRegion),
        status: 'compared',
        change: { newDamage: round3(p.newDamage), worse: 0, movedOnly: round3(p.movedOnly) },
        signal: round3(p.newDamage),
        role: p.supports ? 'supports' : p.moved ? 'moved' : 'unclear',
      });
      for (const h of sweep.hits) {
        if (settled.has(h.surfaceId) || !surfaces.has(h.surfaceId)) continue;
        const s = surfaces.get(h.surfaceId)!;
        const proof: [PairResult, PairResult] = [asPair(h.proof[0]), asPair(h.proof[1])];
        const ev: SurfaceEvidence = {
          surfaceId: s.id,
          issueType: h.issue,
          verdict: h.wear ? 'wear' : 'new-damage',
          signal: 'newDamage',
          beforeFrameIds: [h.proof[0].beforeFrameId, h.proof[1].beforeFrameId],
          afterFrameIds: [h.proof[0].afterFrameId, h.proof[1].afterFrameId],
          pairs: sweep.pairs.filter((p) => p.supports && [p.afterFrameId, p.beforeFrameId].some((id) => ev_ids(h).has(id))).map(asPair),
          proof,
          supportingPairs: 2,
        };
        const refs = { beforeFrameId: h.proof[0].beforeFrameId, afterFrameId: h.proof[0].afterFrameId };
        if (h.wear) {
          sweepJudged.push({ item: DiffItemSchema.parse({ surfaceId: s.id, verdict: 'wear', issueType: h.issue, reason: `Wear: 2 independent before/after pairs show a new small ${h.issue} on the ${label(s)}, within normal wear and tear. Not charged.`, confidence: round3(clamp01(h.confidence)), costUsd: 0, ...refs }), evidence: ev });
          continue;
        }
        const price = priceDamage({ plan, surfaceId: s.id, issueType: h.issue, pricing, depreciation: input.depreciation });
        ev.price = price;
        ev.reasonSource = 'template';
        const reason = `New ${h.issue} on the ${label(s)}: 2 independent before/after pairs agree it is the same spot and that it is new; ${describePrice(price)} (placeholder rates).`;
        sweepJudged.push({
          item: DiffItemSchema.parse({ surfaceId: s.id, verdict: 'new-damage', issueType: h.issue, reason, confidence: round3(clamp01(h.confidence)), costUsd: price.costUsd, ...refs, ...(price.areaM2 !== undefined ? { areaM2: price.areaM2 } : {}) }),
          evidence: ev,
        });
      }
      if (!sweep.hits.length && sweep.pairs.some((p) => p.supports)) warnings.push(`pair sweep: ${sweep.pairs.filter((p) => p.supports).length} pair(s) suggested new damage but no wall had 2 independent ones; not charged`);
    } catch (e) {
      warnings.push(`pair sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    tick();
  }

  // 4. Hydrogen objects seen in both walkthroughs on different surfaces → moved (never charged).
  const movedItems = movedObjectItems(plan, baseParts, input.moveOut, cfg);

  // 5. Every other plan surface: hidden in either walkthrough → not-visible, else no-change.
  const reported = new Set([...movedItems, ...judged.map((j) => j.item), ...sweepJudged.map((j) => j.item)].map((i) => i.surfaceId));
  const fill: DiffItem[] = [];
  for (const s of plan.surfaces) {
    if (reported.has(s.id)) continue;
    const inBase = covered(baseCoverage, s.id);
    const inOut = covered(outCoverage, s.id);
    if (!inBase || !inOut) {
      const where = !inBase && !inOut ? 'either walkthrough' : !inBase ? 'the move-in walkthrough' : 'the move-out walkthrough';
      fill.push(DiffItemSchema.parse({ surfaceId: s.id, verdict: 'not-visible', reason: `Not visible: the ${label(s)} is not clearly seen in ${where}, so it cannot be compared.`, confidence: 1, costUsd: 0 }));
    } else {
      const had = baseFindings.filter((b) => b.surfaceId === s.id).map((b) => b.type);
      const reason = had.length
        ? `No change found: the move-in ${[...new Set(had)].join(', ')} on the ${label(s)} was not flagged at move-out.`
        : `No change: no damage found on the ${label(s)} in either walkthrough.`;
      fill.push(DiffItemSchema.parse({ surfaceId: s.id, verdict: 'no-change', reason, confidence: 1, costUsd: 0 }));
    }
  }
  tick();

  // Order: moved objects, then judged findings, then fill-ins (per-surface readers keep the last item).
  return {
    items: [...movedItems, ...judged.map((j) => j.item), ...sweepJudged.map((j) => j.item), ...fill],
    evidence: [...judged.map((j) => j.evidence), ...sweepJudged.map((j) => j.evidence)],
    warnings,
  };
}

/** Object term → its most frequent surface in one walkthrough (≥ minFrames sightings). */
function objectSurfaces(w: WalkthroughEvidence, minFrames: number): Map<string, { surfaceId: string; frames: number; frameId: string }> {
  const out = new Map<string, { surfaceId: string; frames: number; frameId: string }>();
  if (!w.captions?.length || !w.localizations?.length) return out;
  const where = new Map(w.localizations.map((l) => [l.frameId, l.surfaceId]));
  const counts = new Map<string, Map<string, { n: number; frameId: string }>>();
  for (const c of w.captions) {
    const sid = where.get(c.frameId);
    if (!sid || sid === 'none') continue;
    for (const obj of c.objects) {
      const bySurface = counts.get(obj) ?? new Map<string, { n: number; frameId: string }>();
      const cur = bySurface.get(sid) ?? { n: 0, frameId: c.frameId };
      cur.n++;
      bySurface.set(sid, cur);
      counts.set(obj, bySurface);
    }
  }
  for (const [obj, bySurface] of counts) {
    let best: [string, { n: number; frameId: string }] | undefined;
    for (const e of bySurface) if (!best || e[1].n > best[1].n) best = e;
    if (best && best[1].n >= minFrames) out.set(obj, { surfaceId: best[0], frames: best[1].n, frameId: best[1].frameId });
  }
  return out;
}

function movedObjectItems(plan: FloorPlan, baseParts: WalkthroughEvidence[], moveOut: WalkthroughEvidence, cfg: DiffConfig): DiffItem[] {
  const surfaces = new Map(plan.surfaces.map((s) => [s.id, s]));
  const before = new Map<string, { surfaceId: string; frames: number; frameId: string }>();
  for (const w of baseParts) for (const [k, v] of objectSurfaces(w, cfg.OBJECT_MIN_FRAMES)) if (!before.has(k)) before.set(k, v);
  const after = objectSurfaces(moveOut, cfg.OBJECT_MIN_FRAMES);
  const items: DiffItem[] = [];
  for (const [obj, a] of after) {
    const b = before.get(obj);
    if (!b || b.surfaceId === a.surfaceId || !surfaces.has(a.surfaceId)) continue;
    const from = surfaces.get(b.surfaceId);
    const to = surfaces.get(a.surfaceId)!;
    items.push(
      DiffItemSchema.parse({
        surfaceId: a.surfaceId,
        verdict: 'moved',
        reason: `Moved: the ${obj} was by the ${from ? label(from) : b.surfaceId} at move-in and by the ${label(to)} at move-out. Furniture moves are never charged.`,
        beforeFrameId: b.frameId,
        afterFrameId: a.frameId,
        confidence: round3(Math.min(1, Math.min(a.frames, b.frames) / (cfg.OBJECT_MIN_FRAMES * 2))),
        costUsd: 0,
      }),
    );
  }
  return items;
}

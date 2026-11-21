// [Rahim] R3: room per frame (Decisions choice), surface per frame (choice + visible noul), HMM smoothing,
// Carbon for low-posterior frames, coverage per surface.
//
//   rooms:    one decide() per keyframe, `choice` over the plan's rooms + "other"; ≥3-frame rule.
//   surfaces: one decide() per keyframe: `choice` "which surface fills most of the frame" over the room's
//             surfaces + "other", and one `noul` "is <surface> visible" per candidate, in the same request.
//   HMM:      Viterbi path + forward-backward posteriors per room segment (localizeConfig.ts).
//   Carbon:   posterior < 0.6 -> frame + top-3 candidates + plan image (or room text) -> { surfaceId, reason }.
//   coverage: frames with P(visible) > 0.7 per surface; < 2 -> not-visible for this walkthrough.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import {
  QuestionKeys,
  dataDir,
  decide,
  generate,
  modelId,
  type ChoiceQuestion,
  type Content,
  type DecisionQuestion,
  type NoulQuestion,
  type Part,
} from '@ledger/gemini';
import { LocalizationSchema, type FloorPlan, type Frame, type Localization, type Surface } from '@ledger/shared';
import { describeRoom, describeRoomInDetail, describeSurface, roomSurfaces, surfaceFeatures } from './describe.js';
import { forwardBackward, transitionMatrix, viterbi } from './hmm.js';
import { LOCALIZE, type LocalizeConfig } from './localizeConfig.js';
import type { OnProgress } from './progress.js';

/** Localization.roomId for frames outside every plan room (hallway, closet, unclear). */
export const OTHER_ROOM = 'other';
/** Localization.surfaceId when no plan surface fills the frame. */
export const NO_SURFACE = 'none';

// ---------------------------------------------------------------------------------------------
// Types

export interface FrameContext {
  frame: Frame;
  /** Hydrogen landmarks for this frame (hints, may be empty). */
  landmarks: string[];
}

/** -> probability per plan room ID and OTHER_ROOM. */
export type RoomAsker = (ctx: FrameContext) => Promise<Record<string, number>>;

export interface SurfaceAnswer {
  /** Probability per candidate surface ID and NO_SURFACE (sums to 1). */
  choice: Record<string, number>;
  /** P(visible) per candidate surface ID. */
  visible: Record<string, number>;
}
export type SurfaceAsker = (ctx: FrameContext & { roomId: string; candidates: Surface[] }) => Promise<SurfaceAnswer>;

export interface CarbonCandidate {
  surfaceId: string;
  description: string;
  posterior: number;
}
export type CarbonAsker = (ctx: {
  frame: Frame;
  roomId: string;
  candidates: CarbonCandidate[];
  /** plan.svg rendered to PNG, when a plan SVG exists. */
  planPng?: Buffer;
  /** Text description of the room (always provided; used when planPng is missing). */
  roomText: string;
}) => Promise<{ surfaceId: string; reason: string }>;

export interface LocalizeDeps {
  askRoom?: RoomAsker;
  askSurfaces?: SurfaceAsker;
  askCarbon?: CarbonAsker;
}

export interface LocalizeOptions {
  captions?: { frameId: string; landmarks: string[] }[];
  config?: Partial<LocalizeConfig>;
  deps?: LocalizeDeps;
  /** Plan SVG text. Else read from planSvgPath, else <DATA_DIR>/units/<unitId>/plan.svg if it exists. */
  planSvg?: string;
  planSvgPath?: string;
  /** Write the full result (localization.json) here. */
  outPath?: string;
  onProgress?: OnProgress;
  env?: NodeJS.ProcessEnv;
}

export interface SurfaceCoverage {
  /** Keyframes with P(visible) above VISIBLE_ABOVE. */
  frames: number;
  frameIds: string[];
  /** frames < MIN_COVERAGE: this surface is not-visible for this walkthrough. */
  notVisible: boolean;
}

export interface CarbonCall {
  frameId: string;
  candidates: CarbonCandidate[];
  hmmSurfaceId: string;
  surfaceId: string;
  reason: string;
  usedPlanImage: boolean;
  error?: string;
}

export interface FrameTrace {
  frameId: string;
  tMs: number;
  rawRoom: string;
  roomId: string;
  /** Argmax of the per-frame emission, before the HMM. */
  rawSurfaceId: string;
  surfaceId: string;
  confidence: number;
  decidedBy: 'hmm' | 'carbon' | 'room';
}

export interface LocalizeResult {
  localizations: Localization[];
  coverage: Record<string, SurfaceCoverage>;
  notVisible: string[];
  carbon: CarbonCall[];
  trace: FrameTrace[];
}

// ---------------------------------------------------------------------------------------------
// Room smoothing

function argmax(p: Record<string, number>): string {
  let best = '';
  let bv = -Infinity;
  for (const [k, v] of Object.entries(p)) if (v > bv) [best, bv] = [k, v];
  return best;
}

/**
 * A room change needs ≥ minRun consecutive frames agreeing; the change starts at the first frame of
 * that run. Shorter blips keep the current room. The initial room is the first run of ≥ minRun frames
 * (so leading noise is absorbed), else the most frequent label.
 */
export function smoothRooms(raw: string[], minRun: number = LOCALIZE.ROOM_MIN_RUN): string[] {
  if (!raw.length) return [];
  const runs: { label: string; n: number }[] = [];
  for (const r of raw) {
    const last = runs.at(-1);
    if (last && last.label === r) last.n++;
    else runs.push({ label: r, n: 1 });
  }
  let current = runs.find((r) => r.n >= minRun)?.label;
  if (current === undefined) {
    const counts = new Map<string, number>();
    for (const r of raw) counts.set(r, (counts.get(r) ?? 0) + 1);
    current = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  const out: string[] = [];
  for (const run of runs) {
    if (run.label !== current && run.n >= minRun) current = run.label;
    for (let i = 0; i < run.n; i++) out.push(current);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Default askers: Decisions API (rooms, surfaces) and Carbon

/** Choice option keys: 1-128 printable ASCII chars, no leading/trailing space (docs/vendor/decisions-api.md "Limits"). */
const OPTION_KEY_RE = /^[\x21-\x7e](?:[\x20-\x7e]{0,126}[\x21-\x7e])?$/;

/** Option keys for IDs: the ID itself when valid (the model reads it), else `opt<n>`; plus a catch-all. */
function optionKeys(ids: string[], catchAll: string): { toKey: Map<string, string>; fromKey: Map<string, string>; other: string } {
  const toKey = new Map<string, string>();
  const fromKey = new Map<string, string>();
  ids.forEach((id, i) => {
    const k = OPTION_KEY_RE.test(id) && !fromKey.has(id) ? id : `opt${i}`;
    toKey.set(id, k);
    fromKey.set(k, id);
  });
  let other = catchAll;
  for (let i = 2; fromKey.has(other); i++) other = `${catchAll}-${i}`;
  return { toKey, fromKey, other };
}

async function frameImage(frame: Frame, cfg: LocalizeConfig): Promise<Content> {
  return { type: 'image', mime_type: 'image/jpeg', data: (await readFile(frame.path)).toString('base64'), resolution: cfg.IMAGE_RESOLUTION };
}

function hintText(landmarks: string[]): string {
  const base = 'Keyframe from a walkthrough video of an apartment, filmed with a handheld phone.';
  return landmarks.length
    ? `${base}\nA fast detector listed these fixed features in this frame (hints, may be wrong): ${landmarks.join(', ')}.\n`
    : `${base}\n`;
}

export interface DecisionsAskerOptions {
  env?: NodeJS.ProcessEnv;
  config?: Partial<LocalizeConfig>;
  /** Defaults to @ledger/gemini decide (tests wrap it to inspect requests). */
  decideFn?: typeof decide;
}

export function decisionsRoomAsker(plan: FloorPlan, opts: DecisionsAskerOptions = {}): RoomAsker {
  const cfg = { ...LOCALIZE, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  const keys = optionKeys(plan.rooms.map((r) => r.id), 'other');
  const criteria: Record<string, string> = {};
  for (const r of plan.rooms) criteria[keys.toKey.get(r.id)!] = describeRoom(plan, r);
  criteria[keys.other] = 'A hallway, closet, entryway or any space not listed above, or no room can be identified.';

  return async ({ frame, landmarks }) => {
    const qk = new QuestionKeys();
    const q: ChoiceQuestion = {
      type: 'choice',
      instructions:
        'Which room of this apartment was this photo taken in? Compare what the camera shows (windows, doors, fixtures, room size and shape) with each room description.',
      criteria,
    };
    const key = qk.key(plan.unitId, 'room');
    const { answers } = await decideFn({
      input: [{ type: 'text', text: hintText(landmarks) }, await frameImage(frame, cfg)],
      questions: { [key]: q },
      tag: 'localize.room',
      env: opts.env,
    });
    const out: Record<string, number> = {};
    for (const [k, p] of Object.entries(answers[key]!.probabilities)) {
      out[k === keys.other ? OTHER_ROOM : keys.fromKey.get(k) ?? k] = p;
    }
    return out;
  };
}

export function decisionsSurfaceAsker(plan: FloorPlan, opts: DecisionsAskerOptions = {}): SurfaceAsker {
  const cfg = { ...LOCALIZE, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  return async ({ frame, landmarks, roomId, candidates }) => {
    const roomName = plan.rooms.find((r) => r.id === roomId)?.name ?? roomId;
    const keys = optionKeys(candidates.map((s) => s.id), 'other');
    const criteria: Record<string, string> = {};
    for (const s of candidates) criteria[keys.toKey.get(s.id)!] = describeSurface(plan, s);
    criteria[keys.other] =
      'None of these surfaces: mostly furniture or objects, a view through a doorway into another room, or too blurry to tell.';

    const qk = new QuestionKeys();
    const questions: Record<string, DecisionQuestion> = {};
    const choiceKey = qk.key(roomId, 'surface');
    questions[choiceKey] = {
      type: 'choice',
      instructions: `This photo was taken in the ${roomName}. Which single surface of the ${roomName} fills most of the frame?`,
      criteria,
    } satisfies ChoiceQuestion;
    for (const s of candidates) {
      questions[qk.key(s.id, 'visible')] = {
        type: 'noul',
        instructions: `This photo was taken in the ${roomName}. Is this surface visible in the photo, even partly? Surface: ${describeSurface(plan, s)}.`,
        criteria: {
          true_description: 'At least part of this specific surface appears in the photo.',
          false_description: 'This surface does not appear in the photo.',
        },
      } satisfies NoulQuestion;
    }

    const { answers } = await decideFn({
      input: [{ type: 'text', text: hintText(landmarks) }, await frameImage(frame, cfg)],
      questions,
      tag: 'localize.surface',
      env: opts.env,
    });

    const choice: Record<string, number> = {};
    const visible: Record<string, number> = {};
    for (const [k, a] of Object.entries(answers)) {
      const ref = qk.decode(k);
      if (ref.purpose === 'surface' && a.type === 'choice') {
        for (const [opt, p] of Object.entries(a.probabilities)) choice[opt === keys.other ? NO_SURFACE : keys.fromKey.get(opt) ?? opt] = p;
      } else if (ref.purpose === 'visible' && a.type === 'noul') {
        visible[ref.surfaceId] = a.noul;
      }
    }
    return { choice, visible };
  };
}

export function carbonAsker(opts: { env?: NodeJS.ProcessEnv; config?: Partial<LocalizeConfig> } = {}): CarbonAsker {
  const cfg = { ...LOCALIZE, ...opts.config };
  return async ({ frame, roomId, candidates, planPng, roomText }) => {
    const ids: [string, ...string[]] = [NO_SURFACE, ...candidates.map((c) => c.surfaceId)];
    const schema = z.object({ surfaceId: z.enum(ids), reason: z.string().min(1).max(600) });
    const parts: Part[] = [
      {
        type: 'text',
        text: [
          'You are locating one keyframe of an apartment walkthrough video on the floor plan.',
          `The camera is in room "${roomId}". A classifier could not decide which surface fills most of the frame.`,
          'Candidates (surface ID: description):',
          ...candidates.map((c) => `- ${c.surfaceId}: ${c.description}`),
          `Pick the candidate that fills most of the frame, or "${NO_SURFACE}" if none of them does.`,
          'Use doors, windows, fixtures and wall lengths to decide. Give a one-sentence reason.',
          'Return JSON {"surfaceId": "...", "reason": "..."}.',
          '\nFRAME:',
        ].join('\n'),
      },
      await frameImage(frame, cfg),
    ];
    if (planPng) {
      parts.push({ type: 'text', text: '\nFLOOR PLAN (top-down, north up, walls labelled with their surface IDs):' });
      parts.push({ type: 'image', mime_type: 'image/png', data: planPng.toString('base64') });
    } else {
      parts.push({ type: 'text', text: `\nROOM (from the floor plan):\n${roomText}` });
    }
    return generate({ model: modelId('deep', opts.env), parts, schema, tag: 'localize.carbon', env: opts.env });
  };
}

async function loadPlanPng(plan: FloorPlan, opts: LocalizeOptions): Promise<Buffer | undefined> {
  let svg = opts.planSvg;
  if (svg === undefined) {
    const candidates = [opts.planSvgPath, join(dataDir(opts.env), 'units', plan.unitId, 'plan.svg')];
    const path = candidates.find((p): p is string => !!p && existsSync(p));
    if (path) svg = await readFile(path, 'utf8');
  }
  if (!svg) return undefined;
  try {
    return await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// HMM over one room segment

function roomAdjacency(states: (Surface | null)[]): (i: number, j: number) => boolean {
  const isFlat = (s: Surface) => s.kind === 'floor' || s.kind === 'ceiling';
  return (i, j) => {
    const a = states[i];
    const b = states[j];
    if (!a || !b) return true; // `none` is next to everything
    if (a.neighbors?.includes(b.id) || b.neighbors?.includes(a.id)) return true;
    return (isFlat(a) && b.kind === 'wall') || (isFlat(b) && a.kind === 'wall');
  };
}

function emission(plan: FloorPlan, states: (Surface | null)[], ans: SurfaceAnswer, landmarks: string[], boost: number): number[] {
  const seen = new Set(landmarks.map((l) => l.toLowerCase()));
  const raw = states.map((s) => {
    const p = ans.choice[s ? s.id : NO_SURFACE] ?? 0;
    return s && seen.size && surfaceFeatures(plan, s).some((f) => seen.has(f)) ? p * boost : p;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((x) => x / sum) : raw.map(() => 1 / raw.length);
}

// ---------------------------------------------------------------------------------------------

/** Localize every keyframe of one walkthrough on the plan. */
export async function localizeWalkthrough(plan: FloorPlan, framesIn: Frame[], opts: LocalizeOptions = {}): Promise<LocalizeResult> {
  const cfg: LocalizeConfig = { ...LOCALIZE, ...opts.config };
  const env = opts.env;
  const askRoom = opts.deps?.askRoom ?? decisionsRoomAsker(plan, { env, config: cfg });
  const askSurfaces = opts.deps?.askSurfaces ?? decisionsSurfaceAsker(plan, { env, config: cfg });
  const askCarbon = opts.deps?.askCarbon ?? carbonAsker({ env, config: cfg });
  const frames = [...framesIn].sort((a, b) => a.tMs - b.tMs);
  const hints = new Map((opts.captions ?? []).map((c) => [c.frameId, c.landmarks]));
  const ctx = (f: Frame): FrameContext => ({ frame: f, landmarks: hints.get(f.id) ?? [] });
  const roomIds = new Set(plan.rooms.map((r) => r.id));

  // 1. Rooms
  let done = 0;
  const roomProbs = await Promise.all(
    frames.map(async (f) => {
      const p = await askRoom(ctx(f));
      opts.onProgress?.('rooms', ++done, frames.length);
      return p;
    }),
  );
  const rawRooms = roomProbs.map((p) => {
    const r = argmax(p);
    return roomIds.has(r) ? r : OTHER_ROOM;
  });
  const rooms = smoothRooms(rawRooms, cfg.ROOM_MIN_RUN);

  // 2. Surfaces (one request per frame in a plan room)
  done = 0;
  const candidatesOf = new Map(plan.rooms.map((r) => [r.id, roomSurfaces(plan, r.id)]));
  const answers = await Promise.all(
    frames.map(async (f, t) => {
      const cands = candidatesOf.get(rooms[t]!) ?? [];
      const a = cands.length ? await askSurfaces({ ...ctx(f), roomId: rooms[t]!, candidates: cands }) : undefined;
      opts.onProgress?.('surfaces', ++done, frames.length);
      return a;
    }),
  );

  // 3. HMM per room segment
  const trace: FrameTrace[] = frames.map((f, t) => ({
    frameId: f.id,
    tMs: f.tMs,
    rawRoom: rawRooms[t]!,
    roomId: rooms[t]!,
    rawSurfaceId: NO_SURFACE,
    surfaceId: NO_SURFACE,
    confidence: roomProbs[t]![rooms[t]!] ?? 0,
    decidedBy: 'room',
  }));
  interface Seg {
    roomId: string;
    idx: number[];
    states: (Surface | null)[];
    post: number[][];
    path: number[];
  }
  const segs: Seg[] = [];
  for (let t = 0; t < frames.length; t++) {
    if (!answers[t]) continue;
    const last = segs.at(-1);
    if (last && last.roomId === rooms[t] && last.idx.at(-1) === t - 1) last.idx.push(t);
    else segs.push({ roomId: rooms[t]!, idx: [t], states: [...candidatesOf.get(rooms[t]!)!, null], post: [], path: [] });
  }
  const stateId = (s: Surface | null) => (s ? s.id : NO_SURFACE);
  for (const seg of segs) {
    const E = seg.idx.map((t) => emission(plan, seg.states, answers[t]!, hints.get(frames[t]!.id) ?? [], cfg.LANDMARK_BOOST));
    const T = transitionMatrix(seg.states.length, roomAdjacency(seg.states), cfg.TRANSITION);
    seg.path = viterbi(E, T, cfg.EMISSION_FLOOR);
    seg.post = forwardBackward(E, T, cfg.EMISSION_FLOOR);
    seg.idx.forEach((t, k) => {
      const s = seg.path[k]!;
      Object.assign(trace[t]!, {
        rawSurfaceId: stateId(seg.states[E[k]!.indexOf(Math.max(...E[k]!))]!),
        surfaceId: stateId(seg.states[s]!),
        confidence: seg.post[k]![s]!,
        decidedBy: 'hmm',
      });
    });
  }

  // 4. Carbon for the least certain frames
  const unsure = segs
    .flatMap((seg) => seg.idx.map((t, k) => ({ seg, t, k })))
    .filter(({ t }) => trace[t]!.confidence < cfg.CARBON_BELOW)
    .sort((a, b) => trace[a.t]!.confidence - trace[b.t]!.confidence)
    .slice(0, cfg.MAX_CARBON_CALLS);
  const carbon: CarbonCall[] = [];
  if (unsure.length) {
    const planPng = await loadPlanPng(plan, opts);
    await Promise.all(
      unsure.map(async ({ seg, t, k }) => {
        const post = seg.post[k]!;
        const top3 = seg.states
          .map((s, i) => ({ s, p: post[i]! }))
          .filter((x): x is { s: Surface; p: number } => x.s !== null)
          .sort((a, b) => b.p - a.p)
          .slice(0, 3)
          .map(({ s, p }) => ({ surfaceId: s.id, description: describeSurface(plan, s), posterior: p }));
        const call: CarbonCall = {
          frameId: frames[t]!.id,
          candidates: top3,
          hmmSurfaceId: trace[t]!.surfaceId,
          surfaceId: trace[t]!.surfaceId,
          reason: '',
          usedPlanImage: !!planPng,
        };
        try {
          const r = await askCarbon({ frame: frames[t]!, roomId: seg.roomId, candidates: top3, planPng, roomText: describeRoomInDetail(plan, seg.roomId) });
          const i = seg.states.findIndex((s) => stateId(s) === r.surfaceId);
          if (i < 0 || (r.surfaceId !== NO_SURFACE && !top3.some((c) => c.surfaceId === r.surfaceId))) {
            throw new Error(`Carbon picked "${r.surfaceId}", not a candidate`);
          }
          Object.assign(call, { surfaceId: r.surfaceId, reason: r.reason });
          // Carbon has no calibrated probability: confidence stays the HMM posterior of its pick.
          Object.assign(trace[t]!, { surfaceId: r.surfaceId, confidence: post[i]!, decidedBy: 'carbon' });
        } catch (e) {
          call.error = e instanceof Error ? e.message : String(e);
        }
        carbon.push(call);
      }),
    );
    carbon.sort((a, b) => a.frameId.localeCompare(b.frameId));
  }

  // 5. Localizations + coverage
  const localizations = frames.map((f, t) =>
    LocalizationSchema.parse({
      frameId: f.id,
      roomId: trace[t]!.roomId,
      surfaceId: trace[t]!.surfaceId,
      confidence: Math.min(1, Math.max(0, trace[t]!.confidence)),
      visible: answers[t]?.visible ?? {},
    }),
  );
  const coverage: Record<string, SurfaceCoverage> = {};
  for (const s of plan.surfaces) {
    const frameIds = localizations.filter((l) => (l.visible[s.id] ?? 0) > cfg.VISIBLE_ABOVE).map((l) => l.frameId);
    coverage[s.id] = { frames: frameIds.length, frameIds, notVisible: frameIds.length < cfg.MIN_COVERAGE };
  }
  const notVisible = plan.surfaces.filter((s) => coverage[s.id]!.notVisible).map((s) => s.id);

  const result: LocalizeResult = { localizations, coverage, notVisible, carbon, trace };
  if (opts.outPath) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, JSON.stringify(result, null, 2));
  }
  return result;
}

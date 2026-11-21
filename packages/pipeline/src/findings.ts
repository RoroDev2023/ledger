// [Rahim] R4: visibility gate + damage checklist + severity per frame, noisy-OR, Carbon for 0.3-0.7.
//
//   frames:   per covered surface (R3 coverage, notVisible skipped), the 3 frames with the highest
//             P(visible) × relative sharpness.
//   decide:   ONE Decisions request per frame: gate `noul` + one damage `noul` per checklist issue + one
//             severity `score` per checklist issue (11 questions). Every question restates room + surface,
//             because Decisions evaluates each question independently.
//   gate:     in code, a frame whose gate fails is dropped with all its answers. Fewer than 2 surviving
//             frames -> the surface is not-visible for this walkthrough (matches R5's two-pair rule).
//   combine:  noisy-OR per issue over surviving frames: P = 1 − Π(1 − p_i).
//             P ≥ 0.7 -> Finding (decisions-api) · P ≤ 0.3 -> none · between -> Carbon (capped per walkthrough).
//   severity: per issue, p-weighted mean of that issue's zero-based score -> severityFromScore -> 1-5.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  QuestionKeys,
  decide,
  generate,
  modelId,
  type Content,
  type DecisionQuestion,
  type NoulQuestion,
  type Part,
  type ScoreQuestion,
} from '@ledger/gemini';
import {
  BBoxSchema,
  FindingSchema,
  IssueTypeSchema,
  SeveritySchema,
  scoreToSeverity,
  type FloorPlan,
  type Finding,
  type Frame,
  type IssueType,
  type Localization,
  type Surface,
} from '@ledger/shared';
import { FINDINGS, type FindingsConfig } from './findingsConfig.js';

// ---------------------------------------------------------------------------------------------
// Checklist

/** Issue types asked on every frame. `other` only comes from Carbon. */
export const CHECKLIST_ISSUES = ['crack', 'stain', 'hole', 'scuff', 'missing-fixture'] as const satisfies readonly IssueType[];
export type ChecklistIssue = (typeof CHECKLIST_ISSUES)[number];

/** Concrete look of each issue (Elmir's spike: naming what a mark looks like beats generic "damage"). */
export const ISSUE_LOOKS: Record<ChecklistIssue, string> = {
  crack: 'a crack: a thin dark line, fracture or split in the plaster, paint, tile, wood or glass',
  stain: 'a stain: a discoloured patch, water mark, grease, ink, mold or dirt that is not part of the finish',
  hole: 'a hole: a puncture, dent, gouge, nail or screw hole, or a hole left by a wall anchor',
  scuff: 'a scuff: a scratch, rub mark, abrasion or dark streak on the finish',
  'missing-fixture':
    'a missing or broken-off fixture: an outlet or switch cover, handle, knob, towel bar, blind, light fitting or similar part that should be there',
};

/** Ordered severity levels, lowest first (zero-based score 0-4 -> severity 1-5). */
export const SEVERITY_LEVELS: readonly string[] = [
  'Faint cosmetic trace: barely visible, only noticeable up close.',
  'Minor localized mark: small but clearly visible, in one spot.',
  'Clearly visible moderate damage: noticeable from a few steps away or covering a larger patch.',
  'Extensive damage or impaired use: a large area, or the surface or fixture no longer works properly.',
  'Severe damage or loss of use: broken through, missing, or unusable.',
];

const IGNORE =
  'Ignore differences in lighting, shadows, reflections and camera angle, and ignore furniture, decor and objects standing in front of the surface.';

// ---------------------------------------------------------------------------------------------
// Pure helpers

/**
 * The one conversion from a Decisions severity `score` (zero-based, may fall between levels) to our
 * integer severity: clamp to [0, 4], then round + 1 (shared `scoreToSeverity`). Non-finite throws.
 */
export function severityFromScore(score: number): Finding['severity'] {
  if (!Number.isFinite(score)) throw new RangeError(`severity score must be finite, got ${score}`);
  return scoreToSeverity(Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, score)));
}

/** Noisy-OR: P(at least one frame is right that the issue is present) = 1 − Π(1 − p_i). */
export function noisyOr(ps: number[]): number {
  let none = 1;
  for (const p of ps) none *= 1 - Math.min(1, Math.max(0, p));
  return 1 - none;
}

/**
 * Up to `n` evidence frames for a surface, from `candidates` (R3's covering frames): ranked by
 * P(visible) × sharpness relative to the sharpest candidate, ties by frame ID.
 */
export function selectEvidenceFrames(surfaceId: string, candidates: Frame[], localizations: Localization[], n: number = FINDINGS.FRAMES_PER_SURFACE): Frame[] {
  const visible = new Map(localizations.map((l) => [l.frameId, l.visible[surfaceId] ?? 0]));
  const unique = [...new Map(candidates.map((f) => [f.id, f])).values()];
  const maxSharp = Math.max(0, ...unique.map((f) => f.sharpness));
  const score = (f: Frame) => (visible.get(f.id) ?? 0) * (maxSharp > 0 ? Math.max(0, f.sharpness) / maxSharp : 1);
  return unique
    .map((f) => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s || (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0))
    .slice(0, n)
    .map((x) => x.f);
}

// ---------------------------------------------------------------------------------------------
// Types

/** Per-surface coverage from R3 (same shape as `SurfaceCoverage` in localize.ts). */
export type FindingsCoverage = Record<string, { frames: number; frameIds: string[]; notVisible: boolean }>;

/** What R4 needs from R3's localization.json. */
export interface FindingsLocalization {
  localizations: Localization[];
  coverage: FindingsCoverage;
}

export interface DamageContext {
  plan: FloorPlan;
  surface: Surface;
  roomName: string;
  frame: Frame;
}

export interface FrameDamageAnswer {
  /** P(surface clearly visible and unobstructed): the gate. */
  visible: number;
  /** P(issue present on this surface) per checklist issue. */
  issues: Record<ChecklistIssue, number>;
  /** Zero-based severity score (0-4) per checklist issue. */
  severity: Record<ChecklistIssue, number>;
}
export type FrameDamageAsker = (ctx: DamageContext) => Promise<FrameDamageAnswer>;

/** Carbon's second look. bbox is normalized [ymin, xmin, ymax, xmax] on the first frame sent. */
export const CarbonFindingSchema = z.object({
  present: z.boolean(),
  type: IssueTypeSchema,
  severity: SeveritySchema,
  bbox: BBoxSchema.optional(),
  note: z.string().min(1).max(600),
});
export type CarbonFindingAnswer = z.infer<typeof CarbonFindingSchema>;

export interface CarbonFindingContext {
  plan: FloorPlan;
  surface: Surface;
  roomName: string;
  issueType: ChecklistIssue;
  /** The noisy-OR P that landed between the thresholds. */
  probability: number;
  /** Frames that passed the gate, strongest evidence first. Carbon boxes frames[0]. */
  frames: Frame[];
}
export type CarbonFindingAsker = (ctx: CarbonFindingContext) => Promise<CarbonFindingAnswer>;

export interface FindingsDeps {
  askFrame?: FrameDamageAsker;
  askCarbon?: CarbonFindingAsker;
}

export interface FindingsOptions {
  /** Defaults to the walkthroughId of the first frame. */
  walkthroughId?: string;
  config?: Partial<FindingsConfig>;
  deps?: FindingsDeps;
  /** Same shape as R3's OnProgress, stage 'findings'. */
  onProgress?: (stage: 'findings', done: number, total: number) => void;
  env?: NodeJS.ProcessEnv;
}

export type IssueOutcome = 'finding' | 'none' | 'carbon' | 'carbon-absent' | 'carbon-cap' | 'carbon-error' | 'carbon-duplicate';

export interface SurfaceFindingsTrace {
  surfaceId: string;
  status: 'inspected' | 'not-visible';
  /** Why the surface is not-visible (coverage, missing frames, or the gate). */
  reason?: string;
  /** Frames asked (≤ FRAMES_PER_SURFACE). */
  selected: string[];
  /** Frames that passed the gate. */
  accepted: string[];
  frames: ({ frameId: string } & FrameDamageAnswer)[];
  issues: Partial<Record<ChecklistIssue, { p: number; outcome: IssueOutcome }>>;
}

export interface CarbonFindingTrace {
  surfaceId: string;
  issueType: ChecklistIssue;
  probability: number;
  frameIds: string[];
  answer?: CarbonFindingAnswer;
  error?: string;
}

export interface FindingsResult {
  findings: Finding[];
  /** Surfaces with no usable evidence in this walkthrough: R3 notVisible plus gate failures. */
  notVisible: string[];
  surfaces: Record<string, SurfaceFindingsTrace>;
  carbon: CarbonFindingTrace[];
}

// ---------------------------------------------------------------------------------------------
// Question text

/** "Room: Bedroom. Surface: Bedroom east wall (surface ID bedroom.wall-e), a wall about 2.5 m wide, with a window." */
function whereText(plan: FloorPlan, surface: Surface, roomName: string): string {
  const bits: string[] = [];
  if (surface.kind === 'wall' && surface.segment) {
    const [[x0, y0], [x1, y1]] = surface.segment;
    bits.push(`a wall about ${Math.hypot(x1 - x0, y1 - y0).toFixed(1)} m wide`);
  } else {
    bits.push(`the ${surface.kind}`);
  }
  const features = new Set<string>([
    ...plan.openings.filter((o) => o.wallId === surface.id).map((o) => o.kind),
    ...(surface.landmarks ?? []),
  ]);
  if (features.size) bits.push(`with ${[...features].map((f) => `a ${f}`).join(', ')}`);
  return `Room: ${roomName}. Surface: ${surface.label || surface.id} (surface ID ${surface.id}), ${bits.join(', ')}.`;
}

/** The 11 questions for one frame, keyed by QuestionKeys (surfaceId, purpose). Exported for tests and the eval. */
export function damageQuestions(plan: FloorPlan, surface: Surface, roomName: string, qk: QuestionKeys): Record<string, DecisionQuestion> {
  const where = whereText(plan, surface, roomName);
  const questions: Record<string, DecisionQuestion> = {};
  questions[qk.key(surface.id, 'gate')] = {
    type: 'noul',
    instructions: `${where}\nIs this surface clearly visible in the photo and not blocked by furniture, objects or people, so that marks on it could be seen?`,
    criteria: {
      true_description: 'Most of this specific surface is in view, in focus and unobstructed.',
      false_description: 'This surface is out of view, mostly blocked, too dark or too blurry to inspect.',
    },
  } satisfies NoulQuestion;
  for (const issue of CHECKLIST_ISSUES) {
    questions[qk.key(surface.id, `damage:${issue}`)] = {
      type: 'noul',
      instructions: `${where}\nLook only at this surface. Does it show ${ISSUE_LOOKS[issue]}? ${IGNORE}`,
      criteria: {
        true_description: `This surface shows ${issue === 'missing-fixture' ? 'a missing or broken-off fixture' : `a ${issue}`}.`,
        false_description: `No ${issue === 'missing-fixture' ? 'missing fixture' : issue} is visible on this surface.`,
      },
    } satisfies NoulQuestion;
    questions[qk.key(surface.id, `severity:${issue}`)] = {
      type: 'score',
      instructions: `${where}\nLook only at this surface. If it shows ${ISSUE_LOOKS[issue]}, how severe is the worst one? If there is none, choose the lowest level. ${IGNORE}`,
      criteria: [...SEVERITY_LEVELS],
    } satisfies ScoreQuestion;
  }
  return questions;
}

async function frameImage(frame: Frame, cfg: FindingsConfig): Promise<Content> {
  return { type: 'image', mime_type: 'image/jpeg', data: (await readFile(frame.path)).toString('base64'), resolution: cfg.IMAGE_RESOLUTION };
}

// ---------------------------------------------------------------------------------------------
// Default askers

export interface DamageAskerOptions {
  env?: NodeJS.ProcessEnv;
  config?: Partial<FindingsConfig>;
  /** Defaults to @ledger/gemini decide (tests wrap it to inspect requests). */
  decideFn?: typeof decide;
}

/** One Decisions request per frame with all 11 questions (tag `findings.frame`). */
export function decisionsDamageAsker(opts: DamageAskerOptions = {}): FrameDamageAsker {
  const cfg = { ...FINDINGS, ...opts.config };
  const decideFn = opts.decideFn ?? decide;
  return async ({ plan, surface, roomName, frame }) => {
    const qk = new QuestionKeys();
    const questions = damageQuestions(plan, surface, roomName, qk);
    const { answers } = await decideFn({
      input: [
        { type: 'text', text: 'Keyframe from a walkthrough video of an apartment, filmed with a handheld phone. Inspect the named surface.' },
        await frameImage(frame, cfg),
      ],
      questions,
      tag: 'findings.frame',
      env: opts.env,
    });
    const out: FrameDamageAnswer = {
      visible: 0,
      issues: Object.fromEntries(CHECKLIST_ISSUES.map((i) => [i, 0])) as Record<ChecklistIssue, number>,
      severity: Object.fromEntries(CHECKLIST_ISSUES.map((i) => [i, 0])) as Record<ChecklistIssue, number>,
    };
    for (const [k, a] of Object.entries(answers)) {
      const { purpose } = qk.decode(k);
      if (purpose === 'gate' && a.type === 'noul') out.visible = a.noul;
      else if (purpose.startsWith('damage:') && a.type === 'noul') out.issues[purpose.slice(7) as ChecklistIssue] = a.noul;
      else if (purpose.startsWith('severity:') && a.type === 'score') out.severity[purpose.slice(9) as ChecklistIssue] = a.score;
    }
    return out;
  };
}

/** Carbon (MODEL_DEEP) second look with every accepted frame (tag `findings.carbon`). */
export function carbonFindingAsker(opts: { env?: NodeJS.ProcessEnv; config?: Partial<FindingsConfig> } = {}): CarbonFindingAsker {
  const cfg = { ...FINDINGS, ...opts.config };
  return async ({ plan, surface, roomName, issueType, probability, frames }) => {
    const parts: Part[] = [
      {
        type: 'text',
        text: [
          'You are inspecting one surface of an apartment for damage, using keyframes from a walkthrough video.',
          whereText(plan, surface, roomName),
          `A classifier was unsure (P = ${probability.toFixed(2)}) whether this surface shows ${ISSUE_LOOKS[issueType]}.`,
          `Look at every frame and decide whether that damage, or another kind of damage, is really present on this surface. ${IGNORE}`,
          'If present: "type" is one of crack | stain | hole | scuff | missing-fixture | other; "severity" is 1-5',
          `(${SEVERITY_LEVELS.map((l, i) => `${i + 1} = ${l.split(':')[0]}`).join('; ')});`,
          '"bbox" is the damage on Frame 1 as normalized [ymin, xmin, ymax, xmax], each between 0 and 1, with ymin < ymax and xmin < xmax.',
          'Omit "bbox" if the damage cannot be seen on Frame 1.',
          `If not present: "present" is false, "type" is "${issueType}", "severity" is 1 and no "bbox".`,
          '"note" is one short sentence on what you see and where.',
          'Return JSON {"present": true|false, "type": "...", "severity": 1-5, "bbox": [ymin, xmin, ymax, xmax], "note": "..."}.',
        ].join('\n'),
      },
    ];
    for (const [i, f] of frames.entries()) {
      parts.push({ type: 'text', text: `\nFrame ${i + 1}${i === 0 ? ' (draw the box on this one)' : ''}:` });
      parts.push(await frameImage(f, cfg));
    }
    return generate({ model: modelId('deep', opts.env), parts, schema: CarbonFindingSchema, tag: 'findings.carbon', env: opts.env });
  };
}

// ---------------------------------------------------------------------------------------------

interface CarbonJob {
  surface: Surface;
  roomName: string;
  issue: ChecklistIssue;
  p: number;
  frames: Frame[];
}

/** Damage findings for one walkthrough, pinned to plan surfaces. */
export async function detectFindings(plan: FloorPlan, frames: Frame[], loc: FindingsLocalization, opts: FindingsOptions = {}): Promise<FindingsResult> {
  const cfg: FindingsConfig = { ...FINDINGS, ...opts.config };
  const env = opts.env;
  const askFrame = opts.deps?.askFrame ?? decisionsDamageAsker({ env, config: cfg });
  const askCarbon = opts.deps?.askCarbon ?? carbonFindingAsker({ env, config: cfg });
  const walkthroughId = opts.walkthroughId ?? frames[0]?.walkthroughId ?? 'unknown';
  const framesById = new Map(frames.map((f) => [f.id, f]));
  const roomName = (s: Surface) => plan.rooms.find((r) => r.id === s.roomId)?.name ?? s.roomId;

  const surfaces: Record<string, SurfaceFindingsTrace> = {};
  const notVisible = (s: Surface, reason: string, selected: Frame[] = []) => {
    surfaces[s.id] = { surfaceId: s.id, status: 'not-visible', reason, selected: selected.map((f) => f.id), accepted: [], frames: [], issues: {} };
  };

  // 1. Evidence frames per covered surface.
  const work: { surface: Surface; selected: Frame[] }[] = [];
  for (const s of plan.surfaces) {
    const cov = loc.coverage[s.id];
    if (!cov || cov.notVisible) {
      notVisible(s, cov ? `covered by ${cov.frames} frame(s) in localization` : 'no coverage entry');
      continue;
    }
    const candidates = cov.frameIds.map((id) => framesById.get(id)).filter((f): f is Frame => !!f);
    const selected = selectEvidenceFrames(s.id, candidates, loc.localizations, cfg.FRAMES_PER_SURFACE);
    if (selected.length < cfg.MIN_ACCEPTED_FRAMES) {
      notVisible(s, `only ${selected.length} covering frame(s) available`, selected);
      continue;
    }
    work.push({ surface: s, selected });
  }

  // 2. One Decisions request per (surface, frame). gemini's p-limit(4) throttles.
  const total = work.reduce((n, w) => n + w.selected.length, 0);
  let done = 0;
  opts.onProgress?.('findings', 0, total);
  const answered = await Promise.all(
    work.map(async (w) => ({
      ...w,
      answers: await Promise.all(
        w.selected.map(async (frame) => {
          const a = await askFrame({ plan, surface: w.surface, roomName: roomName(w.surface), frame });
          opts.onProgress?.('findings', ++done, total);
          return { frame, ...a };
        }),
      ),
    })),
  );

  // 3. Gate, noisy-OR, thresholds.
  const findings: Finding[] = [];
  const carbonJobs: CarbonJob[] = [];
  for (const { surface, selected, answers } of answered) {
    const trace: SurfaceFindingsTrace = {
      surfaceId: surface.id,
      status: 'inspected',
      selected: selected.map((f) => f.id),
      accepted: [],
      frames: answers.map(({ frame, ...a }) => ({ frameId: frame.id, ...a })),
      issues: {},
    };
    surfaces[surface.id] = trace;
    const accepted = answers.filter((a) => a.visible >= cfg.GATE_MIN);
    trace.accepted = accepted.map((a) => a.frame.id);
    if (accepted.length < cfg.MIN_ACCEPTED_FRAMES) {
      trace.status = 'not-visible';
      trace.reason = `visibility gate passed on ${accepted.length} of ${answers.length} frame(s)`;
      continue;
    }
    for (const issue of CHECKLIST_ISSUES) {
      const p = noisyOr(accepted.map((a) => a.issues[issue]));
      const byStrength = [...accepted].sort((a, b) => b.issues[issue] - a.issues[issue]);
      if (p >= cfg.FINDING_AT) {
        const support = byStrength.filter((a) => a.issues[issue] >= cfg.SUPPORT_MIN);
        const evidence = support.length ? support : byStrength;
        const wSum = accepted.reduce((n, a) => n + a.issues[issue], 0);
        const score = wSum > 0 ? accepted.reduce((n, a) => n + a.issues[issue] * a.severity[issue], 0) / wSum : 0;
        findings.push(
          FindingSchema.parse({
            id: `${walkthroughId}.${surface.id}.${issue}`,
            walkthroughId,
            surfaceId: surface.id,
            type: issue,
            confidence: p,
            severity: severityFromScore(score),
            frameIds: evidence.map((a) => a.frame.id),
            decidedBy: 'decisions-api',
          } satisfies Finding),
        );
        trace.issues[issue] = { p, outcome: 'finding' };
      } else if (p <= cfg.NONE_AT) {
        trace.issues[issue] = { p, outcome: 'none' };
      } else {
        trace.issues[issue] = { p, outcome: 'carbon' };
        carbonJobs.push({ surface, roomName: roomName(surface), issue, p, frames: byStrength.map((a) => a.frame) });
      }
    }
  }

  // 4. Carbon for the uncertain middle: most uncertain first, capped per walkthrough; the rest abstain.
  carbonJobs.sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5) || a.surface.id.localeCompare(b.surface.id) || a.issue.localeCompare(b.issue));
  const toAsk = carbonJobs.slice(0, Math.max(0, cfg.MAX_CARBON_CALLS));
  for (const j of carbonJobs.slice(toAsk.length)) surfaces[j.surface.id]!.issues[j.issue]!.outcome = 'carbon-cap';
  const carbon: CarbonFindingTrace[] = await Promise.all(
    toAsk.map(async (j): Promise<CarbonFindingTrace> => {
      const base = { surfaceId: j.surface.id, issueType: j.issue, probability: j.p, frameIds: j.frames.map((f) => f.id) };
      try {
        const answer = await askCarbon({ plan, surface: j.surface, roomName: j.roomName, issueType: j.issue, probability: j.p, frames: j.frames });
        return { ...base, answer: CarbonFindingSchema.parse(answer) };
      } catch (e) {
        return { ...base, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const have = new Set(findings.map((f) => `${f.surfaceId}|${f.type}`));
  for (const c of carbon) {
    const slot = surfaces[c.surfaceId]!.issues[c.issueType]!;
    if (c.error || !c.answer) {
      slot.outcome = 'carbon-error';
      continue;
    }
    if (!c.answer.present) {
      slot.outcome = 'carbon-absent';
      continue;
    }
    const key = `${c.surfaceId}|${c.answer.type}`;
    if (have.has(key)) {
      slot.outcome = 'carbon-duplicate';
      continue;
    }
    have.add(key);
    findings.push(
      FindingSchema.parse({
        id: `${walkthroughId}.${c.surfaceId}.${c.answer.type}`,
        walkthroughId,
        surfaceId: c.surfaceId,
        type: c.answer.type,
        confidence: c.probability,
        severity: c.answer.severity,
        frameIds: c.frameIds,
        ...(c.answer.bbox ? { bbox: c.answer.bbox } : {}),
        decidedBy: 'carbon',
        note: c.answer.note,
      } satisfies Finding),
    );
  }

  // Plan order, then checklist order (Carbon's `other` last).
  const surfaceOrder = new Map(plan.surfaces.map((s, i) => [s.id, i]));
  const typeOrder = (t: IssueType) => {
    const i = (CHECKLIST_ISSUES as readonly string[]).indexOf(t);
    return i < 0 ? CHECKLIST_ISSUES.length : i;
  };
  findings.sort((a, b) => surfaceOrder.get(a.surfaceId)! - surfaceOrder.get(b.surfaceId)! || typeOrder(a.type) - typeOrder(b.type));

  return {
    findings,
    notVisible: plan.surfaces.filter((s) => surfaces[s.id]?.status === 'not-visible').map((s) => s.id),
    surfaces,
    carbon,
  };
}

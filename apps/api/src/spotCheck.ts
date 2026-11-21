// [Alex] Spot check: the move-out comparison that starts from what's visible, not from wall labels.
//
// Why: on our own conference-room videos, "which wall is this frame?" kept answering a side wall near the door,
// so the per-wall damage check never looked at the frames with the change (a sheet of paper on the wall light).
// Here:
//   1. screen every move-out keyframe: is there damage, a mark, or something stuck or taped on a surface?
//   2. group flagged frames into events (a few seconds of video looking at the same thing)
//   3. find the move-in frame of the same spot by picture: AFTER next to candidate BEFORE frames, "which one?"
//      (a coarse pass over the whole move-in, then a fine pass around the winner)
//   4. ask "is this new?" on two independent before/after pairs: the two-view proof rule. Two pairs that agree it
//      changed -> new damage, priced by code; two that agree it didn't -> pre-existing, $0; else not provable, $0.
// Everything is Decisions API (fast, probabilities). Money is code (Rahim's priceDamage).
import { readFile } from 'node:fs/promises';
import { decide, type Content, type DecisionQuestion } from '@ledger/gemini';
import { priceDamage, type WalkthroughEvidence } from '@ledger/pipeline';
import type { DiffItem, FloorPlan, Frame, IssueType } from '@ledger/shared';

export const SPOT = {
  /** P(something wrong) to flag a move-out frame. */
  FLAG: 0.6,
  /** Flagged frames this close (keyframe index) are one event. */
  EVENT_GAP: 2,
  /** Events looked at, most confident first. */
  MAX_EVENTS: 6,
  /** Move-in frames shown in the coarse "which one is the same spot?" pass. */
  COARSE: 10,
  /** Neighbours of the coarse winner shown in the fine pass. */
  FINE_RADIUS: 3,
  SAME_SPOT: 0.6,
  CHANGED: 0.7,
  UNCHANGED: 0.3,
};

const WHAT =
  'damage or a change on a wall, door, window, fixture or the floor: a crack, a stain or mark, a hole, a scuff or scratch, a missing fixture, or something stuck, taped or hung on a surface that does not belong there (paper, tape, a sticker, a note)';

type Issue = IssueType;
const ISSUES: Record<Issue, string> = {
  crack: 'a crack',
  stain: 'a stain, a mark or discoloration (paint, marker, liquid)',
  hole: 'a hole or puncture',
  scuff: 'a scuff or scratch',
  'missing-fixture': 'a missing or broken fixture',
  other: 'something stuck, taped or hung on a surface (paper, tape, sticker, note), or other damage',
};

/** What to call it in a sentence. */
const NOUN: Record<Issue, string> = {
  crack: 'crack',
  stain: 'stain or mark',
  hole: 'hole',
  scuff: 'scuff or scratch',
  'missing-fixture': 'missing or broken fixture',
  other: 'item stuck to the surface',
};

export interface SpotEvidence {
  surfaceId: string;
  issueType?: Issue;
  verdict: DiffItem['verdict'];
  afterFrameIds: string[];
  supportingPairs: number;
  proof?: { beforeFrameId: string; afterFrameId: string; sameSpot: number; changed: number }[];
  pairs: { beforeFrameId: string; afterFrameId: string; sameSpot: number; changed: number }[];
  flagged: number;
}

type DecideFn = typeof decide;

export async function spotCheck(args: {
  plan: FloorPlan;
  baseline: WalkthroughEvidence;
  moveOut: WalkthroughEvidence;
  onProgress?: (done: number, total: number) => void;
  env?: NodeJS.ProcessEnv;
  decideFn?: DecideFn;
  imageOf?: (f: Frame) => Promise<Content>;
}): Promise<{ items: DiffItem[]; evidence: SpotEvidence[] }> {
  const { plan, baseline, moveOut } = args;
  const ask = args.decideFn ?? decide;
  const env = args.env ?? process.env;
  const img = args.imageOf ?? jpeg;
  const after = moveOut.frames;
  const before = baseline.frames;
  if (!after.length || !before.length) return { items: [], evidence: [] };

  // 1. Screen every move-out frame (one request each, in parallel; the client caps concurrency).
  let done = 0;
  const steps = after.length + SPOT.MAX_EVENTS * 4;
  const tick = () => args.onProgress?.(++done, steps);
  const screened = await Promise.all(
    after.map(async (f) => {
      const questions = {
        wrong: {
          type: 'noul',
          instructions: `This is a photo from a move-out walkthrough of an apartment. Is there ${WHAT} clearly visible?`,
          criteria: { true_description: 'Yes, clearly visible in this photo.', false_description: 'No, or only furniture, people, lighting or blur.' },
        },
        kind: {
          type: 'choice',
          instructions: 'If something is wrong in this photo, what is it most like?',
          criteria: Object.fromEntries(Object.entries(ISSUES)) as Record<Issue, string>,
        },
      } satisfies Record<string, DecisionQuestion>;
      const { answers } = await ask({ input: [await img(f)], questions, tag: 'spot.screen', env });
      tick();
      return { f, p: answers.wrong.noul, kind: answers.kind.choice as Issue };
    }),
  );

  // 2. Events: runs of flagged frames.
  const idx = new Map(after.map((f, i) => [f.id, i]));
  const flagged = screened.filter((s) => s.p >= SPOT.FLAG).sort((a, b) => idx.get(a.f.id)! - idx.get(b.f.id)!);
  const events: (typeof flagged)[] = [];
  for (const s of flagged) {
    const last = events.at(-1);
    if (last && idx.get(s.f.id)! - idx.get(last.at(-1)!.f.id)! <= SPOT.EVENT_GAP) last.push(s);
    else events.push([s]);
  }
  const ranked = events
    .map((e) => ({ frames: [...e].sort((a, b) => b.p * b.f.sharpness - a.p * a.f.sharpness), p: Math.max(...e.map((x) => x.p)) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, SPOT.MAX_EVENTS);

  const items: DiffItem[] = [];
  const evidence: SpotEvidence[] = [];
  const loc = new Map((moveOut.localizations ?? []).map((l) => [l.frameId, l.surfaceId]));

  for (const ev of ranked) {
    const afters = ev.frames.slice(0, 2).map((s) => s.f);
    const kind = mostCommon(ev.frames.map((s) => s.kind)) ?? 'other';
    // 3. The move-in frame of the same spot, by picture: coarse over the whole move-in, then fine around the winner.
    const beforesFor = async (a: Frame): Promise<Frame[]> => {
      const step = Math.max(1, Math.floor(before.length / SPOT.COARSE));
      const coarse = before.filter((_, i) => i % step === 0).slice(0, SPOT.COARSE);
      const c1 = await pick(a, coarse);
      const at = before.findIndex((b) => b.id === c1[0]?.id);
      const fine = before.slice(Math.max(0, at - SPOT.FINE_RADIUS), at + SPOT.FINE_RADIUS + 1);
      return fine.length > 1 ? pick(a, fine) : c1;
    };
    const pick = async (a: Frame, cands: Frame[]): Promise<Frame[]> => {
      const input: Content[] = [{ type: 'text', text: 'AFTER (move-out photo):' }, await img(a)];
      for (const [i, c] of cands.entries()) input.push({ type: 'text', text: `BEFORE ${i + 1} (move-in photo):` }, await img(c));
      const criteria: Record<string, string> = Object.fromEntries(cands.map((_, i) => [`b${i + 1}`, `BEFORE ${i + 1}`]));
      criteria.none = 'None of the BEFORE photos shows that spot';
      const { answers } = await ask({
        input,
        questions: {
          same: { type: 'choice', instructions: 'Which BEFORE photo shows the same spot of the apartment as AFTER (the same wall area, door, fixture or object), even from a different angle or distance?', criteria },
        },
        tag: 'spot.match',
        env,
      });
      tick();
      const probs = answers.same.probabilities as Record<string, number>;
      return cands
        .map((c, i) => ({ c, p: probs[`b${i + 1}`] ?? 0 }))
        .filter((x) => x.p > 0.05)
        .sort((x, y) => y.p - x.p)
        .map((x) => x.c);
    };

    const b1 = await beforesFor(afters[0]!);
    const b2 = afters[1] ? await beforesFor(afters[1]) : b1;
    // 4. Two independent pairs (different BEFORE and different AFTER frames), "is this new?" on each.
    const candidates: [Frame, Frame][] = [];
    if (b1[0]) candidates.push([b1[0], afters[0]!]);
    const second = afters[1] ? (b2.find((b) => b.id !== b1[0]?.id) ?? b2[0]) : undefined;
    if (second && afters[1] && second.id !== b1[0]?.id) candidates.push([second, afters[1]]);
    const pairs = await Promise.all(
      candidates.map(async ([b, a]) => {
        const lead = 'Compare the BEFORE (move-in) photo with the AFTER (move-out) photo.';
        const { answers } = await ask({
          input: [{ type: 'text', text: 'BEFORE (move-in):' }, await img(b), { type: 'text', text: 'AFTER (move-out):' }, await img(a)],
          questions: {
            same_spot: { type: 'noul', instructions: `${lead} Do they show the same spot of the apartment (same wall area, door or fixture), even from a different angle?` },
            changed: {
              type: 'noul',
              instructions: `${lead} At that spot, does AFTER show ${ISSUES[kind]} that is NOT in BEFORE?`,
              criteria: { true_description: 'AFTER shows it and BEFORE does not, at the same spot.', false_description: 'It is in both photos, in neither, or the difference is only angle, lighting, blur or moved furniture.' },
            },
          },
          tag: 'spot.change',
          env,
        });
        tick();
        return { beforeFrameId: b.id, afterFrameId: a.id, sameSpot: answers.same_spot.noul, changed: answers.changed.noul };
      }),
    );
    const valid = pairs.filter((p) => p.sameSpot >= SPOT.SAME_SPOT);
    const supports = valid.filter((p) => p.changed >= SPOT.CHANGED);
    const unchanged = valid.filter((p) => p.changed <= SPOT.UNCHANGED);
    const surfaceId = surfaceFor(plan, afters.map((a) => loc.get(a.id)).find((x) => x && x !== 'none'));
    const conf = Math.round(Math.max(...ev.frames.map((s) => s.p)) * 100) / 100;
    const label = plan.surfaces.find((s) => s.id === surfaceId)?.label ?? 'this spot';
    let item: DiffItem;
    if (supports.length >= 2) {
      const price = priceDamage({ plan, surfaceId, issueType: kind });
      item = {
        surfaceId,
        verdict: 'new-damage',
        issueType: kind,
        reason: `New ${NOUN[kind]} on the ${label}: two before/after views of the same spot agree it wasn't there at move-in. ${price.flatUsd ? `Flat fee $${price.flatUsd.toFixed(2)}` : 'Repair'}${price.areaUsd ? ` + ${price.areaM2} m² at $${price.ratePerM2Usd}/m²` : ''}.`,
        beforeFrameId: supports[0]!.beforeFrameId,
        afterFrameId: supports[0]!.afterFrameId,
        costUsd: price.costUsd,
        ...(price.areaM2 !== undefined ? { areaM2: price.areaM2 } : {}),
        confidence: Math.min(...supports.map((p) => p.changed)),
      };
    } else if (unchanged.length >= 1 && supports.length === 0) {
      item = {
        surfaceId,
        verdict: 'pre-existing',
        issueType: kind,
        reason: `The same ${NOUN[kind]} on the ${label} was already there at move-in.`,
        beforeFrameId: unchanged[0]!.beforeFrameId,
        afterFrameId: unchanged[0]!.afterFrameId,
        costUsd: 0,
        confidence: 1 - Math.max(...unchanged.map((p) => p.changed)),
      };
    } else {
      item = {
        surfaceId,
        verdict: 'not-visible',
        issueType: kind,
        reason: `Not provable: ${supports.length === 1 ? 'only one before/after view of this spot shows a change' : valid.length ? 'the before/after views disagree' : 'no matching move-in view of this spot'}. Two agreeing views are needed.`,
        ...(pairs[0] ? { beforeFrameId: pairs[0].beforeFrameId, afterFrameId: pairs[0].afterFrameId } : { afterFrameId: afters[0]!.id }),
        costUsd: 0,
        confidence: conf,
      };
    }
    items.push(item);
    evidence.push({
      surfaceId,
      issueType: kind,
      verdict: item.verdict,
      afterFrameIds: afters.map((a) => a.id),
      supportingPairs: Math.min(2, supports.length),
      ...(supports.length >= 2 ? { proof: supports.slice(0, 2) } : {}),
      pairs,
      flagged: ev.frames.length,
    });
  }
  args.onProgress?.(steps, steps);
  return { items: dedupe(items), evidence };
}

/** One line per (surface, issue): keep the strongest (charged > pre-existing > not provable). */
function dedupe(items: DiffItem[]): DiffItem[] {
  const rank = (d: DiffItem) => (d.verdict === 'new-damage' ? 3 : d.verdict === 'pre-existing' ? 2 : 1);
  const best = new Map<string, DiffItem>();
  for (const d of items) {
    const k = `${d.surfaceId}|${d.issueType}`;
    const cur = best.get(k);
    if (!cur || rank(d) > rank(cur) || (rank(d) === rank(cur) && d.confidence > cur.confidence)) best.set(k, d);
  }
  return [...best.values()];
}

function surfaceFor(plan: FloorPlan, id: string | undefined): string {
  if (id && plan.surfaces.some((s) => s.id === id)) return id;
  return plan.surfaces.find((s) => s.kind === 'wall')?.id ?? plan.surfaces[0]!.id;
}

function mostCommon<T>(xs: T[]): T | undefined {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const cache = new Map<string, Promise<Content>>();
function jpeg(f: Frame): Promise<Content> {
  let p = cache.get(f.path);
  if (!p) {
    p = readFile(f.path).then((b) => ({ type: 'image', mime_type: 'image/jpeg', data: b.toString('base64'), resolution: 'medium' }) as Content);
    cache.set(f.path, p);
  }
  return p;
}

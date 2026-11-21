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
  /** Move-in frames per "which one shows this exact spot?" question. Every move-in frame is looked at. */
  BATCH: 8,
  SAME_SPOT: 0.7,
  /** A second move-out frame must show the same item as the first. */
  SAME_ITEM: 0.7,
  /** How far (keyframes) to look for that second move-out frame. */
  SECOND_RADIUS: 4,
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
  other: 'something stuck',
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
  /** 'findings' = the frame scan (one per move-out frame); 'diff' = matching and comparing (total grows per event). */
  onProgress?: (stage: 'findings' | 'diff', done: number, total: number) => void;
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
  let diffDone = 0;
  let diffTotal = 0;
  const tick = () => args.onProgress?.('findings', ++done, after.length);
  const tickDiff = () => args.onProgress?.('diff', Math.min(++diffDone, diffTotal), diffTotal);
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

  // Exact-ish call count per event: same-item checks + (batches + final) per move-out view (at most 2) + 2 pairs; +1 merge.
  const batches = Math.ceil(before.length / SPOT.BATCH) + 1;
  diffTotal = ranked.reduce((n) => n + Math.min(after.length - 1, SPOT.SECOND_RADIUS * 2) + 2 * batches + 3, 0) + 1;
  args.onProgress?.('diff', 0, diffTotal);

  const items: DiffItem[] = [];
  const evidence: SpotEvidence[] = [];
  const loc = new Map((moveOut.localizations ?? []).map((l) => [l.frameId, l.surfaceId]));

  for (const ev of ranked) {
    const kind = mostCommon(ev.frames.map((s) => s.kind)) ?? 'other';
    const what = ISSUES[kind];
    const ref = ev.frames[0]!.f;
    // The second move-out view must show the SAME item, not just a neighbouring moment (a frame where the camera
    // had already moved on was being used as proof). Look around the reference frame and keep the best confirmed one.
    const near = after.filter((f) => f.id !== ref.id && Math.abs(idx.get(f.id)! - idx.get(ref.id)!) <= SPOT.SECOND_RADIUS);
    const confirmed = (
      await Promise.all(
        near.map(async (f) => {
          const { answers } = await ask({
            input: [{ type: 'text', text: 'REFERENCE (move-out photo):' }, await img(ref), { type: 'text', text: 'CANDIDATE (move-out photo, a moment earlier or later):' }, await img(f)],
            questions: {
              same_item: {
                type: 'noul',
                instructions: `REFERENCE shows ${what}. Does CANDIDATE clearly show that same item at the same spot, fully in view?`,
                criteria: { true_description: 'The same item is clearly visible in CANDIDATE.', false_description: 'It is cut off, out of frame, too blurry, or CANDIDATE shows a different place.' },
              },
            },
            tag: 'spot.same-item',
            env,
          });
          return { f, p: answers.same_item.noul };
        }),
      )
    )
      .filter((x) => x.p >= SPOT.SAME_ITEM)
      .sort((x, y) => y.p * y.f.sharpness - x.p * x.f.sharpness);
    tickDiff();
    const afters = [ref, ...(confirmed[0] ? [confirmed[0].f] : [])];
    // 3. The move-in frame of the same spot, by picture. Every move-in frame is shown, in batches (a sample of
    //    every 4th frame skipped the one close-up of the wall light and picked a wrong spot); batch winners then
    //    compete in a final round.
    const beforesFor = async (a: Frame): Promise<Frame[]> => {
      const batches: Frame[][] = [];
      for (let i = 0; i < before.length; i += SPOT.BATCH) batches.push(before.slice(i, i + SPOT.BATCH));
      const winners = (await Promise.all(batches.map((b) => pick(a, b)))).flatMap((r) => r.slice(0, 2));
      return winners.length > 1 ? pick(a, winners.slice(0, SPOT.BATCH)) : winners;
    };
    const pick = async (a: Frame, cands: Frame[]): Promise<Frame[]> => {
      const input: Content[] = [{ type: 'text', text: 'AFTER (move-out photo):' }, await img(a)];
      for (const [i, c] of cands.entries()) input.push({ type: 'text', text: `BEFORE ${i + 1} (move-in photo):` }, await img(c));
      const criteria: Record<string, string> = Object.fromEntries(cands.map((_, i) => [`b${i + 1}`, `BEFORE ${i + 1}`]));
      criteria.none = 'None of the BEFORE photos shows that spot';
      const { answers } = await ask({
        input,
        questions: {
          same: {
            type: 'choice',
            instructions: `AFTER shows ${what}. Which BEFORE photo shows that exact spot: the same fixture or the same part of the wall, even from farther away or another angle? Rooms often have several identical fixtures (wall lights, outlets, handles): use the surroundings in AFTER (a door frame, a window, art, a column, a corner) to pick the right one. A photo of the same wall that does not include that spot does not count.`,
            criteria,
          },
        },
        tag: 'spot.match',
        env,
      });
      tickDiff();
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
            same_spot: {
              type: 'noul',
              instructions: `${lead} Do they show the same spot of the apartment (the same fixture or wall area, judged by its surroundings), even from a different angle or distance?`,
            },
            changed: {
              type: 'noul',
              instructions: `${lead} At the spot where AFTER shows ${what}, is it missing in BEFORE?`,
              criteria: { true_description: 'AFTER shows it and BEFORE does not, at the same spot.', false_description: 'It is in both photos, in neither, or the difference is only angle, lighting, blur or moved furniture.' },
            },
          },
          tag: 'spot.change',
          env,
        });
        tickDiff();
        return { beforeFrameId: b.id, afterFrameId: a.id, sameSpot: answers.same_spot.noul, changed: answers.changed.noul };
      }),
    );
    const valid = pairs.filter((p) => p.sameSpot >= SPOT.SAME_SPOT);
    const supports = valid.filter((p) => p.changed >= SPOT.CHANGED);
    const unchanged = valid.filter((p) => p.changed <= SPOT.UNCHANGED);
    const wallId = surfaceFor(plan, afters.map((a) => loc.get(a.id)).find((x) => x && x !== 'none'));
    // WHERE is it? One question set on the clearest move-out view: what it's on (a plan fixture, a wall or the
    // floor), what it's next to, and how high. The line belongs to that item, and the 3D pin lands at that spot.
    const where = await locateSpot({ plan, wallId, frame: ref, what, ask: (q) => ask({ ...q, tag: 'spot.where', env }), img });
    tickDiff();
    const surfaceId = where.surfaceId;
    const conf = Math.round(Math.max(...ev.frames.map((s) => s.p)) * 100) / 100;
    const label = plan.surfaces.find((s) => s.id === surfaceId)?.label ?? 'this spot';
    let item: DiffItem;
    if (supports.length >= 2) {
      const price = priceDamage({ plan, surfaceId, issueType: kind });
      item = {
        surfaceId,
        verdict: 'new-damage',
        issueType: kind,
        reason: `${cap(NOUN[kind])} on the ${label} that wasn't there at move-in. It shows up in two separate before and after views. ${price.flatUsd ? `Flat fee $${price.flatUsd.toFixed(2)}` : 'Repair'}${price.areaUsd ? ` plus ${price.areaM2} m² at $${price.ratePerM2Usd}/m²` : ''}.`,
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
        reason: `${cap(NOUN[kind])} on the ${label}. It was already there at move-in.`,
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
        reason: `Not provable: ${supports.length === 1 ? 'we saw a change, but only in one before and after view' : valid.length ? 'the before and after views don\'t agree' : 'we couldn\'t find this spot in the move-in video'}. We need two clear views to charge.`,
        ...(pairs[0] ? { beforeFrameId: pairs[0].beforeFrameId, afterFrameId: pairs[0].afterFrameId } : { afterFrameId: afters[0]!.id }),
        costUsd: 0,
        confidence: conf,
      };
    }
    if (where.spot.heightM !== undefined || where.spot.nearId) item.spot = where.spot;
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
  // The same item is often seen several times in one walkthrough (from afar, then close up). Merge events whose
  // reference frames show the same item: keep the strongest line (charged > pre-existing > not provable).
  const rank = (d: DiffItem) => (d.verdict === 'new-damage' ? 3 : d.verdict === 'pre-existing' ? 2 : 1);
  const order = items.map((_, i) => i).sort((a, b) => rank(items[b]!) - rank(items[a]!) || items[b]!.confidence - items[a]!.confidence);
  const kept: number[] = [];
  for (const i of order) {
    let dup = false;
    for (const k of kept) {
      if (items[k]!.issueType !== items[i]!.issueType) continue;
      const fa = after.find((f) => f.id === evidence[i]!.afterFrameIds[0]);
      const fb = after.find((f) => f.id === evidence[k]!.afterFrameIds[0]);
      if (!fa || !fb) continue;
      const { answers } = await ask({
        input: [{ type: 'text', text: 'PHOTO A:' }, await img(fb), { type: 'text', text: 'PHOTO B:' }, await img(fa)],
        questions: {
          same_item: {
            type: 'noul',
            instructions: `Both photos are from the same move-out walkthrough and each shows ${ISSUES[items[i]!.issueType ?? 'other']}. Is it the same item at the same spot (seen from a different distance or angle), not two different ones?`,
          },
        },
        tag: 'spot.merge',
        env,
      });
      if (answers.same_item.noul >= SPOT.SAME_ITEM) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push(i);
  }
  args.onProgress?.('diff', diffTotal, diffTotal);
  const keep = new Set(kept);
  return { items: dedupe(items.filter((_, i) => keep.has(i))), evidence: evidence.filter((_, i) => keep.has(i)) };
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** Height bands a person can judge from a photo, with their height in meters (the ceiling one uses the plan). */
const HEIGHTS: Record<string, [string, number]> = {
  floor: ['on or just above the floor (skirting board level)', 0.15],
  knee: ['around knee height', 0.5],
  waist: ['around waist or table height', 0.95],
  chest: ['around chest or eye height', 1.45],
  above: ['above head height, like a wall light or the top of a picture', 1.95],
  ceiling: ['near the ceiling', -0.25],
};

async function locateSpot(a: {
  plan: FloorPlan;
  wallId: string;
  frame: Frame;
  what: string;
  ask: (q: { input: Content[]; questions: Record<string, DecisionQuestion> }) => Promise<{ answers: Record<string, unknown> }>;
  img: (f: Frame) => Promise<Content>;
}): Promise<{ surfaceId: string; spot: NonNullable<DiffItem['spot']> }> {
  const { plan, wallId } = a;
  const roomId = plan.surfaces.find((x) => x.id === wallId)?.roomId;
  const room = plan.rooms.find((r) => r.id === roomId)?.name ?? '';
  const short = (label: string) => label.replace(new RegExp(`^${room}\\s*`, 'i'), '');
  const fixtures = plan.surfaces.filter((x) => x.kind === 'fixture' && x.roomId === roomId);
  const roomWalls = new Map(plan.surfaces.filter((x) => x.kind === 'wall' && x.roomId === roomId).map((w) => [w.id, w]));
  const openings = plan.openings.filter((o) => roomWalls.has(o.wallId));
  const on: Record<string, string> = Object.fromEntries(fixtures.map((x, i) => [`f${i}`, `the ${short(x.label)}`]));
  on.wall = 'a bare part of a wall';
  on.floor = 'the floor';
  const near: Record<string, string> = Object.fromEntries(fixtures.map((x, i) => [`f${i}`, `the ${short(x.label)}`]));
  openings.forEach((o, i) => (near[`o${i}`] = `the ${o.kind} in the ${short(roomWalls.get(o.wallId)!.label)}`));
  near.none = 'none of these is close to it';
  const ceiling = plan.ceilingHeightM;
  const lead = `This photo shows ${a.what}.`;
  const res = await a.ask({
    input: [await a.img(a.frame)],
    questions: {
      on: { type: 'choice', instructions: `${lead} What is it on?`, criteria: on },
      near: { type: 'choice', instructions: `${lead} Which of these is closest to it in the room?`, criteria: near },
      height: { type: 'choice', instructions: `${lead} How high above the floor is it? Judge from doors, furniture and the ceiling.`, criteria: Object.fromEntries(Object.entries(HEIGHTS).map(([k, [d]]) => [k, d])) },
    },
  });
  const answers = res.answers as Record<string, { probabilities?: Record<string, number> } | undefined>;
  const top = (p?: Record<string, number>) => Object.entries(p ?? {}).sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
  const [onK, onP] = top(answers.on?.probabilities);
  let surfaceId = wallId;
  if (onK.startsWith('f') && onP >= 0.5) surfaceId = fixtures[Number(onK.slice(1))]!.id;
  else if (onK === 'floor' && onP >= 0.5) surfaceId = plan.surfaces.find((x) => x.kind === 'floor' && x.roomId === roomId)?.id ?? wallId;
  const spot: NonNullable<DiffItem['spot']> = {};
  // Height: probability-weighted over the bands, so an unsure "chest or above" lands in between.
  const hp = answers.height?.probabilities;
  if (hp && Object.keys(hp).length) {
    let sum = 0;
    let w = 0;
    for (const [k, p] of Object.entries(hp)) {
      const band = HEIGHTS[k];
      if (!band) continue;
      sum += p * (band[1] < 0 ? ceiling + band[1] : band[1]);
      w += p;
    }
    if (w > 0) spot.heightM = Math.round(Math.min(ceiling - 0.05, Math.max(0.05, surfaceId.endsWith('.floor') ? 0.05 : sum / w)) * 100) / 100;
  }
  const [nearK, nearP] = top(answers.near?.probabilities);
  if (nearP >= 0.4) {
    if (nearK.startsWith('f')) spot.nearId = fixtures[Number(nearK.slice(1))]!.id;
    else if (nearK.startsWith('o')) spot.nearId = openings[Number(nearK.slice(1))]!.id;
    // Which side of THAT item, asked by name (a generic "closest item" question mostly answered "on").
    const name = nearK.startsWith('f') ? `the ${short(fixtures[Number(nearK.slice(1))]!.label)}` : near[nearK]!;
    const sideRes = await a.ask({
      input: [await a.img(a.frame)],
      questions: {
        side: {
          type: 'choice',
          instructions: `${lead} In this photo, where is it compared with ${name}?`,
          criteria: { left: `to the left of ${name}, beside it`, right: `to the right of ${name}, beside it`, on: `on ${name} itself, covering part of it` },
        },
      },
    });
    const [sideK, sideP] = top((sideRes.answers as Record<string, { probabilities?: Record<string, number> } | undefined>).side?.probabilities);
    if (sideP >= 0.5 && (sideK === 'left' || sideK === 'right' || sideK === 'on')) spot.side = sideK;
  }
  return { surfaceId, spot };
}

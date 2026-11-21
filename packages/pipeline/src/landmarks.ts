// [Rahim] R2: Hydrogen pass on keyframes in batches of 8 -> { frameIdx, landmarks, objects }.
// Landmarks (door, window, radiator, sink, closet) feed localization; objects feed `moved` detection.

import { z } from 'zod';
import type { Frame } from '@ledger/shared';

export const CAPTION_BATCH_SIZE = 8;

/** What Hydrogen returns for one batch. `frameIdx` is the 0-based position within the batch. */
export const HydrogenBatchSchema = z.object({
  frames: z.array(
    z.object({
      frameIdx: z.number().int().min(0),
      landmarks: z.array(z.string()),
      objects: z.array(z.string()),
    }),
  ),
});
export type HydrogenBatch = z.infer<typeof HydrogenBatchSchema>;

export interface FrameCaption {
  frameId: string;
  landmarks: string[];
  objects: string[];
}

/** One Hydrogen call per batch of up to 8 frames. */
export type BatchCaptioner = (batch: Frame[]) => Promise<HydrogenBatch>;

export const HYDROGEN_PROMPT = [
  'You are looking at keyframes from an apartment walkthrough video, in order.',
  'For each image, list:',
  '- landmarks: fixed architectural features that help locate the camera on a floor plan',
  '  (door, window, radiator, sink, closet, outlet, light switch, stove, toilet, bathtub, counter).',
  '- objects: movable items (chair, table, sofa, lamp, rug, box, plant, poster).',
  'Use short lowercase nouns. frameIdx is the 0-based image position in this request.',
  'Return JSON {"frames":[{"frameIdx":0,"landmarks":[...],"objects":[...]}]} with one entry per image.',
].join('\n');

/**
 * Caption keyframes with Hydrogen, 8 per call. Every input frame gets exactly one result,
 * in input order; frames Hydrogen skipped get empty lists.
 */
export async function captionFrames(
  frames: Frame[],
  opts: { captioner?: BatchCaptioner; batchSize?: number } = {},
): Promise<FrameCaption[]> {
  const captioner = opts.captioner ?? defaultCaptioner();
  const size = opts.batchSize ?? CAPTION_BATCH_SIZE;
  const batches: Frame[][] = [];
  for (let i = 0; i < frames.length; i += size) batches.push(frames.slice(i, i + size));

  // Concurrency is limited inside packages/gemini (p-limit 4), so fire all batches.
  const results = await Promise.all(
    batches.map(async (batch) => mergeBatch(batch, HydrogenBatchSchema.parse(await captioner(batch)))),
  );
  return results.flat();
}

function mergeBatch(batch: Frame[], out: HydrogenBatch): FrameCaption[] {
  const byIdx = new Map<number, HydrogenBatch['frames'][number]>();
  for (const entry of out.frames) {
    if (entry.frameIdx < batch.length && !byIdx.has(entry.frameIdx)) byIdx.set(entry.frameIdx, entry);
  }
  return batch.map((frame, i) => {
    const entry = byIdx.get(i);
    return {
      frameId: frame.id,
      landmarks: normalizeTerms(entry?.landmarks ?? []),
      objects: normalizeTerms(entry?.objects ?? []),
    };
  });
}

function normalizeTerms(terms: string[]): string[] {
  return [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

// TODO(R1): once packages/gemini merges, replace this with a live captioner:
//   generate({ model: env.MODEL_FAST, tag: 'hydrogen.captions', schema: HydrogenBatchSchema,
//              parts: [{ type: 'text', text: HYDROGEN_PROMPT },
//                      ...batch.map((f) => ({ type: 'image', data: <base64 of f.path>, mime_type: 'image/jpeg' }))] })
// and let packages/gemini own mock/record/replay. Until then, mock mode uses `mockCaptioner`, and
// any other GEMINI_MODE returns empty captions (no hints) rather than fake ones.
function defaultCaptioner(): BatchCaptioner {
  const mode = process.env.GEMINI_MODE ?? 'mock';
  if (mode === 'mock') return mockCaptioner;
  console.warn(`[pipeline] captionFrames: GEMINI_MODE=${mode} but R1 is not wired in; returning empty captions`);
  return async (batch) => ({ frames: batch.map((_, frameIdx) => ({ frameIdx, landmarks: [], objects: [] })) });
}

const MOCK_LANDMARKS = ['door', 'window', 'radiator', 'sink', 'closet', 'outlet'];
const MOCK_OBJECTS = ['chair', 'table', 'lamp', 'rug', 'box', 'plant'];

/** Deterministic stub: picks terms from bits of each frame's dHash, so equal frames get equal captions. */
export const mockCaptioner: BatchCaptioner = async (batch) => ({
  frames: batch.map((frame, frameIdx) => {
    const bits = BigInt(`0x${/^[0-9a-f]{1,16}$/i.test(frame.phash) ? frame.phash : '0'}`);
    const pick = (list: string[], shift: bigint) => list.filter((_, i) => (bits >> (shift + BigInt(i))) & 1n);
    return { frameIdx, landmarks: pick(MOCK_LANDMARKS, 0n), objects: pick(MOCK_OBJECTS, 8n) };
  }),
});

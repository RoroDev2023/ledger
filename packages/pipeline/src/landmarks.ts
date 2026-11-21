// [Rahim] R2: Hydrogen pass on keyframes in batches of 8 -> { frameId, landmarks, objects }.
// Landmarks (door, window, radiator, sink, closet) feed localization; objects feed `moved` detection.
// Calls go through @ledger/gemini, so GEMINI_MODE (live | mock | record | replay), the cache and the
// call log apply as for every other model call.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { generate, modelId, type Part } from '@ledger/gemini';
import type { Frame } from '@ledger/shared';

export const CAPTION_BATCH_SIZE = 8;
export const CAPTION_TAG = 'hydrogen.captions';

export const FrameCaptionSchema = z.object({
  frameId: z.string(),
  landmarks: z.array(z.string()),
  objects: z.array(z.string()),
});
export type FrameCaption = z.infer<typeof FrameCaptionSchema>;

/** Hydrogen's response for one batch: one entry per image, keyed by the frame ID we sent. */
export const HydrogenBatchSchema = z.object({ frames: z.array(FrameCaptionSchema) });
export type HydrogenBatch = z.infer<typeof HydrogenBatchSchema>;

export const HYDROGEN_PROMPT = [
  'You are looking at keyframes from an apartment walkthrough video, in order.',
  'Each image is preceded by its frame ID. For each image, list:',
  '- landmarks: fixed architectural features that help locate the camera on a floor plan',
  '  (door, window, radiator, sink, closet, outlet, light switch, stove, toilet, bathtub, counter).',
  '- objects: movable items (chair, table, sofa, lamp, rug, box, plant, poster).',
  'Use short lowercase nouns. Copy each frame ID exactly.',
  'Return JSON {"frames":[{"frameId":"...","landmarks":[...],"objects":[...]}]} with one entry per image.',
].join('\n');

/**
 * Caption keyframes with Hydrogen (MODEL_FAST), 8 frames per call. Every input frame gets exactly
 * one result, in input order; frames Hydrogen skipped or misnamed get empty lists.
 */
export async function captionFrames(
  frames: Frame[],
  opts: { batchSize?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<FrameCaption[]> {
  const env = opts.env ?? process.env;
  const size = opts.batchSize ?? CAPTION_BATCH_SIZE;
  const model = modelId('fast', env);
  const batches: Frame[][] = [];
  for (let i = 0; i < frames.length; i += size) batches.push(frames.slice(i, i + size));

  // packages/gemini limits concurrency (p-limit 4), so all batches can be issued at once.
  const results = await Promise.all(
    batches.map(async (batch) => {
      const parts = await batchParts(batch);
      const out = await generate({ model, parts, schema: HydrogenBatchSchema, tag: CAPTION_TAG, env });
      return mergeBatch(batch, out);
    }),
  );
  return results.flat();
}

async function batchParts(batch: Frame[]): Promise<Part[]> {
  const parts: Part[] = [{ type: 'text', text: HYDROGEN_PROMPT }];
  for (const f of batch) {
    parts.push({ type: 'text', text: `Frame ${f.id}:` });
    parts.push({ type: 'image', mime_type: 'image/jpeg', data: (await readFile(f.path)).toString('base64') });
  }
  return parts;
}

function mergeBatch(batch: Frame[], out: HydrogenBatch): FrameCaption[] {
  const byId = new Map<string, FrameCaption>();
  for (const entry of out.frames) {
    const id = entry.frameId.trim();
    if (!byId.has(id)) byId.set(id, entry);
  }
  return batch.map((frame) => {
    const entry = byId.get(frame.id);
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

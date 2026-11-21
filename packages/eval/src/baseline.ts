// E4 · the comparison system: ONE Neon call with the plan (surface IDs) and both full walkthrough
// videos, asked "what changed?". It gets the plan too, so the comparison with LEDGER is fair.
import { z } from 'zod';
import { DiffItemSchema, IssueTypeSchema, VerdictSchema, type DiffItem, type FloorPlan } from '@ledger/shared';

export type BaselinePart =
  | { type: 'text'; text: string }
  | { type: 'video'; uri: string; mime_type: string };

/** The only thing the baseline needs from packages/gemini (R1 generate<T>). Mockable. */
export interface BaselineModel {
  generate<T>(args: { model: string; parts: BaselinePart[]; schema: z.ZodType<T>; tag: string }): Promise<T>;
}

export const BaselineOutputSchema = z.object({
  items: z.array(
    z.object({
      surfaceId: z.string(),
      verdict: VerdictSchema,
      issueType: IssueTypeSchema.nullable(),
      reason: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export function baselinePrompt(plan: FloorPlan): string {
  const surfaces = plan.surfaces.map((s) => `- ${s.id}: ${s.label}${s.landmarks?.length ? ` (has ${s.landmarks.join(', ')})` : ''}`).join('\n');
  return `You are comparing two walkthrough videos of the same apartment: video 1 is MOVE-IN, video 2 is MOVE-OUT.
The apartment's surfaces (use these IDs exactly):
${surfaces}

For every surface where something differs between move-in and move-out, or where you cannot see the surface in one of the videos, return one item:
- verdict: "new-damage" (damage at move-out that was not there at move-in), "pre-existing" (damage already there at move-in), "wear" (normal wear and tear), "moved" (only furniture or an object moved; not damage), "not-visible" (the surface is not visible enough in one of the videos), or "no-change".
- issueType: crack, stain, hole, scuff, missing-fixture or other; null when not about damage.
- reason: one sentence; confidence: 0-1.
Only report what the videos show.`;
}

/** Run the baseline on one pair. Video URIs come from the Files API (upload is the caller's job). */
export async function runBaseline(
  plan: FloorPlan,
  videos: { moveIn: { uri: string; mime: string }; moveOut: { uri: string; mime: string } },
  model: BaselineModel,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiffItem[]> {
  const out = await model.generate({
    model: env.MODEL_BASELINE ?? 'gemini-4-neon',
    parts: [
      { type: 'text', text: baselinePrompt(plan) },
      { type: 'text', text: 'Video 1: MOVE-IN' },
      { type: 'video', uri: videos.moveIn.uri, mime_type: videos.moveIn.mime },
      { type: 'text', text: 'Video 2: MOVE-OUT' },
      { type: 'video', uri: videos.moveOut.uri, mime_type: videos.moveOut.mime },
    ],
    schema: BaselineOutputSchema,
    tag: 'eval.baseline',
  });
  const known = new Set(plan.surfaces.map((s) => s.id));
  // Items on surfaces that do not exist in the plan are dropped (and counted by the caller as noise if needed).
  return out.items
    .filter((i) => known.has(i.surfaceId))
    .map((i) =>
      DiffItemSchema.parse({
        surfaceId: i.surfaceId,
        verdict: i.verdict,
        ...(i.issueType ? { issueType: i.issueType } : {}),
        reason: i.reason,
        confidence: i.confidence,
      }),
    );
}

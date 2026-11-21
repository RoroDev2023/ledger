// [Rahim] POST /units/:id/fixkit -> { jobId, events } (202): builds the tenant's DIY fix kit from the unit's diff
//   (Hydrogen query -> Shop search -> Decisions pick -> one checkout per seller; never places an order).
//   Progress streams on GET /jobs/:jobId/events like the pipeline stages: `progress` (stage "fixkit"),
//   `fixkit` (one per step, with a feed line), `decisions` (live stats), then `done` { fixkit: totals } or `error`.
//   Body (optional JSON): { checkout?: boolean, choices?: { [itemKey]: variantId } }. With `choices`, the stored
//   kit's unsure picks are swapped for the chosen alternative and only the checkouts are rebuilt.
//   ?wait=1 runs inline and returns the kit (200) instead of a job.
// GET /units/:id/fixkit -> the stored kit (404 until built).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { readCallStats } from '@ledger/gemini';
import { applyChoices, buildFixKit, describeFixKitEvent, FixKitSchema, type FixKit, type FixKitEvent } from '@ledger/pipeline';
import { FrameSchema, type DiffItem, type Frame } from '@ledger/shared';
import type { Deps } from '../deps.js';
import type { FixKitSummary } from '../events.js';
import { HttpError } from '../storage.js';
import { loadDiff, loadPlan, loadUnit, paths, type Unit } from '../units.js';

const BodySchema = z
  .object({
    checkout: z.boolean().optional(),
    choices: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const fixkitPath = (d: Deps, unitId: string) => join(paths(d.storage, unitId).dir, 'fixkit.json');

/** Keyframes for the damage photos: walkthroughs/<wid>/frames.json (run:pair / pipeline), else the frame images the frames route serves. */
async function unitFrames(d: Deps, unitId: string, unit: Unit, diff: DiffItem[]): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const w of unit.walkthroughs) {
    const list = await d.storage.readJson(join(d.storage.walkthroughDir(unitId, w.id), 'frames.json'), z.array(FrameSchema)).catch(() => null);
    if (list) frames.push(...list);
  }
  const have = new Set(frames.map((f) => f.id));
  for (const id of new Set(diff.map((x) => x.afterFrameId).filter((x): x is string => !!x && !have.has(x)))) {
    const w = unit.walkthroughs.find((x) => id.startsWith(`${x.id}-`) || id.startsWith(`${x.id}.`));
    if (!w || !/^[A-Za-z0-9_.-]{1,128}$/.test(id)) continue;
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const path = join(d.storage.walkthroughDir(unitId, w.id), 'frames', `${id}.${ext}`);
      if (existsSync(path)) {
        frames.push({ id, walkthroughId: w.id, tMs: 0, path, sharpness: 0, phash: '0000000000000000' });
        break;
      }
    }
  }
  return frames;
}

const summary = (k: FixKit): FixKitSummary => ({
  items: k.items.length,
  checkouts: k.checkouts.filter((c) => c.continue_url).length,
  diyTotal: k.diyTotal,
  deductionTotal: k.deductionTotal,
  savings: k.savings,
  complete: k.complete,
});

export function fixkitRoutes(d: Deps) {
  const r = new Hono();

  r.post('/:id/fixkit', async (c) => {
    const unitId = c.req.param('id');
    const unit = await loadUnit(d.storage, unitId);
    const diff = await loadDiff(d.storage, unitId);
    if (!diff) throw new HttpError(409, 'no diff yet: upload the move-out walkthrough first');
    const raw = (c.req.header('content-type') ?? '').includes('application/json') ? await c.req.json().catch(() => undefined) : {};
    const body = BodySchema.safeParse(raw ?? {});
    if (!body.success) throw new HttpError(400, `bad body: ${body.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
    const { choices, checkout } = body.data;
    const stored = choices ? await d.storage.readJson(fixkitPath(d, unitId), FixKitSchema) : null;
    if (choices && !stored) throw new HttpError(409, 'no fix kit to choose from yet: POST without choices first');
    const plan = await loadPlan(d.storage, unitId);
    const frames = stored ? [] : await unitFrames(d, unitId, unit, diff);

    const jobId = `fixkit-${randomUUID().slice(0, 8)}`;
    d.jobs.create(jobId, unitId, 'fixkit');
    const run = async (): Promise<FixKit> => {
      d.jobs.setStatus(jobId, 'running');
      const since = Date.now();
      const onEvent = (e: FixKitEvent) => {
        d.jobs.emit(jobId, { type: 'progress', stage: 'fixkit', done: e.done, total: e.total });
        d.jobs.emit(jobId, { type: 'fixkit', event: e, text: describeFixKitEvent(e) });
        if (e.step === 'picked' || e.step === 'done') {
          const s = readCallStats({ decisions: true, since });
          d.jobs.emit(jobId, { type: 'decisions', stats: { calls: s.calls, questions: s.questions, lastLatencyMs: s.lastLatencyMs, avgLatencyMs: s.avgLatencyMs } });
        }
      };
      const opts = { onEvent, ...(checkout !== undefined ? { checkout } : {}) };
      const kit = stored && choices ? await applyChoices(stored, choices, opts) : await buildFixKit(diff, plan, frames, { unitId, ...opts });
      await d.storage.writeJson(fixkitPath(d, unitId), kit);
      d.jobs.emit(jobId, { type: 'done', result: { fixkit: summary(kit) } });
      return kit;
    };

    if (c.req.query('wait') === '1') {
      try {
        return c.json(await run());
      } catch (err) {
        d.jobs.emit(jobId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
    void run().catch((err: unknown) => d.jobs.emit(jobId, { type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return c.json({ jobId, events: `/jobs/${jobId}/events` }, 202);
  });

  r.get('/:id/fixkit', async (c) => {
    const unitId = c.req.param('id');
    await loadUnit(d.storage, unitId);
    const kit = await d.storage.readJson(fixkitPath(d, unitId), FixKitSchema);
    if (!kit) throw new HttpError(404, 'fix kit not built yet: POST /units/:id/fixkit');
    return c.json(kit);
  });

  return r;
}

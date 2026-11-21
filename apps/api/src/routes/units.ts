// [Alex] POST /units (plan image/PDF -> FloorPlan), GET /units/:id, GET /units/:id/plan, PATCH /units/:id/plan.
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { FloorPlanSchema } from '@ledger/shared';
import type { Deps } from '../deps.js';
import { HttpError, assertSafeId } from '../storage.js';
import { loadPlan, loadUnit, paths, type Unit } from '../units.js';

const PLAN_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);

const PlanPatchSchema = z
  .object({
    ceilingHeightM: z.number().finite().min(1.8).max(6).optional(),
    roomNames: z.record(z.string(), z.string().trim().min(1)).optional(),
  })
  .strict();

export function unitsRoutes(d: Deps) {
  const r = new Hono();

  r.post('/', async (c) => {
    const body = await c.req.parseBody();
    const file = body.plan;
    if (!(file instanceof File)) throw new HttpError(400, 'multipart field "plan" (image or PDF) is required');
    const ext = (extname(file.name) || '.png').toLowerCase();
    if (!PLAN_EXT.has(ext)) throw new HttpError(400, `plan must be one of ${[...PLAN_EXT].join(', ')}`);
    const unitId = typeof body.unitId === 'string' && body.unitId ? assertSafeId(body.unitId) : `unit-${randomUUID().slice(0, 8)}`;

    const p = paths(d.storage, unitId);
    if (await d.storage.exists(p.unit)) throw new HttpError(409, `unit ${unitId} already exists`);
    const planFile = `plan${ext}`;
    await d.storage.writeFile(join(p.dir, planFile), new Uint8Array(await file.arrayBuffer()));

    const plan = FloorPlanSchema.parse(await d.pipeline.parsePlan({ unitId, filePath: join(p.dir, planFile) }));
    const unit: Unit = { unitId, createdAt: new Date().toISOString(), planFile, walkthroughs: [] };
    await d.storage.writeJson(p.plan, plan);
    await d.storage.writeJson(p.unit, unit);
    return c.json({ unit, plan }, 201);
  });

  r.get('/:id', async (c) => c.json(await loadUnit(d.storage, c.req.param('id'))));

  r.get('/:id/plan', async (c) => c.json(await loadPlan(d.storage, c.req.param('id'))));

  /** Owner fixes ceiling height or room names after parsing. */
  r.patch('/:id/plan', async (c) => {
    const unitId = c.req.param('id');
    const patch = PlanPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!patch.success) throw new HttpError(400, patch.error.issues.map((i) => i.message).join('; '));
    const plan = await loadPlan(d.storage, unitId);
    const { ceilingHeightM, roomNames } = patch.data;
    if (ceilingHeightM !== undefined && ceilingHeightM !== plan.ceilingHeightM) {
      // Wall areas scale linearly with height (openings are a small correction; the parser recomputes exactly).
      const k = ceilingHeightM / plan.ceilingHeightM;
      for (const s of plan.surfaces) if (s.kind === 'wall' && s.areaM2 !== undefined) s.areaM2 = Math.round(s.areaM2 * k * 100) / 100;
      plan.ceilingHeightM = ceilingHeightM;
    }
    for (const room of plan.rooms) {
      const name = roomNames?.[room.id];
      if (name) room.name = name;
    }
    const saved = FloorPlanSchema.parse(plan);
    await d.storage.writeJson(paths(d.storage, unitId).plan, saved);
    return c.json(saved);
  });

  return r;
}

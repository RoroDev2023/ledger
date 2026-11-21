// [Rahim, in Alex's app] POST /units/:id/scan — iPhone LiDAR scan instead of a 2D plan image.
// multipart: `room` = RoomPlan CapturedRoom JSON (required), `usdz` = the 3D model RoomPlan exports (optional, stored as-is).
// Responds like POST /units ({ unit, plan }, 201), so the web flow continues unchanged.
// Saves units/<id>/{scan.json, scan.usdz, plan.json, plan.svg, unit.json}.
import { join } from 'node:path';
import { Hono } from 'hono';
import { renderPlanSvg, scanToPlan, ScanError } from '@ledger/plan';
import { FloorPlanSchema } from '@ledger/shared';
import type { Deps } from '../deps.js';
import { HttpError, assertSafeId } from '../storage.js';
import { UnitSchema, paths, type Unit } from '../units.js';

const MAX_JSON_BYTES = 20 * 1024 * 1024;

export function scanRoutes(d: Deps) {
  const r = new Hono();

  r.post('/:id/scan', async (c) => {
    const unitId = assertSafeId(c.req.param('id'));
    const body = await c.req.parseBody();
    const room = body.room;
    const usdz = body.usdz;
    if (!(room instanceof File)) throw new HttpError(400, 'multipart field "room" (RoomPlan CapturedRoom JSON) is required');
    if (room.size > MAX_JSON_BYTES) throw new HttpError(413, 'room JSON is larger than 20 MB');
    if (usdz !== undefined && !(usdz instanceof File)) throw new HttpError(400, 'multipart field "usdz" must be a file');

    const p = paths(d.storage, unitId);
    // A re-scan may replace the plan until a walkthrough is pinned to its surface IDs.
    const existing = await d.storage.readJson(p.unit, UnitSchema);
    if (existing?.walkthroughs.length) throw new HttpError(409, `unit ${unitId} already has walkthroughs; its plan can no longer be replaced`);

    const raw = await room.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'room is not valid JSON');
    }
    const usdzBytes = usdz instanceof File ? new Uint8Array(await usdz.arrayBuffer()) : undefined;
    // USDZ is a zip archive: check the "PK\x03\x04" signature so we never store something else under that name.
    if (usdzBytes && !(usdzBytes[0] === 0x50 && usdzBytes[1] === 0x4b && usdzBytes[2] === 0x03 && usdzBytes[3] === 0x04))
      throw new HttpError(400, 'usdz is not a USDZ (zip) file');

    let plan;
    try {
      plan = FloorPlanSchema.parse(scanToPlan(json, { unitId, log: (m) => console.warn(`[scan ${unitId}] ${m}`) }));
    } catch (e) {
      if (e instanceof ScanError) throw new HttpError(400, e.message);
      throw e;
    }

    await d.storage.writeFile(join(p.dir, 'scan.json'), raw);
    if (usdzBytes) await d.storage.writeFile(join(p.dir, 'scan.usdz'), usdzBytes);
    await d.storage.writeJson(p.plan, plan);
    await d.storage.writeFile(join(p.dir, 'plan.svg'), renderPlanSvg(plan));
    const unit: Unit = existing ?? { unitId, createdAt: new Date().toISOString(), planFile: 'scan.json', walkthroughs: [] };
    unit.planFile = 'scan.json';
    await d.storage.writeJson(p.unit, unit);
    return c.json({ unit, plan }, 201);
  });

  return r;
}

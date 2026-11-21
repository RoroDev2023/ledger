// [Alex] Per-unit records shared by the routes.
import { join } from 'node:path';
import { z } from 'zod';
import { DiffItemSchema, FindingSchema, FloorPlanSchema, WalkthroughSchema, type Walkthrough } from '@ledger/shared';
import { HttpError, type Storage } from './storage.js';

export const UnitSchema = z.object({
  unitId: z.string(),
  createdAt: z.string(),
  planFile: z.string(),
  walkthroughs: z.array(WalkthroughSchema),
});
export type Unit = z.infer<typeof UnitSchema>;

export const paths = (st: Storage, unitId: string) => {
  const dir = st.unitDir(unitId);
  return {
    dir,
    unit: join(dir, 'unit.json'),
    plan: join(dir, 'plan.json'),
    diff: join(dir, 'diff.json'),
    statement: join(dir, 'statement.json'),
    findings: (wid: string) => join(st.walkthroughDir(unitId, wid), 'findings.json'),
  };
};

export async function loadUnit(st: Storage, unitId: string): Promise<Unit> {
  const u = await st.readJson(paths(st, unitId).unit, UnitSchema);
  if (!u) throw new HttpError(404, `unit ${unitId} not found`);
  return u;
}

export async function loadPlan(st: Storage, unitId: string) {
  const p = await st.readJson(paths(st, unitId).plan, FloorPlanSchema);
  if (!p) throw new HttpError(404, `plan for ${unitId} not found`);
  return p;
}

export const loadFindings = (st: Storage, unitId: string, wid: string) =>
  st.readJson(paths(st, unitId).findings(wid), z.array(FindingSchema));

export const loadDiff = (st: Storage, unitId: string) => st.readJson(paths(st, unitId).diff, z.array(DiffItemSchema));

/** Latest walkthrough of each kind (a re-upload replaces the earlier one). */
export function latest(unit: Unit, kind: Walkthrough['kind']): Walkthrough | undefined {
  return unit.walkthroughs.filter((w) => w.kind === kind).at(-1);
}

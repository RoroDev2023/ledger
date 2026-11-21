// Where a pair's floor plan comes from: a fixture name, a FloorPlan JSON file, or a RoomPlan scan
// (the iPhone scanner's room.json, converted with scanToPlan). Used by the kit, the baseline and `pairs`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { FloorPlanSchema, listPlanFixtures, loadPlanFixture, type FloorPlan } from '@ledger/shared';
import { renderPlanSvg, scanToPlan } from '@ledger/plan';

/** True when a parsed JSON object looks like a RoomPlan CapturedRoom export rather than a FloorPlan. */
export function isRoomPlanScan(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>).walls) && !('surfaces' in (raw as object));
}

/** Turn already-parsed JSON (FloorPlan or RoomPlan scan) into a FloorPlan. */
export function planFromJson(raw: unknown, unitId: string, log: (m: string) => void = () => {}): FloorPlan {
  if (isRoomPlanScan(raw)) return scanToPlan(raw, { unitId, log });
  return FloorPlanSchema.parse(raw);
}

/** A fixture name (e.g. "judging-room") or a path to a FloorPlan / RoomPlan JSON file. */
export function resolvePlan(arg: string, cwd = process.cwd()): FloorPlan {
  if (listPlanFixtures().includes(arg)) return loadPlanFixture(arg);
  const path = arg.startsWith('/') ? arg : join(cwd, arg);
  if (!existsSync(path)) throw new Error(`no plan fixture or file named "${arg}" (fixtures: ${listPlanFixtures().join(', ')})`);
  const stem = basename(path, '.json');
  // data/pairs/<pairId>/room.json or plan.json: name the plan after the pair folder.
  const unitId = stem === 'room' || stem === 'plan' ? basename(dirname(path)) : stem;
  return planFromJson(JSON.parse(readFileSync(path, 'utf8')), unitId);
}

/**
 * The plan for data/pairs/<pairId>/: plan.json if present, else room.json (a scan, converted once and
 * cached as plan.json), else plan.txt holding a fixture name. Returns undefined when none exists.
 */
export function pairPlan(pairDir: string, pairId: string): FloorPlan | undefined {
  const planPath = join(pairDir, 'plan.json');
  if (existsSync(planPath)) return planFromJson(JSON.parse(readFileSync(planPath, 'utf8')), pairId);
  const scanPath = join(pairDir, 'room.json');
  if (existsSync(scanPath)) {
    const plan = scanToPlan(JSON.parse(readFileSync(scanPath, 'utf8')), { unitId: pairId });
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }
  const namePath = join(pairDir, 'plan.txt');
  if (existsSync(namePath)) return loadPlanFixture(readFileSync(namePath, 'utf8').trim());
  return undefined;
}

export { renderPlanSvg };

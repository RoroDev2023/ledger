import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FloorPlanSchema } from './schemas.js';
import type { FloorPlan } from './types.js';

/** Absolute path of packages/shared/fixtures. */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** Names of the committed plan fixtures, e.g. ["demo-table"]. */
export function listPlanFixtures(): string[] {
  return readdirSync(join(FIXTURES_DIR, 'plans'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Load and validate a plan fixture by name. Throws if it does not match the contract. */
export function loadPlanFixture(name: string): FloorPlan {
  const raw: unknown = JSON.parse(readFileSync(join(FIXTURES_DIR, 'plans', `${name}.json`), 'utf8'));
  return FloorPlanSchema.parse(raw);
}

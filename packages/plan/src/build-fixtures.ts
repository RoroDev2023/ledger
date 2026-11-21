// Writes packages/shared/fixtures/plans/*.json from hand-described layouts (meters, y = north).
// These are hand-made fixtures so the pipeline and viewer can be built before parsePlan works.
// They are NOT parsed from real listings; label them as fixtures everywhere.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR, FloorPlanSchema } from '@ledger/shared';
import { buildPlan } from './surfaces.js';
import { renderPlanSvg } from './svg.js';

const plans = {
  // The cardboard "shoebox" apartment on the demo table, drawn at real-world scale
  // (1 cm of cardboard = 10 cm of apartment). Two rooms sharing the wall at x = 3.
  'demo-table': buildPlan({
    unitId: 'demo-table',
    ceilingHeightM: 2.5,
    metersPerPixel: 0.01,
    scaleSource: 'assumed',
    rooms: [
      { name: 'Living room', polygon: [[0, 0], [3, 0], [3, 2.5], [0, 2.5]] },
      { name: 'Bedroom', polygon: [[3, 0], [5.5, 0], [5.5, 2.5], [3, 2.5]] },
    ],
    openings: [
      { id: 'door-entry', kind: 'door', center: [1.0, 0], widthM: 0.9 },
      { id: 'door-bedroom', kind: 'door', center: [3, 0.8], widthM: 0.8 },
      { id: 'window-living', kind: 'window', center: [1.5, 2.5], widthM: 1.2 },
      { id: 'window-bedroom', kind: 'window', center: [5.5, 1.25], widthM: 1.0 },
    ],
    warnings: ['hand-made fixture of the demo table; scale assumed (1 cm cardboard = 10 cm)'],
  }),
  // A typical NYC studio: one room with an L-shaped kitchen nook and a bathroom.
  'studio-l': buildPlan({
    unitId: 'studio-l',
    ceilingHeightM: 2.7,
    metersPerPixel: 0.01,
    scaleSource: 'assumed',
    rooms: [
      { name: 'Main room', polygon: [[0, 0], [5.2, 0], [5.2, 3.0], [3.4, 3.0], [3.4, 4.2], [0, 4.2]] },
      { name: 'Bathroom', polygon: [[3.4, 3.0], [5.2, 3.0], [5.2, 4.2], [3.4, 4.2]] },
    ],
    openings: [
      { id: 'door-entry', kind: 'door', center: [4.5, 0], widthM: 0.9 },
      { id: 'door-bath', kind: 'door', center: [4.0, 3.0], widthM: 0.75 },
      { id: 'window-1', kind: 'window', center: [0, 2.0], widthM: 1.2 },
      { id: 'window-2', kind: 'window', center: [1.7, 4.2], widthM: 1.2 },
    ],
    fixtures: [{ roomName: 'Main room', name: 'kitchen counter' }, { roomName: 'Bathroom', name: 'sink' }],
    warnings: ['hand-made fixture, not parsed from a listing'],
  }),
  // A generic single room for a LIVE demo in an unknown room (e.g. the judging room). No drawing needed:
  // pick the wall you film and call it the north wall. 5 x 4 m, door on the south wall.
  'judging-room': buildPlan({
    unitId: 'judging-room',
    ceilingHeightM: 2.7,
    metersPerPixel: 0.01,
    scaleSource: 'assumed',
    rooms: [{ name: 'Room', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] }],
    openings: [{ id: 'door-entry', kind: 'door', center: [4.2, 0], widthM: 0.9 }],
    warnings: ['generic room for a live demo: the filmed wall is the north wall; sizes are approximate'],
  }),
  // A one-bedroom railroad-style layout: three rooms in a row.
  'one-bed-railroad': buildPlan({
    unitId: 'one-bed-railroad',
    ceilingHeightM: 2.6,
    metersPerPixel: 0.01,
    scaleSource: 'assumed',
    rooms: [
      { name: 'Living room', polygon: [[0, 0], [3.6, 0], [3.6, 4.0], [0, 4.0]] },
      { name: 'Kitchen', polygon: [[3.6, 0], [6.4, 0], [6.4, 4.0], [3.6, 4.0]] },
      { name: 'Bedroom', polygon: [[6.4, 0], [9.6, 0], [9.6, 4.0], [6.4, 4.0]] },
    ],
    openings: [
      { id: 'door-entry', kind: 'door', center: [4.8, 0], widthM: 0.9 },
      { id: 'door-kitchen', kind: 'door', center: [3.6, 2.0], widthM: 0.9 },
      { id: 'door-bedroom', kind: 'door', center: [6.4, 2.0], widthM: 0.8 },
      { id: 'window-living', kind: 'window', center: [0, 2.0], widthM: 1.4 },
      { id: 'window-bedroom', kind: 'window', center: [9.6, 2.0], widthM: 1.2 },
    ],
    fixtures: [{ roomName: 'Kitchen', name: 'sink' }, { roomName: 'Kitchen', name: 'stove' }],
    warnings: ['hand-made fixture, not parsed from a listing'],
  }),
};

const dir = join(FIXTURES_DIR, 'plans');
mkdirSync(dir, { recursive: true });
for (const [name, plan] of Object.entries(plans)) {
  FloorPlanSchema.parse(plan);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(plan, null, 2) + '\n');
  writeFileSync(join(dir, `${name}.svg`), renderPlanSvg(plan) + '\n');
  console.log(`wrote ${name}.json: ${plan.rooms.length} rooms, ${plan.surfaces.length} surfaces, ${plan.openings.length} openings, warnings=${plan.warnings.length}`);
}

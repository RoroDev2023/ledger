import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FloorPlanSchema } from '@ledger/shared';
import { createApp } from '../src/app.js';
import { mockPipeline } from '../src/pipeline.js';

const FIXTURE = join(import.meta.dirname, '../../../packages/plan/test/fixtures/scan-rect-room.json');
const USDZ = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // zip signature + filler

let dir: string;
let app: ReturnType<typeof createApp>['app'];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-scan-'));
  app = createApp({ dataDir: dir, pipeline: mockPipeline({ stepMs: 0 }) }).app;
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function scan(unitId: string, files: { room?: string; usdz?: Uint8Array }) {
  const fd = new FormData();
  if (files.room !== undefined) fd.set('room', new File([files.room], 'room.json', { type: 'application/json' }));
  if (files.usdz) fd.set('usdz', new File([files.usdz], 'room.usdz'));
  return app.request(`/units/${unitId}/scan`, { method: 'POST', body: fd });
}

describe('POST /units/:id/scan', () => {
  it('turns a RoomPlan scan into a plan and saves plan.json, plan.svg and scan.usdz', async () => {
    const room = await readFile(FIXTURE, 'utf8');
    const res = await scan('scan-a', { room, usdz: USDZ });
    expect(res.status).toBe(201);
    const { unit, plan } = (await res.json()) as { unit: { unitId: string }; plan: unknown };
    expect(unit.unitId).toBe('scan-a');
    const parsed = FloorPlanSchema.parse(plan);
    expect(parsed.surfaces.filter((s) => s.kind === 'wall').map((s) => s.id).sort()).toEqual(['room-1.wall-e', 'room-1.wall-n', 'room-1.wall-s', 'room-1.wall-w']);

    const unitDir = join(dir, 'units', 'scan-a');
    expect(JSON.parse(await readFile(join(unitDir, 'plan.json'), 'utf8'))).toEqual(plan);
    expect(await readFile(join(unitDir, 'plan.svg'), 'utf8')).toContain('room-1.wall-n');
    expect(new Uint8Array(await readFile(join(unitDir, 'scan.usdz')))).toEqual(USDZ);
    // The rest of the API sees it like any other unit.
    expect((await app.request('/units/scan-a/plan')).status).toBe(200);
    expect((await app.request('/units/scan-a')).status).toBe(200);
  });

  it('allows a re-scan until a walkthrough exists, then refuses to replace the plan', async () => {
    const room = await readFile(FIXTURE, 'utf8');
    expect((await scan('scan-b', { room })).status).toBe(201);
    expect((await scan('scan-b', { room })).status).toBe(201);
    const fd = new FormData();
    fd.set('video', new File([new Uint8Array([1, 2, 3])], 'base.mp4'));
    fd.set('kind', 'baseline');
    expect((await app.request('/units/scan-b/walkthroughs', { method: 'POST', body: fd })).status).toBe(202);
    expect((await scan('scan-b', { room })).status).toBe(409);
  });

  it('rejects missing, malformed and impossible scans with 400', async () => {
    expect((await scan('scan-c', {})).status).toBe(400);
    expect((await scan('scan-c', { room: '{not json' })).status).toBe(400);
    const two = await scan('scan-c', { room: JSON.stringify({ walls: [] }) });
    expect(two.status).toBe(400);
    expect(((await two.json()) as { error: string }).error).toMatch(/at least 3/);
    const room = await readFile(FIXTURE, 'utf8');
    expect((await scan('scan-c', { room, usdz: new Uint8Array([1, 2, 3, 4]) })).status).toBe(400);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixKitSchema } from '@ledger/pipeline';
import { createApp } from '../src/app.js';
import { mockPipeline } from '../src/pipeline.js';

let dir: string;
let app: ReturnType<typeof createApp>['app'];
const saved = { DATA_DIR: process.env.DATA_DIR, GEMINI_MODE: process.env.GEMINI_MODE, SHOP_MODE: process.env.SHOP_MODE };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-api-fixkit-'));
  // Call log in the temp dir; Gemini and Shop both mocked (no network).
  Object.assign(process.env, { DATA_DIR: dir, GEMINI_MODE: 'mock', SHOP_MODE: 'mock' });
  app = createApp({ dataDir: dir, pipeline: mockPipeline({ stepMs: 0 }) }).app;
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(dir, { recursive: true, force: true });
});

const upload = (field: string, name: string, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set(field, new File([new Uint8Array([1, 2, 3])], name));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return { method: 'POST', body: fd };
};

type Ev = { type: string; stage?: string; event?: { step: string; done: number; total: number }; text?: string; result?: { fixkit?: { diyTotal: number; deductionTotal: number; savings: number } }; message?: string };

async function events(path: string): Promise<Ev[]> {
  const text = await (await app.request(path)).text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l.length > 6)
    .map((l) => JSON.parse(l.slice(6)) as Ev);
}

async function runJob(path: string) {
  const res = await app.request(path);
  return res;
}

describe('POST /units/:id/fixkit', () => {
  it('409 before a diff exists', async () => {
    expect((await app.request('/units', upload('plan', 'plan.png', { unitId: 'kit' }))).status).toBe(201);
    expect((await app.request('/units/kit/fixkit', { method: 'POST' })).status).toBe(409);
    expect((await app.request('/units/kit/fixkit')).status).toBe(404);
  });

  it('job with a live feed: progress + fixkit steps + decisions, then done; GET returns the kit', async () => {
    for (const [kind, name] of [['baseline', 'b.mp4'], ['move-out', 'o.mp4']] as const) {
      const res = await app.request('/units/kit/walkthroughs', upload('video', name, { kind, capturedAt: '2026-11-21' }));
      const { jobId } = (await res.json()) as { jobId: string };
      expect((await events(`/jobs/${jobId}/events`)).at(-1)?.type).toBe('done');
    }

    const post = await app.request('/units/kit/fixkit', { method: 'POST' });
    expect(post.status).toBe(202);
    const { jobId, events: url } = (await post.json()) as { jobId: string; events: string };
    expect(url).toBe(`/jobs/${jobId}/events`);
    const evs = await events(url);
    expect(evs.at(-1)?.type).toBe('done');
    const steps = evs.filter((e) => e.type === 'fixkit').map((e) => e.event!.step);
    expect(steps[0]).toBe('rules');
    expect(steps).toEqual(expect.arrayContaining(['query', 'searching', 'picked', 'checkout', 'checkout-ready', 'done']));
    expect(steps.at(-1)).toBe('done');
    expect(evs.filter((e) => e.type === 'fixkit').every((e) => typeof e.text === 'string' && e.text.length > 0)).toBe(true);
    expect(evs.some((e) => e.type === 'progress' && e.stage === 'fixkit')).toBe(true);
    expect(evs.some((e) => e.type === 'decisions')).toBe(true);

    const kit = FixKitSchema.parse(await (await runJob('/units/kit/fixkit')).json());
    expect(kit.unitId).toBe('kit');
    expect(kit.items.length).toBeGreaterThan(0);
    expect(kit.items.every((i) => i.forDiffItem.issueType && i.price > 0)).toBe(true);
    expect(kit.checkouts.length).toBeGreaterThan(0);
    const done = evs.at(-1)!.result!.fixkit!;
    expect(done).toMatchObject({ diyTotal: kit.diyTotal, deductionTotal: kit.deductionTotal, savings: kit.savings });
    expect(Math.round((kit.deductionTotal - kit.diyTotal) * 100)).toBe(Math.round(kit.savings * 100));
  });

  it('?wait=1 returns the kit inline; choices swap an unsure pick and rebuild only the checkouts', async () => {
    const res = await app.request('/units/kit/fixkit?wait=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkout: false }) });
    expect(res.status).toBe(200);
    const kit = FixKitSchema.parse(await res.json());
    expect(kit.checkouts).toEqual([]);

    const unsure = kit.items.find((i) => i.alternatives.length);
    if (unsure) {
      const alt = unsure.alternatives[0]!;
      const r2 = await app.request('/units/kit/fixkit?wait=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choices: { [unsure.key]: alt.variant.id } }) });
      const kit2 = FixKitSchema.parse(await r2.json());
      expect(kit2.items.find((i) => i.key === unsure.key)).toMatchObject({ pickedBy: 'user', variant: alt.variant });
      expect(kit2.checkouts.length).toBeGreaterThan(0);
    }

    expect((await app.request('/units/kit/fixkit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bogus: 1 }) })).status).toBe(400);
  });
});

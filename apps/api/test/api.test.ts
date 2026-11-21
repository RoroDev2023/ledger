import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StatementSchema, type DiffItem } from '@ledger/shared';
import { createApp } from '../src/app.js';
import { mockPipeline } from '../src/pipeline.js';
import { buildStatement, isCharged } from '../src/statement/build.js';

let dir: string;
let app: ReturnType<typeof createApp>['app'];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-api-'));
  app = createApp({ dataDir: dir, pipeline: mockPipeline({ stepMs: 0 }) }).app;
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const upload = (field: string, name: string, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set(field, new File([new Uint8Array([1, 2, 3])], name));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return { method: 'POST', body: fd };
};

/** Reads the SSE stream to the end and returns the parsed events. */
async function events(jobId: string) {
  const res = await app.request(`/jobs/${jobId}/events`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l.length > 6)
    .map((l) => JSON.parse(l.slice(6)) as { type: string; stage?: string; stats?: { questions: number } });
}

describe('mock end-to-end', () => {
  it('plan -> baseline -> move-out -> statement', async () => {
    const created = await app.request('/units', upload('plan', 'plan.png', { unitId: 'demo' }));
    expect(created.status).toBe(201);
    const { plan } = (await created.json()) as { plan: { unitId: string; surfaces: unknown[] } };
    expect(plan.unitId).toBe('demo');
    expect(plan.surfaces.length).toBeGreaterThan(4);

    const early = await app.request('/units/demo/walkthroughs', upload('video', 'out.mp4', { kind: 'move-out' }));
    expect(early.status).toBe(409);

    const base = await app.request('/units/demo/walkthroughs', upload('video', 'base.mp4', { kind: 'baseline' }));
    expect(base.status).toBe(202);
    const { jobId: baseJob } = (await base.json()) as { jobId: string };
    const baseEvents = await events(baseJob);
    expect(baseEvents.at(-1)?.type).toBe('done');
    expect(baseEvents.some((e) => e.type === 'progress' && e.stage === 'findings')).toBe(true);
    expect(baseEvents.filter((e) => e.type === 'decisions').at(-1)?.stats?.questions).toBeGreaterThan(0);

    const findings = await app.request('/units/demo/findings');
    expect(findings.status).toBe(200);

    const out = await app.request('/units/demo/walkthroughs', upload('video', 'out.mp4', { kind: 'move-out', capturedAt: '2026-11-21' }));
    const { jobId: outJob } = (await out.json()) as { jobId: string };
    expect((await events(outJob)).at(-1)?.type).toBe('done');

    const st = StatementSchema.parse(await (await app.request('/units/demo/statement')).json());
    expect(st.dueBy).toBe('2026-12-05');
    const charged = st.items.filter(isCharged);
    expect(charged.length).toBe(1);
    expect(st.totalUsd).toBeCloseTo(charged.reduce((s, d) => s + (d.costUsd ?? 0), 0), 2);
    expect(st.items.find((d) => d.verdict === 'moved')?.costUsd).toBe(0);
    expect(st.items.some((d) => d.reason.startsWith('Not provable'))).toBe(true);

    const html = await app.request('/units/demo/statement.html');
    expect(await html.text()).toContain('Send by 2026-12-05');
  });

  it('rejects bad ids, missing files and unknown jobs', async () => {
    expect((await app.request('/units', upload('plan', 'plan.png', { unitId: '../etc' }))).status).toBe(400);
    expect((await app.request('/units', { method: 'POST', body: new FormData() })).status).toBe(400);
    expect((await app.request('/units/nope/plan')).status).toBe(404);
    expect((await app.request('/jobs/nope/events')).status).toBe(404);
  });

  it('PATCH /plan updates ceiling height and room names', async () => {
    await app.request('/units', upload('plan', 'p.png', { unitId: 'patch' }));
    const before = (await (await app.request('/units/patch/plan')).json()) as { ceilingHeightM: number; rooms: { id: string }[] };
    const roomId = before.rooms[0]!.id;
    const res = await app.request('/units/patch/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ceilingHeightM: 2.8, roomNames: { [roomId]: 'Front room' } }),
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as { ceilingHeightM: number; rooms: { id: string; name: string }[] };
    expect(after.ceilingHeightM).toBe(2.8);
    expect(after.rooms.find((r) => r.id === roomId)?.name).toBe('Front room');
    expect((await app.request('/units/patch/plan', { method: 'PATCH', body: '{"ceilingHeightM":99}', headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });
});

describe('buildStatement', () => {
  const item = (o: Partial<DiffItem>): DiffItem => ({ surfaceId: 'a.wall-n', verdict: 'new-damage', reason: 'x', confidence: 0.9, costUsd: 50, ...o });

  it('charges only provable new damage, never moved/pre-existing/not provable', () => {
    const s = buildStatement('u', '2026-11-21', [
      item({}),
      item({ verdict: 'moved', costUsd: 999 }),
      item({ verdict: 'pre-existing', costUsd: 10 }),
      item({ reason: 'Not provable: 1 pair', costUsd: 70 }),
      item({ verdict: 'no-change' }),
    ]);
    expect(s.totalUsd).toBe(50);
    expect(s.items).toHaveLength(4);
    expect(s.items.filter((d) => (d.costUsd ?? 0) > 0)).toHaveLength(1);
  });

  it('sums in cents', () => {
    expect(buildStatement('u', '2026-11-21', [item({ costUsd: 0.1 }), item({ costUsd: 0.2 })]).totalUsd).toBe(0.3);
  });
});

// [Alex] Scenario tests: different plans, uploads, failures and pipeline outputs against the real routes.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StatementSchema, loadPlanFixture, type DiffItem, type Finding } from '@ledger/shared';
import { createApp } from '../src/app.js';
import { DecisionsTotals, type DecisionsStat, type JobEvent } from '../src/events.js';
import { mockPipeline, type PipelineAdapter } from '../src/pipeline.js';
import { buildStatement } from '../src/statement/build.js';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function makeApp(pipeline: PipelineAdapter = mockPipeline({ stepMs: 0 })) {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-scn-'));
  dirs.push(dir);
  return createApp({ dataDir: dir, pipeline });
}
type App = Awaited<ReturnType<typeof makeApp>>['app'];

const form = (fields: Record<string, string | [string, string]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, Array.isArray(v) ? new File([v[1]], v[0]) : v);
  return { method: 'POST', body: fd };
};
const newUnit = (app: App, unitId: string, file = 'plan.png') => app.request('/units', form({ plan: [file, 'x'], unitId }));
const upload = (app: App, unitId: string, kind: string, extra: Record<string, string> = {}, file = 'walk.mp4') =>
  app.request(`/units/${unitId}/walkthroughs`, form({ video: [file, 'x'], kind, ...extra }));

async function events(app: App, jobId: string): Promise<JobEvent[]> {
  const text = await (await app.request(`/jobs/${jobId}/events`)).text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l.length > 6)
    .map((l) => JSON.parse(l.slice(6)) as JobEvent);
}
async function runUpload(app: App, unitId: string, kind: string, extra: Record<string, string> = {}) {
  const res = await upload(app, unitId, kind, extra);
  expect(res.status).toBe(202);
  const { jobId, walkthroughId } = (await res.json()) as { jobId: string; walkthroughId: string };
  return { jobId, walkthroughId, events: await events(app, jobId) };
}
const statementOf = async (app: App, unitId: string) => StatementSchema.parse(await (await app.request(`/units/${unitId}/statement`)).json());

/** A pipeline whose findings and diff come straight from the test, to check API rules on exact inputs. */
function scriptedPipeline(script: {
  fixture?: string;
  findings?: (kind: string) => Omit<Finding, 'walkthroughId' | 'id'>[];
  diff?: DiffItem[] | ((baseline: Finding[]) => DiffItem[]);
  fail?: 'walkthrough' | 'diff';
  decisions?: DecisionsStat[];
}): PipelineAdapter {
  return {
    name: 'scripted',
    parsePlan: async ({ unitId }) => ({ ...loadPlanFixture(script.fixture ?? 'demo-table'), unitId }),
    runWalkthrough: async ({ walkthrough, onProgress, onDecisions }) => {
      onProgress('frames', 1, 1);
      for (const s of script.decisions ?? []) onDecisions(s);
      if (script.fail === 'walkthrough') throw new Error('ffmpeg could not read the video');
      return (script.findings?.(walkthrough.kind) ?? []).map((f, i) => ({ ...f, id: `${walkthrough.id}-${i}`, walkthroughId: walkthrough.id }));
    },
    runDiff: async ({ baseline, onProgress, onDecisions }) => {
      onProgress('diff', 1, 1);
      for (const s of script.decisions ?? []) onDecisions(s);
      if (script.fail === 'diff') throw new Error('Decisions API quota exceeded (429)');
      return typeof script.diff === 'function' ? script.diff(baseline) : (script.diff ?? []);
    },
  };
}
const item = (o: Partial<DiffItem>): DiffItem => ({ surfaceId: 'living-room.wall-n', verdict: 'new-damage', reason: 'New stain.', confidence: 0.9, costUsd: 40, ...o });

// ─────────────────────────────────────────────────────────────────────────────

describe('different floor plans', () => {
  for (const [fixture, rooms] of [
    ['demo-table', 2],
    ['studio-l', 2],
    ['one-bed-railroad', 3],
  ] as const) {
    it(`${fixture}: full flow produces a valid statement`, async () => {
      const { app } = await makeApp(mockPipeline({ stepMs: 0, fixture }));
      const res = await newUnit(app, fixture);
      const { plan } = (await res.json()) as { plan: { rooms: unknown[]; surfaces: { id: string }[] } };
      expect(plan.rooms).toHaveLength(rooms);
      await runUpload(app, fixture, 'baseline');
      await runUpload(app, fixture, 'move-out', { capturedAt: '2026-11-21' });
      const st = await statementOf(app, fixture);
      const surfaceIds = new Set(plan.surfaces.map((s) => s.id));
      expect(st.items.every((d) => surfaceIds.has(d.surfaceId))).toBe(true); // every line points at a real surface
      expect(st.totalUsd).toBeGreaterThan(0);
    });
  }
});

describe('mock plan picked by file name', () => {
  it('studio-l.png loads the studio, anything else the default', async () => {
    const { app } = await makeApp();
    const rooms = async (id: string, file: string) => ((await (await newUnit(app, id, file)).json()) as { plan: { rooms: { id: string }[] } }).plan.rooms.map((r) => r.id);
    expect(await rooms('s', 'studio-l.png')).toEqual(['main-room', 'bathroom']);
    expect(await rooms('r', 'ONE-BED-RAILROAD.pdf')).toHaveLength(3);
    expect(await rooms('d', 'my-apartment.png')).toEqual(['living-room', 'bedroom']);
  });
});

describe('uploads and validation', () => {
  it('accepts PDF/JPG plans and MOV/WEBM videos, rejects other types', async () => {
    const { app } = await makeApp();
    expect((await newUnit(app, 'pdf', 'listing.pdf')).status).toBe(201);
    expect((await newUnit(app, 'jpg', 'photo.JPG')).status).toBe(201);
    expect((await newUnit(app, 'txt', 'notes.txt')).status).toBe(400);
    expect((await upload(app, 'pdf', 'baseline', {}, 'iphone.MOV')).status).toBe(202);
    expect((await upload(app, 'jpg', 'baseline', {}, 'chrome.webm')).status).toBe(202);
    expect((await upload(app, 'jpg', 'baseline', {}, 'clip.avi')).status).toBe(400);
  });

  it('rejects duplicate unit ids, unsafe ids, bad kinds and missing units', async () => {
    const { app } = await makeApp();
    expect((await newUnit(app, 'dup')).status).toBe(201);
    expect((await newUnit(app, 'dup')).status).toBe(409);
    for (const bad of ['../x', 'a/b', 'with space', 'x'.repeat(65)]) expect((await newUnit(app, bad)).status).toBe(400);
    expect((await upload(app, 'dup', 'checkout')).status).toBe(400);
    expect((await upload(app, 'ghost', 'baseline')).status).toBe(404);
  });

  it('move-out before baseline is refused; results 404 until ready', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'early');
    expect((await upload(app, 'early', 'move-out')).status).toBe(409);
    expect((await app.request('/units/early/findings')).status).toBe(404);
    expect((await app.request('/units/early/diff')).status).toBe(404);
    expect((await app.request('/units/early/statement')).status).toBe(404);
    expect((await app.request('/units/early/statement.html')).status).toBe(404);
  });

  it('an invalid capturedAt falls back to now', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'date');
    await runUpload(app, 'date', 'baseline');
    await runUpload(app, 'date', 'move-out', { capturedAt: 'not-a-date' });
    expect((await statementOf(app, 'date')).moveOutDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('PATCH scales wall areas with ceiling height and ignores unknown rooms', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'tall');
    const before = (await (await app.request('/units/tall/plan')).json()) as { surfaces: { id: string; kind: string; areaM2?: number }[] };
    const wall = before.surfaces.find((s) => s.kind === 'wall')!;
    const res = await app.request('/units/tall/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ceilingHeightM: 3.0, roomNames: { 'no-such-room': 'X' } }), // 2.5 m -> 3.0 m
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as typeof before;
    expect(after.surfaces.find((s) => s.id === wall.id)!.areaM2).toBeCloseTo(wall.areaM2! * 1.2, 1);
    for (const body of ['{"ceilingHeightM":1}', '{"extra":true}', 'not json']) {
      expect((await app.request('/units/tall/plan', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body })).status).toBe(400);
    }
  });
});

describe('walkthrough history', () => {
  it('a re-filmed baseline replaces the first one for the diff', async () => {
    const seen: number[] = [];
    const { app } = await makeApp(
      scriptedPipeline({
        findings: (kind) => (kind === 'baseline' ? [{ surfaceId: 'living-room.wall-n', type: 'scuff', confidence: 0.9, severity: 2, frameIds: ['f1'], decidedBy: 'decisions-api' }] : []),
        diff: (baseline) => {
          seen.push(baseline.length);
          return [];
        },
      }),
    );
    await newUnit(app, 'refilm');
    const first = await runUpload(app, 'refilm', 'baseline');
    const second = await runUpload(app, 'refilm', 'baseline');
    await runUpload(app, 'refilm', 'move-out');
    expect(seen).toEqual([1]); // one baseline's findings, not both
    const { walkthrough } = (await (await app.request('/units/refilm/findings')).json()) as { walkthrough: { id: string } };
    expect(walkthrough.id).toBe(second.walkthroughId);
    expect(walkthrough.id).not.toBe(first.walkthroughId);
    expect((await app.request(`/units/refilm/findings?walkthrough=${first.walkthroughId}`)).status).toBe(200);
  });

  it("the tenant's addendum findings count as move-in evidence", async () => {
    let baselineCount = 0;
    const one = (surfaceId: string) => [{ surfaceId, type: 'stain' as const, confidence: 0.9, severity: 2 as const, frameIds: ['f'], decidedBy: 'decisions-api' as const }];
    const { app } = await makeApp(
      scriptedPipeline({
        findings: (kind) => (kind === 'baseline' ? one('living-room.wall-n') : kind === 'tenant-addendum' ? one('bedroom.wall-e') : []),
        diff: (baseline) => {
          baselineCount = baseline.length;
          return [];
        },
      }),
    );
    await newUnit(app, 'addendum');
    await runUpload(app, 'addendum', 'baseline');
    await runUpload(app, 'addendum', 'tenant-addendum');
    await runUpload(app, 'addendum', 'move-out');
    expect(baselineCount).toBe(2);
  });

  it('jobs run one at a time, in upload order', async () => {
    const order: string[] = [];
    const slow: PipelineAdapter = {
      ...mockPipeline({ stepMs: 0 }),
      runWalkthrough: async ({ walkthrough }) => {
        order.push(`start ${walkthrough.unitId}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end ${walkthrough.unitId}`);
        return [];
      },
    };
    const { app } = await makeApp(slow);
    await newUnit(app, 'a');
    await newUnit(app, 'b');
    const [ra, rb] = await Promise.all([upload(app, 'a', 'baseline'), upload(app, 'b', 'baseline')]);
    const ja = ((await ra.json()) as { jobId: string }).jobId;
    const jb = ((await rb.json()) as { jobId: string }).jobId;
    await Promise.all([events(app, ja), events(app, jb)]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('pipeline output is validated before it is saved', () => {
  it('findings that break the contract fail the job and are not saved', async () => {
    const { app } = await makeApp(
      scriptedPipeline({ findings: () => [{ surfaceId: 'living-room.wall-n', type: 'stain', confidence: 0.9, severity: 9 as 1, frameIds: ['f'], decidedBy: 'decisions-api' }] }),
    );
    await newUnit(app, 'badf');
    const run = await runUpload(app, 'badf', 'baseline');
    expect(run.events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('invalid findings: 0.severity') });
    expect((await app.request('/units/badf/findings')).status).toBe(404);
  });
});

describe('job events', () => {
  it('a finished job replays all its events to a late listener', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'replay');
    const run = await runUpload(app, 'replay', 'baseline');
    const again = await events(app, run.jobId);
    expect(again).toEqual(run.events);
    const status = (await (await app.request(`/jobs/${run.jobId}`)).json()) as { status: string };
    expect(status.status).toBe('done');
  });

  it('progress stages arrive in pipeline order', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'order');
    await runUpload(app, 'order', 'baseline');
    const out = await runUpload(app, 'order', 'move-out');
    const stages = [...new Set(out.events.flatMap((e) => (e.type === 'progress' ? [e.stage] : [])))];
    expect(stages).toEqual(['frames', 'rooms', 'surfaces', 'findings', 'diff']);
  });

  it('a crash while reading the video becomes an error event and a failed job', async () => {
    const { app } = await makeApp(scriptedPipeline({ fail: 'walkthrough' }));
    await newUnit(app, 'crash');
    const run = await runUpload(app, 'crash', 'baseline');
    expect(run.events.at(-1)).toEqual({ type: 'error', message: 'ffmpeg could not read the video' });
    expect(((await (await app.request(`/jobs/${run.jobId}`)).json()) as { status: string }).status).toBe('failed');
  });

  it('a crash during the diff leaves no diff and no statement behind', async () => {
    const { app } = await makeApp(scriptedPipeline({ fail: 'diff' }));
    await newUnit(app, 'crash');
    await runUpload(app, 'crash', 'baseline');
    const run = await runUpload(app, 'crash', 'move-out');
    expect(run.events.at(-1)).toEqual({ type: 'error', message: 'Decisions API quota exceeded (429)' });
    expect((await app.request('/units/crash/diff')).status).toBe(404);
    expect((await app.request('/units/crash/statement')).status).toBe(404);
  });

  it('a job keeps working for the next upload after a crash', async () => {
    let calls = 0;
    const flaky: PipelineAdapter = {
      ...mockPipeline({ stepMs: 0 }),
      runWalkthrough: async () => {
        if (calls++ === 0) throw new Error('first one fails');
        return [];
      },
    };
    const { app } = await makeApp(flaky);
    await newUnit(app, 'flaky');
    expect((await runUpload(app, 'flaky', 'baseline')).events.at(-1)?.type).toBe('error');
    expect((await runUpload(app, 'flaky', 'baseline')).events.at(-1)?.type).toBe('done');
  });
});

describe('Decisions totals for the demo panel', () => {
  const stat = (calls: number, questions: number, avg: number, last = avg): DecisionsStat => ({ calls, questions, avgLatencyMs: avg, lastLatencyMs: last });

  it('never goes down across walkthrough + diff in a real move-out job', async () => {
    const { app } = await makeApp();
    await newUnit(app, 'stats');
    await runUpload(app, 'stats', 'baseline');
    const out = await runUpload(app, 'stats', 'move-out');
    const s = out.events.flatMap((e) => (e.type === 'decisions' ? [e.stats] : []));
    expect(s.length).toBeGreaterThan(10);
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.calls).toBe(s[i - 1]!.calls + 1);
      expect(s[i]!.questions).toBeGreaterThan(s[i - 1]!.questions);
    }
  });

  it('weights the average by calls across steps', () => {
    const t = new DecisionsTotals();
    t.begin();
    t.add(stat(4, 40, 500)); // 2000 ms total
    t.begin();
    expect(t.add(stat(1, 9, 1000))).toEqual(stat(5, 49, 600, 1000)); // (2000 + 1000) / 5
  });

  it('handles a step with no Decisions calls and repeated begin()', () => {
    const t = new DecisionsTotals();
    t.begin();
    t.add(stat(3, 30, 400));
    t.begin();
    t.begin(); // a step that reported nothing
    expect(t.add(stat(1, 5, 700))).toEqual(stat(4, 35, 475, 700));
  });

  it('counts per job: two jobs never share totals', async () => {
    const { app } = await makeApp(scriptedPipeline({ decisions: [stat(1, 10, 300), stat(2, 20, 300)] }));
    await newUnit(app, 'j');
    const a = await runUpload(app, 'j', 'baseline');
    const b = await runUpload(app, 'j', 'baseline');
    const last = (r: typeof a) => r.events.flatMap((e) => (e.type === 'decisions' ? [e.stats.calls] : [])).at(-1);
    expect(last(a)).toBe(2);
    expect(last(b)).toBe(2);
  });

  it('a move-out job adds the diff step on top of the walkthrough step', async () => {
    const { app } = await makeApp(scriptedPipeline({ decisions: [stat(1, 10, 300), stat(2, 20, 300)] }));
    await newUnit(app, 'k');
    await runUpload(app, 'k', 'baseline');
    const out = await runUpload(app, 'k', 'move-out');
    expect(out.events.flatMap((e) => (e.type === 'decisions' ? [e.stats.calls] : []))).toEqual([1, 2, 3, 4]);
  });
});

describe('statement charging rules (the pitch: never charge what we cannot prove)', () => {
  const cases: [string, DiffItem[], number][] = [
    ['one proven new stain', [item({ costUsd: 72.72 })], 72.72],
    ['moved chair with a cost attached is still $0', [item({ verdict: 'moved', costUsd: 300 })], 0],
    ['pre-existing damage is $0', [item({ verdict: 'pre-existing', costUsd: 55 })], 0],
    ['wear is $0', [item({ verdict: 'wear', costUsd: 20 })], 0],
    ['not visible is $0', [item({ verdict: 'not-visible', costUsd: 90 })], 0],
    ['"Not provable" new damage is $0 (any case, leading spaces)', [item({ reason: '  NOT PROVABLE: one pair', costUsd: 80 })], 0],
    ['new damage with no cost is $0', [item({ costUsd: undefined })], 0],
    ['negative cost is never subtracted', [item({ costUsd: 50 }), item({ costUsd: -20 })], 50],
    ['cents add up exactly', [item({ costUsd: 0.1 }), item({ costUsd: 0.2 }), item({ costUsd: 19.99 })], 20.29],
    ['nothing changed', [item({ verdict: 'no-change', costUsd: 0 })], 0],
    ['empty diff', [], 0],
  ];
  for (const [name, diff, total] of cases) {
    it(name, () => expect(buildStatement('u', '2026-11-21', diff).totalUsd).toBe(total));
  }

  it('lines are rounded to cents and always add up to the total', () => {
    const s = buildStatement('u', '2026-11-21', [item({ costUsd: 33.333 }), item({ costUsd: 33.333 }), item({ costUsd: 33.333 })]);
    expect(s.items.map((d) => d.costUsd)).toEqual([33.33, 33.33, 33.33]);
    expect(s.totalUsd).toBe(99.99);
  });

  it('charged lines come first, no-change lines are hidden, $0 lines stay visible', () => {
    const s = buildStatement('u', '2026-11-21', [
      item({ verdict: 'moved', surfaceId: 'a.floor', costUsd: 0 }),
      item({ verdict: 'no-change', surfaceId: 'b.wall-n' }),
      item({ surfaceId: 'z.wall-s', costUsd: 10 }),
      item({ verdict: 'pre-existing', surfaceId: 'c.wall-e', costUsd: 0 }),
    ]);
    expect(s.items.map((d) => d.surfaceId)).toEqual(['z.wall-s', 'a.floor', 'c.wall-e']);
  });

  it('due date is move-out + 14 days, across month and year ends', () => {
    expect(buildStatement('u', '2026-11-21', []).dueBy).toBe('2026-12-05');
    expect(buildStatement('u', '2026-12-25T18:00:00.000Z', []).dueBy).toBe('2027-01-08');
    expect(buildStatement('u', '2028-02-20', []).dueBy).toBe('2028-03-05'); // leap year
  });

  it('a bad move-out date throws instead of inventing a deadline', () => {
    expect(() => buildStatement('u', 'garbage', [])).toThrow();
  });

  it('statement HTML escapes text from the pipeline', async () => {
    const { app } = await makeApp(scriptedPipeline({ diff: [item({ reason: '<script>alert(1)</script> & "x"' })] }));
    await newUnit(app, 'xss');
    await runUpload(app, 'xss', 'baseline');
    await runUpload(app, 'xss', 'move-out');
    const html = await (await app.request('/units/xss/statement.html')).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&#60;script&#62;');
  });

  it('a pipeline diff that breaks the contract fails the job instead of saving bad data', async () => {
    const { app } = await makeApp(scriptedPipeline({ diff: [item({ confidence: 7 })] }));
    await newUnit(app, 'bad');
    await runUpload(app, 'bad', 'baseline');
    const out = await runUpload(app, 'bad', 'move-out');
    expect(out.events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('invalid diff: 0.confidence') });
    expect((await app.request('/units/bad/diff')).status).toBe(404); // bad data is never written to disk
    expect((await app.request('/units/bad/statement')).status).toBe(404);
  });
});

// [Alex] POST /units/:id/walkthroughs (video + kind) -> { jobId, walkthroughId }. The job runs the pipeline;
// a move-out upload also runs the diff and writes the statement when a baseline exists.
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { DiffItemSchema, FindingSchema, WalkthroughKindSchema, type Walkthrough } from '@ledger/shared';
import type { Deps } from '../deps.js';
import { DecisionsTotals } from '../events.js';
import type { RunHooks } from '../pipeline.js';
import { buildStatement } from '../statement/build.js';
import { HttpError } from '../storage.js';
import { latest, loadFindings, loadPlan, loadUnit, paths } from '../units.js';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);

export function walkthroughRoutes(d: Deps) {
  const r = new Hono();

  r.post('/:id/walkthroughs', async (c) => {
    const unitId = c.req.param('id');
    const unit = await loadUnit(d.storage, unitId);
    const body = await c.req.parseBody();
    const kind = WalkthroughKindSchema.safeParse(body.kind);
    if (!kind.success) throw new HttpError(400, 'field "kind" must be baseline | tenant-addendum | move-out');
    const file = body.video;
    if (!(file instanceof File)) throw new HttpError(400, 'multipart field "video" is required');
    const ext = (extname(file.name) || '.mp4').toLowerCase();
    if (!VIDEO_EXT.has(ext)) throw new HttpError(400, `video must be one of ${[...VIDEO_EXT].join(', ')}`);
    if (kind.data === 'move-out' && !latest(unit, 'baseline')) throw new HttpError(409, 'upload a baseline walkthrough first');

    const wid = `${kind.data}-${randomUUID().slice(0, 8)}`;
    const wdir = d.storage.walkthroughDir(unitId, wid);
    const videoPath = join(wdir, `video${ext}`);
    await d.storage.writeFile(videoPath, new Uint8Array(await file.arrayBuffer()));
    const capturedAt = typeof body.capturedAt === 'string' && !Number.isNaN(Date.parse(body.capturedAt)) ? new Date(body.capturedAt).toISOString() : new Date().toISOString();
    const walkthrough: Walkthrough = { id: wid, unitId, kind: kind.data, videoPath, capturedAt };
    await d.storage.writeJson(join(wdir, 'walkthrough.json'), walkthrough);
    unit.walkthroughs.push(walkthrough);
    await d.storage.writeJson(paths(d.storage, unitId).unit, unit);

    const jobId = `job-${randomUUID().slice(0, 8)}`;
    d.jobs.create(jobId, unitId, wid);
    void d.queue.add(() => runJob(d, jobId, unitId, walkthrough));
    return c.json({ jobId, walkthroughId: wid }, 202);
  });

  return r;
}

async function runJob(d: Deps, jobId: string, unitId: string, w: Walkthrough): Promise<void> {
  d.jobs.setStatus(jobId, 'running');
  const totals = new DecisionsTotals();
  const hooks: RunHooks = {
    onProgress: (stage, done, total) => d.jobs.emit(jobId, { type: 'progress', stage, done, total }),
    onDecisions: (stats) => d.jobs.emit(jobId, { type: 'decisions', stats: totals.add(stats) }),
  };
  try {
    const p = paths(d.storage, unitId);
    const plan = await loadPlan(d.storage, unitId);
    totals.begin();
    const findings = checked('findings', z.array(FindingSchema), await d.pipeline.runWalkthrough({ plan, walkthrough: w, workDir: d.storage.walkthroughDir(unitId, w.id), ...hooks }));
    await d.storage.writeJson(p.findings(w.id), findings);

    let diffItems: number | undefined;
    if (w.kind === 'move-out') {
      const unit = await loadUnit(d.storage, unitId);
      const before = [latest(unit, 'baseline'), latest(unit, 'tenant-addendum')].filter((x): x is Walkthrough => !!x);
      const baseline = (await Promise.all(before.map((b) => loadFindings(d.storage, unitId, b.id)))).flatMap((f) => f ?? []);
      totals.begin();
      const dirOf = (x?: Walkthrough) => (x ? d.storage.walkthroughDir(unitId, x.id) : undefined);
      const dirs = { baseline: dirOf(latest(unit, 'baseline')), addendum: dirOf(latest(unit, 'tenant-addendum')), moveOut: d.storage.walkthroughDir(unitId, w.id) };
      const diff = checked('diff', z.array(DiffItemSchema), await d.pipeline.runDiff({ plan, baseline, moveOut: findings, dirs, ...hooks }));
      const statement = buildStatement(unitId, w.capturedAt, diff);
      await d.storage.writeJson(p.diff, diff);
      await d.storage.writeJson(p.statement, statement);
      diffItems = diff.length;
    }
    d.jobs.emit(jobId, { type: 'done', result: { walkthroughId: w.id, findings: findings.length, diffItems } });
  } catch (err) {
    d.jobs.emit(jobId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** Validate pipeline output against the shared contract before anything is saved. */
function checked<T>(what: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  throw new Error(`pipeline returned invalid ${what}: ${first ? `${first.path.join('.')} ${first.message}` : 'unknown'}`);
}

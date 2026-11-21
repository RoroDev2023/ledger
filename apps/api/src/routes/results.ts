// [Alex] GET /units/:id/findings?walkthrough=, /diff, /statement, /statement.html.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { StatementSchema } from '@ledger/shared';
import type { Deps } from '../deps.js';
import { renderStatementHtml } from '../statement/template.js';
import { HttpError } from '../storage.js';
import { latest, loadDiff, loadFindings, loadUnit, paths } from '../units.js';

export function resultRoutes(d: Deps) {
  const r = new Hono();

  /** ?walkthrough=<wid> or ?kind=baseline|move-out (latest of that kind). Default: baseline. */
  r.get('/:id/findings', async (c) => {
    const unitId = c.req.param('id');
    const unit = await loadUnit(d.storage, unitId);
    const wid = c.req.query('walkthrough');
    const kind = c.req.query('kind') ?? 'baseline';
    const w = wid ? unit.walkthroughs.find((x) => x.id === wid) : latest(unit, kind === 'move-out' ? 'move-out' : kind === 'tenant-addendum' ? 'tenant-addendum' : 'baseline');
    if (!w) throw new HttpError(404, 'walkthrough not found');
    const findings = await loadFindings(d.storage, unitId, w.id);
    if (!findings) throw new HttpError(404, 'findings not ready');
    return c.json({ walkthrough: w, findings });
  });

  /** The proof behind each verdict (pairs, box), written by the real pipeline. Empty when it wasn't used. */
  r.get('/:id/evidence', async (c) => {
    const unitId = c.req.param('id');
    await loadUnit(d.storage, unitId);
    const raw = await readFile(join(d.storage.unitDir(unitId), 'diff-evidence.json'), 'utf8').catch(() => null);
    return c.json(raw ? (JSON.parse(raw) as unknown) : { evidence: [], warnings: [] });
  });

  r.get('/:id/diff', async (c) => {
    const diff = await loadDiff(d.storage, c.req.param('id'));
    if (!diff) throw new HttpError(404, 'diff not ready');
    return c.json(diff);
  });

  const statement = async (unitId: string) => {
    const s = await d.storage.readJson(paths(d.storage, unitId).statement, StatementSchema);
    if (!s) throw new HttpError(404, 'statement not ready');
    return s;
  };
  r.get('/:id/statement', async (c) => c.json(await statement(c.req.param('id'))));
  r.get('/:id/statement.html', async (c) => c.html(renderStatementHtml(await statement(c.req.param('id')))));

  return r;
}

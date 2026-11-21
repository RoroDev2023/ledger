// [Alex] GET /units/:id/frames/:frameId -> the keyframe image. Real frames live in
// walkthroughs/<wid>/frames/<frameId>.jpg (written by the pipeline). In mock mode, or before the pipeline has
// written them, a labeled placeholder SVG is returned so the evidence panel always has something to show.
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Hono } from 'hono';
import type { Deps } from '../deps.js';
import { HttpError } from '../storage.js';
import { loadUnit } from '../units.js';

const FRAME_ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/; // pipeline ids look like "<walkthrough>.f00042"

export function frameRoutes(d: Deps) {
  const r = new Hono();
  r.get('/:id/frames/:frameId', async (c) => {
    const unitId = c.req.param('id');
    const frameId = c.req.param('frameId');
    if (!FRAME_ID.test(frameId) || frameId.includes('..')) throw new HttpError(400, `bad frame id: ${frameId}`);
    const unit = await loadUnit(d.storage, unitId);
    const w = unit.walkthroughs.find((x) => frameId.startsWith(`${x.id}.`) || frameId.startsWith(`${x.id}-`));
    if (w) {
      const dir = d.storage.walkthroughDir(unitId, w.id);
      // 1) the pipeline's own frame list knows each frame's file
      const list = await readFile(join(dir, 'frames.json'), 'utf8').then((t) => JSON.parse(t) as { id: string; path: string }[], () => []);
      const listed = list.find((f) => f.id === frameId)?.path;
      // 2) or the conventional file name
      const candidates = [listed, ...['jpg', 'jpeg', 'png', 'webp'].map((ext) => join(dir, 'frames', `${frameId}.${ext}`))].filter((x): x is string => !!x);
      for (const file of candidates) {
        if (!resolve(file).startsWith(resolve(dir))) continue; // never serve outside the walkthrough folder
        const data = await readFile(file).catch(() => null);
        if (data) {
          const ext = extname(file).slice(1).toLowerCase();
          return c.body(new Uint8Array(data), 200, { 'content-type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', 'cache-control': 'max-age=3600' });
        }
      }
    }
    return c.body(placeholderFrame(frameId, w?.kind ?? 'unknown'), 200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
  });
  return r;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A 16:9 "wall" with soft light, a baseboard and a label: clearly a placeholder, still readable on screen. */
export function placeholderFrame(frameId: string, kind: string): string {
  const after = kind === 'move-out';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><radialGradient id="l" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#f5f1ea"/><stop offset="1" stop-color="#cfc7b8"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#l)"/><rect y="640" width="1280" height="80" fill="#b9ae9b"/><rect y="628" width="1280" height="12" fill="#e9e3d8"/>
${after ? '<ellipse cx="652" cy="324" rx="70" ry="48" fill="#8c7a5c" opacity=".45"/><ellipse cx="640" cy="330" rx="40" ry="26" fill="#6d5c42" opacity=".35"/>' : ''}
<text x="40" y="70" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#6b6255">${after ? 'MOVE-OUT' : 'MOVE-IN'} · placeholder frame</text>
<text x="40" y="112" font-family="ui-monospace,monospace" font-size="24" fill="#8a8173">${esc(frameId)}</text>
</svg>`;
}

// [Alex] GET /units/:id/frames/:frameId -> the keyframe image. Real frames live in
// walkthroughs/<wid>/frames/<frameId>.jpg (written by the pipeline). In mock mode, or before the pipeline has
// written them, a labeled placeholder SVG is returned so the evidence panel always has something to show.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Deps } from '../deps.js';
import { assertSafeId } from '../storage.js';
import { loadUnit } from '../units.js';

export function frameRoutes(d: Deps) {
  const r = new Hono();
  r.get('/:id/frames/:frameId', async (c) => {
    const unitId = c.req.param('id');
    const frameId = assertSafeId(c.req.param('frameId'));
    const unit = await loadUnit(d.storage, unitId);
    const w = unit.walkthroughs.find((x) => frameId.startsWith(`${x.id}-`));
    if (w) {
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        const data = await readFile(join(d.storage.walkthroughDir(unitId, w.id), 'frames', `${frameId}.${ext}`)).catch(() => null);
        if (data) return c.body(new Uint8Array(data), 200, { 'content-type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, 'cache-control': 'max-age=3600' });
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

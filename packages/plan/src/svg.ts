// Top-down plan.svg with every surface ID printed on it. Used by Carbon localization (as an image)
// and by Alex's minimap. North is up.
import type { FloorPlan } from '@ledger/shared';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPlanSvg(plan: FloorPlan, opts: { pxPerM?: number; margin?: number } = {}): string {
  const k = opts.pxPerM ?? 100;
  const m = opts.margin ?? 40;
  const xs = plan.rooms.flatMap((r) => r.polygon.map((p) => p[0]));
  const ys = plan.rooms.flatMap((r) => r.polygon.map((p) => p[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const W = (maxX - minX) * k + 2 * m;
  const H = (maxY - minY) * k + 2 * m;
  const X = (x: number) => m + (x - minX) * k;
  const Y = (y: number) => m + (maxY - y) * k; // flip: north up

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Helvetica, Arial, sans-serif">`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  for (const r of plan.rooms) {
    const pts = r.polygon.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
    const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length;
    const cy = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
    parts.push(`<polygon data-surface-id="${esc(r.id)}.floor" points="${pts}" fill="#eef6f7" stroke="none"/>`);
    parts.push(`<text x="${X(cx).toFixed(1)}" y="${Y(cy).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="bold" fill="#1f2a30">${esc(r.name)}</text>`);
    parts.push(`<text x="${X(cx).toFixed(1)}" y="${(Y(cy) + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#5f6b72">${esc(r.id)}.floor</text>`);
  }

  for (const s of plan.surfaces) {
    if (s.kind !== 'wall' || !s.segment) continue;
    const [[x1, y1], [x2, y2]] = s.segment;
    parts.push(`<line data-surface-id="${esc(s.id)}" x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="#1f2a30" stroke-width="6" stroke-linecap="square"/>`);
    // Label slightly inside the room, along the wall's inward normal.
    const room = plan.rooms.find((r) => r.id === s.roomId);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    let lx = mx;
    let ly = my;
    if (room) {
      const cx = room.polygon.reduce((a, p) => a + p[0], 0) / room.polygon.length;
      const cy = room.polygon.reduce((a, p) => a + p[1], 0) / room.polygon.length;
      const d = Math.hypot(cx - mx, cy - my) || 1;
      lx = mx + ((cx - mx) / d) * 0.35;
      ly = my + ((cy - my) / d) * 0.35;
    }
    parts.push(`<text x="${X(lx).toFixed(1)}" y="${Y(ly).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#006e79">${esc(s.id.split('.').pop() ?? s.id)}</text>`);
  }

  for (const o of plan.openings) {
    const wall = plan.surfaces.find((s) => s.id === o.wallId);
    if (!wall?.segment) continue;
    const [[x1, y1], [x2, y2]] = wall.segment;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / L;
    const uy = (y2 - y1) / L;
    const ax = x1 + ux * o.offsetM;
    const ay = y1 + uy * o.offsetM;
    const bx = ax + ux * o.widthM;
    const by = ay + uy * o.widthM;
    const color = o.kind === 'door' ? '#ff9015' : '#3a8dde';
    parts.push(`<line data-opening-id="${esc(o.id)}" x1="${X(ax).toFixed(1)}" y1="${Y(ay).toFixed(1)}" x2="${X(bx).toFixed(1)}" y2="${Y(by).toFixed(1)}" stroke="${color}" stroke-width="8"/>`);
  }

  parts.push(`<text x="${W - 22}" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#1f2a30">N ↑</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

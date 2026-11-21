// E3 · Draw a FloorPlan as a real-estate-style listing plan image (no surface IDs, feet and inches),
// so Argon can be tested on drawings whose exact answer we know (the FloorPlan they came from).
import type { FloorPlan } from '@ledger/shared';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 3.66 -> 12'0" (rounded to the nearest inch). */
export function feetInches(m: number): string {
  const totalIn = Math.round(m / 0.0254);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

/** square: pad the canvas to a square so square thumbnailers (e.g. macOS Quick Look) do not crop wide plans. */
export function renderListingSvg(plan: FloorPlan, opts: { pxPerM?: number; title?: string; square?: boolean } = {}): string {
  const k = opts.pxPerM ?? 110;
  const m = 90;
  const xs = plan.rooms.flatMap((r) => r.polygon.map((p) => p[0]));
  const ys = plan.rooms.flatMap((r) => r.polygon.map((p) => p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W0 = Math.round((maxX - minX) * k + 2 * m);
  const H0 = Math.round((maxY - minY) * k + 2 * m + 40);
  const S = Math.max(W0, H0);
  const W = opts.square ? S : W0;
  const H = opts.square ? S : H0;
  const padX = (W - W0) / 2;
  const padY = (H - H0) / 2;
  const X = (x: number) => padX + m + (x - minX) * k;
  const Y = (y: number) => padY + m + 40 + (maxY - y) * k;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  if (opts.title) out.push(`<text x="${padX + m}" y="${padY + 40}" font-size="20" font-weight="bold" fill="#111">${esc(opts.title)}</text>`);

  // Floors (light), then walls (thick black), then openings cut into the walls.
  for (const r of plan.rooms) {
    out.push(`<polygon points="${r.polygon.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="#f7f7f2" stroke="none"/>`);
  }
  for (const s of plan.surfaces) {
    if (s.kind !== 'wall' || !s.segment) continue;
    const [[x1, y1], [x2, y2]] = s.segment;
    out.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="#111" stroke-width="9" stroke-linecap="square"/>`);
  }
  for (const o of plan.openings) {
    const wall = plan.surfaces.find((s) => s.id === o.wallId);
    if (!wall?.segment) continue;
    const [[x1, y1], [x2, y2]] = wall.segment;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const [ux, uy] = [(x2 - x1) / L, (y2 - y1) / L];
    const a: [number, number] = [x1 + ux * o.offsetM, y1 + uy * o.offsetM];
    const b: [number, number] = [a[0] + ux * o.widthM, a[1] + uy * o.widthM];
    // Cut the gap in the wall.
    out.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Y(a[1]).toFixed(1)}" x2="${X(b[0]).toFixed(1)}" y2="${Y(b[1]).toFixed(1)}" stroke="#ffffff" stroke-width="11"/>`);
    if (o.kind === 'window') {
      // Two thin parallel lines across the gap.
      const [nx, ny] = [-uy * 0.04, ux * 0.04];
      for (const sgn of [1, -1])
        out.push(`<line x1="${X(a[0] + sgn * nx).toFixed(1)}" y1="${Y(a[1] + sgn * ny).toFixed(1)}" x2="${X(b[0] + sgn * nx).toFixed(1)}" y2="${Y(b[1] + sgn * ny).toFixed(1)}" stroke="#111" stroke-width="2"/>`);
    } else {
      // Door leaf + quarter-circle swing into the room on the wall's inner side.
      const room = plan.rooms.find((r) => r.id === wall.roomId);
      const cx = room ? room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length : a[0];
      const cy = room ? room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length : a[1];
      let [nx, ny] = [-uy, ux];
      if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) [nx, ny] = [-nx, -ny];
      const tip: [number, number] = [a[0] + nx * o.widthM, a[1] + ny * o.widthM];
      out.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Y(a[1]).toFixed(1)}" x2="${X(tip[0]).toFixed(1)}" y2="${Y(tip[1]).toFixed(1)}" stroke="#111" stroke-width="2"/>`);
      const r = o.widthM * k;
      out.push(`<path d="M ${X(tip[0]).toFixed(1)} ${Y(tip[1]).toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${nx * uy - ny * ux > 0 ? 1 : 0} ${X(b[0]).toFixed(1)} ${Y(b[1]).toFixed(1)}" fill="none" stroke="#111" stroke-width="1.2"/>`);
    }
  }
  // Room names and sizes (bounding box in feet).
  for (const r of plan.rooms) {
    const rx = r.polygon.map((p) => p[0]);
    const ry = r.polygon.map((p) => p[1]);
    const w = Math.max(...rx) - Math.min(...rx);
    const h = Math.max(...ry) - Math.min(...ry);
    const cx = (Math.max(...rx) + Math.min(...rx)) / 2;
    const cy = (Math.max(...ry) + Math.min(...ry)) / 2;
    out.push(`<text x="${X(cx).toFixed(1)}" y="${Y(cy).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="bold" fill="#111">${esc(r.name.toUpperCase())}</text>`);
    out.push(`<text x="${X(cx).toFixed(1)}" y="${(Y(cy) + 18).toFixed(1)}" text-anchor="middle" font-size="13" fill="#333">${feetInches(w)} x ${feetInches(h)}</text>`);
  }
  // Fixture names on one line under each room's size.
  for (const r of plan.rooms) {
    const names = plan.surfaces.filter((s) => s.kind === 'fixture' && s.roomId === r.id).map((f) => f.label.replace(`${r.name} `, ''));
    if (!names.length) continue;
    const rx = r.polygon.map((p) => p[0]);
    const ry = r.polygon.map((p) => p[1]);
    const cx = (Math.max(...rx) + Math.min(...rx)) / 2;
    const cy = (Math.max(...ry) + Math.min(...ry)) / 2;
    out.push(`<text x="${X(cx).toFixed(1)}" y="${(Y(cy) + 36).toFixed(1)}" text-anchor="middle" font-size="11" font-style="italic" fill="#555">${esc(names.join(', '))}</text>`);
  }
  // Overall dimension lines: width below, height on the left.
  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, vertical: boolean) => {
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="1"/>`);
    for (const [x, y] of [[x1, y1], [x2, y2]] as const)
      out.push(vertical ? `<line x1="${x - 6}" y1="${y}" x2="${x + 6}" y2="${y}" stroke="#555"/>` : `<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="#555"/>`);
    const tx = (x1 + x2) / 2;
    const ty = (y1 + y2) / 2;
    out.push(vertical
      ? `<text x="${tx - 10}" y="${ty}" text-anchor="middle" font-size="13" fill="#333" transform="rotate(-90 ${tx - 10} ${ty})">${label}</text>`
      : `<text x="${tx}" y="${ty + 18}" text-anchor="middle" font-size="13" fill="#333">${label}</text>`);
  };
  dim(X(minX), Y(minY) + 30, X(maxX), Y(minY) + 30, feetInches(maxX - minX), false);
  dim(X(minX) - 30, Y(maxY), X(minX) - 30, Y(minY), feetInches(maxY - minY), true);
  // North arrow.
  out.push(`<g transform="translate(${W - 50},${70})"><path d="M0 -22 L8 6 L0 0 L-8 6 Z" fill="#111"/><text y="22" text-anchor="middle" font-size="13" font-weight="bold">N</text></g>`);
  out.push('</svg>');
  return out.join('\n');
}

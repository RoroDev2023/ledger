// pnpm --filter @ledger/eval kit [plan] [--cards N]  ->  eval/kit/<name>-kit.html (+ .pdf if Chrome is available)
// [plan] = a fixture name (default demo-table), a FloorPlan JSON, or the scanner's RoomPlan room.json.
// Printable kit for the demo and the test pairs: the plan, and judge cards whose wall names
// are generated from the plan, so what a person writes maps 1:1 to our surface IDs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURES_DIR, listPlanFixtures, type FloorPlan } from '@ledger/shared';
import { renderPlanSvg, resolvePlan } from './plan-source.js';

const ISSUES = ['scratch / scuff', 'stain', 'hole', 'crack', 'missing fixture', 'other'];

function card(plan: FloorPlan, n: number): string {
  const walls = plan.surfaces.filter((s) => s.kind === 'wall' || s.kind === 'floor');
  const rows = walls
    .map((s) => `<tr><td class="id">${s.id}</td><td>${s.label}</td><td class="box"></td><td class="box"></td><td class="box"></td></tr>`)
    .join('');
  return `<section class="card">
  <h2>Judge card ${n} · ${plan.unitId === 'demo-table' ? 'Unit 4B' : plan.unitId}</h2>
  <p class="small">Write this <b>before</b> you see any result. Pair id: ________ &nbsp; Your name (optional): ____________</p>
  <table>
    <thead><tr><th>Surface</th><th></th><th>New mark<br><span class="small">(type)</span></th><th>Already there</th><th>Object moved<br><span class="small">to/from</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="small">Mark types: ${ISSUES.join(' · ')}. &nbsp; ☐ Nothing changed (clean re-shoot)</p>
</section>`;
}

const args = process.argv.slice(2);
const ci = args.indexOf('--cards');
const nCards = ci >= 0 ? Math.max(1, Number(args[ci + 1]) || 2) : 2;
const planArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--cards') ?? 'demo-table';
const isFixture = listPlanFixtures().includes(planArg);
const plan = resolvePlan(planArg, process.env.INIT_CWD ?? process.cwd());
const name = isFixture ? planArg : plan.unitId;
const fixtureSvg = join(FIXTURES_DIR, 'plan-images', `${planArg}.svg`);
const svg = isFixture && existsSync(fixtureSvg) ? readFileSync(fixtureSvg, 'utf8') : renderPlanSvg(plan);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>LEDGER demo kit · ${name}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; }
  .plan { page-break-after: always; text-align: center; }
  .plan svg { width: 100%; height: auto; max-height: 230mm; }
  .card { page-break-inside: avoid; border: 1.5px solid #111; border-radius: 6px; padding: 8px 12px; margin-bottom: 10mm; }
  h1 { font-size: 20px; margin: 0 0 6px; } h2 { font-size: 15px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; }
  td.id { font-family: Menlo, monospace; font-size: 10px; white-space: nowrap; } td.box { width: 22%; }
  .small { font-size: 10px; color: #444; margin: 2px 0 6px; }
</style></head><body>
<div class="plan"><h1>${name === 'demo-table' ? 'Unit 4B' : name} · floor plan</h1>${svg}</div>
${Array.from({ length: nCards }, (_, i) => card(plan, i + 1)).join('')}
</body></html>`;

const outDir = resolve(import.meta.dirname, '..', '..', '..', 'eval', 'kit');
mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, `${name}-kit.html`);
writeFileSync(htmlPath, html);
console.log(`wrote ${htmlPath}`);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(chrome)) {
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(outDir, `${name}-kit.pdf`)}`, `file://${htmlPath}`], { stdio: 'ignore', timeout: 60_000 });
    console.log(`wrote ${join(outDir, `${name}-kit.pdf`)}`);
  } catch {
    console.log('Chrome PDF export failed; print the HTML from a browser instead.');
  }
}

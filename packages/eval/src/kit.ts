// pnpm --filter @ledger/eval kit  ->  eval/kit/demo-kit.html (+ .pdf if Chrome is available)
// Printable kit for the demo table and the test pairs: the plan, and judge cards whose wall names
// are generated from the plan, so what a person writes maps 1:1 to our surface IDs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURES_DIR, loadPlanFixture, type FloorPlan } from '@ledger/shared';

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

const name = process.argv[2] ?? 'demo-table';
const plan = loadPlanFixture(name);
const svg = readFileSync(join(FIXTURES_DIR, 'plan-images', `${name}.svg`), 'utf8');

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
${card(plan, 1)}${card(plan, 2)}
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

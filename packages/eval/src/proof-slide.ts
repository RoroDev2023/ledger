// pnpm --filter @ledger/eval proof-slide [--sample]  ->  eval/proof-slide.{html,png}
// The 2:25-3:00 proof slide, generated from eval/results.json (written by `pnpm eval`) so the numbers on
// stage are exactly the measured ones. --sample renders with clearly labelled made-up numbers, for layout only.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { score } from './metrics.js';
import type { SystemSummary } from './report.js';

interface Results { split: string; generatedAt: string; pairs: number; cleanPairs: number; systems: SystemSummary[] }

const root = resolve(import.meta.dirname, '..', '..', '..');
const sample = process.argv.includes('--sample');
const resultsPath = join(root, 'eval', 'results.json');

function sampleResults(): Results {
  const sys = (name: string, fc: number, mv: number, usd: number, tp: number, fp: number, fn: number): SystemSummary => ({
    name, pairsScored: 18, pairsMissing: [], cleanPairs: 6, falseChargesOnClean: fc, movedChargeCount: mv, movedChargeUsd: usd,
    notProvable: name === 'LEDGER' ? 3 : 0, change: { tp, fp, fn },
    confusion: {} as SystemSummary['confusion'],
  });
  return { split: 'test', generatedAt: 'SAMPLE', pairs: 18, cleanPairs: 6, systems: [sys('LEDGER', 0, 0, 0, 14, 1, 4), sys('Neon one-call baseline', 3, 2, 55, 11, 7, 7)] };
}

if (!sample && !existsSync(resultsPath)) {
  console.log('No eval/results.json yet. Run `pnpm eval` first, or use --sample for a layout preview.');
  process.exit(0);
}
const r: Results = sample ? sampleResults() : JSON.parse(readFileSync(resultsPath, 'utf8'));
const [ours, base] = r.systems;
if (!ours || !base) throw new Error('results.json needs two systems');
const so = score(ours.change);
const sb = score(base.change);
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Better = 'lower' | 'higher';
/** Colour whichever system actually did better on this metric; grey both on a tie. Never assume we win. */
function tone(a: number, b: number, better: Better): [string, string] {
  if (a === b) return ['even', 'even'];
  const oursWins = better === 'lower' ? a < b : a > b;
  return oursWins ? ['win', 'lose'] : ['lose', 'win'];
}
const big = (label: string, a: string, b: string, t: [string, string], note: string) => `
  <div class="metric"><div class="label">${label}</div>
    <div class="row"><div class="val ${t[0]}">${a}</div><div class="who">LEDGER</div></div>
    <div class="row"><div class="val ${t[1]}">${b}</div><div class="who">Neon, one call (also given the plan)</div></div>
    <div class="note">${note}</div></div>`;

/** The latest "## ..." entry of eval/failures.md, condensed to its first three bullet points. */
function lastFailure(): string {
  const p = join(root, 'eval', 'failures.md');
  if (!existsSync(p)) return '';
  const blocks = readFileSync(p, 'utf8').split(/\n(?=## )/).filter((b) => b.startsWith('## '));
  const last = blocks.at(-1);
  if (!last) return '';
  const title = last.split('\n')[0]!.replace(/^## /, '');
  const get = (k: string) => (last.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*([^\\n]+)`)) ?? [])[1] ?? '';
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/`/g, '');
  return `<div class="fail"><b>A failure we fixed</b> · ${esc(title)}<br><span>Broke:</span> ${esc(get('What broke'))}<br><span>Fix:</span> ${esc(get('Fix'))}<br><span>After:</span> ${esc(get('Did it help'))}</div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>LEDGER proof</title><style>
  * { box-sizing: border-box; } body { margin: 0; width: 1280px; height: 720px; font-family: Helvetica, Arial, sans-serif; color: #111; background: #fff; }
  .wrap { padding: 44px 56px; height: 100%; display: flex; flex-direction: column; }
  h1 { font-size: 34px; margin: 0; } .sub { font-size: 16px; color: #555; margin: 6px 0 26px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
  .metric { border: 2px solid #111; border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; }
  .label { font-size: 18px; font-weight: bold; } .row { display: flex; align-items: baseline; gap: 12px; }
  .val { font-size: 64px; font-weight: bold; font-variant-numeric: tabular-nums; min-width: 150px; line-height: 1.05; } .win { color: #0a7d3b; } .lose { color: #b3261e; } .even { color: #555; }
  .who { font-size: 14px; color: #444; } .note { font-size: 13px; color: #555; margin-top: 6px; }
  .fail { margin-top: 22px; border-left: 5px solid #111; background: #f5f5f2; padding: 12px 16px; font-size: 14px; line-height: 1.45; } .fail span { color: #555; font-weight: bold; }
  .foot { font-size: 13px; color: #555; margin-top: 18px; } .stamp { color: #b3261e; font-weight: bold; }
</style></head><body><div class="wrap">
  <h1>Won't charge what it can't prove</h1>
  <div class="sub">${r.pairs} held-out ${r.split} pairs (${r.cleanPairs} clean re-shoots). Changes staged and written down by people outside the team. Same pairs, same scorer for both.${sample ? ' <span class="stamp">SAMPLE NUMBERS: layout only</span>' : ''}</div>
  <div class="grid">
    ${big('False charges on clean re-shoots', String(ours.falseChargesOnClean), String(base.falseChargesOnClean), tone(ours.falseChargesOnClean, base.falseChargesOnClean, 'lower'), `nothing changed in these ${r.cleanPairs} pairs, so every charge is false`)}
    ${big('Charged for moved objects', `$${ours.movedChargeUsd.toFixed(0)}`, `$${base.movedChargeUsd.toFixed(0)}`, tone(ours.movedChargeUsd, base.movedChargeUsd, 'lower'), `${ours.movedChargeCount} vs ${base.movedChargeCount} charged items where only furniture moved`)}
    ${big('New damage found', `${so.tp}/${so.tp + so.fn}`, `${sb.tp}/${sb.tp + sb.fn}`, tone(so.tp, sb.tp, 'higher'), `precision ${pct(so.precision)} vs ${pct(sb.precision)} · ${ours.notProvable} surfaces not provable ($0)`)}
  </div>
  ${lastFailure()}
  <div class="foot">Raw counts, small sample. Full table: eval/results.md · failures and fixes: eval/failures.md · generated ${r.generatedAt}</div>
</div></body></html>`;

const out = join(root, 'eval');
mkdirSync(out, { recursive: true });
const name = sample ? 'proof-slide.sample' : 'proof-slide';
const htmlPath = join(out, `${name}.html`);
writeFileSync(htmlPath, html);
console.log(`wrote ${htmlPath}`);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (existsSync(chrome)) {
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,720', `--screenshot=${join(out, `${name}.png`)}`, `file://${htmlPath}`], { stdio: 'ignore', timeout: 60_000 });
    console.log(`wrote ${join(out, `${name}.png`)}`);
  } catch {
    console.log('Chrome screenshot failed; open the HTML and screenshot it.');
  }
}

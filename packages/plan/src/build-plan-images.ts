// Writes listing-style plan images (SVG + PNG) for every plan fixture, for Argon tests and the demo table.
// PNG via macOS Quick Look (qlmanage); on other systems only the SVG is written.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR, listPlanFixtures, loadPlanFixture } from '@ledger/shared';
import { renderListingSvg } from './listing.js';

const out = join(FIXTURES_DIR, 'plan-images');
mkdirSync(out, { recursive: true });
for (const name of listPlanFixtures()) {
  const plan = loadPlanFixture(name);
  const svgPath = join(out, `${name}.svg`);
  writeFileSync(svgPath, renderListingSvg(plan, { title: name === 'demo-table' ? 'Unit 4B' : undefined, square: true }) + '\n');
  try {
    execFileSync('qlmanage', ['-t', '-s', '1400', '-o', out, svgPath], { stdio: 'ignore' });
    const ql = join(out, `${name}.svg.png`);
    if (existsSync(ql)) renameSync(ql, join(out, `${name}.png`));
    console.log(`wrote ${name}.svg and ${name}.png`);
  } catch {
    console.log(`wrote ${name}.svg (no qlmanage: convert to PNG yourself)`);
  }
}

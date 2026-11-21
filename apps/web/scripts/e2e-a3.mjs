/* global process, console, document, location, setTimeout, fetch */
// [Alex] Clicks through the whole A3 flow in a real Chrome, like a user: landing -> New unit -> upload plan
// (Argon reads it) -> fix ceiling -> move-in video with live progress -> unit page -> move-out -> statement.
// Needs the API (:3001) and web app (:3000) running.
//   pnpm --filter @ledger/web e2e ../api/test/plans/two-bed-hall.pdf [screenshot-dir]
// Uses your installed Chrome (set CHROME=/path/to/chrome elsewhere). Exits non-zero on any failure or browser error.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const planPath = resolve(process.argv[2] ?? '../api/test/plans/two-bed-hall.pdf');
const out = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'ledger-e2e-'));
const video = join(out, 'walk.mp4');
writeFileSync(video, 'not-a-real-video (the mock pipeline does not read it)');
const unitId = `a3-${Date.now().toString(36)}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,950'], defaultViewport: { width: 1400, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`[${current}] ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`[${current}] HTTP ${r.status()} ${r.url()}`));
page.on('pageerror', (e) => errors.push(`[${current}] ${String(e)}`));
let current = 'start';
const step = async (name, fn) => { current = name; const t = Date.now(); await fn(); console.log(`✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); };
const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click(); }, t);
const waitText = (t, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, t);

await step('landing → New unit', async () => {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickText('New unit from a floor plan')]);
  await waitText('Read plan');
});
await step('upload plan PDF, Argon reads it', async () => {
  const [planInput] = await page.$$('input[type=file]');
  await planInput.uploadFile(planPath);
  await page.type('input[placeholder="e.g. apt-4b"]', unitId);
  await clickText('Read plan');
  await waitText('Looks right, continue', 120000);
});
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/a3-1-review.png` });
await step('fix ceiling height 2.75, continue', async () => {
  const c = await page.$('input[type=number]');
  await c.evaluate((el) => el.select()); await c.type('2.75');
  await clickText('Looks right, continue'); await page.waitForSelector('input[type=date]', { timeout: 30000 });
});
await step('upload move-in video, live progress, land on unit page', async () => {
  const [v] = await page.$$('input[type=file]'); await v.uploadFile(video);
  await clickText('Upload move-in'); await page.waitForFunction((u) => location.pathname === `/units/${u}`, { timeout: 60000 }, unitId);
  await waitText('Upload move-out');
});
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/a3-2-unit.png` });
await step('move-out page, upload, land on statement', async () => {
  const href = await page.evaluate(() => [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Upload move-out →'))?.getAttribute('href'));
  if (href !== `/units/${unitId}/moveout`) throw new Error('move-out link points to ' + href);
  await page.goto(`http://localhost:3000${href}`, { waitUntil: 'networkidle0' });
  try { await page.waitForSelector('input[type=file]', { timeout: 15000 }); }
  catch (e) { console.log('AT', page.url(), '\nTEXT', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300)); await page.screenshot({ path: `${out}/a3-fail.png` }); throw e; }
  const [v] = await page.$$('input[type=file]'); await v.uploadFile(video);
  await clickText('Upload move-out');
  await new Promise((r) => setTimeout(r, 1200)); await page.screenshot({ path: `${out}/a3-3-progress.png` });
  await page.waitForFunction((u) => location.pathname === `/units/${u}/statement`, { timeout: 60000 }, unitId);
  await waitText('Send by');
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${out}/a3-4-statement.png`, fullPage: true });
const plan = await (await fetch(`http://localhost:3001/units/${unitId}/plan`)).json();
console.log(`unit ${unitId}: ${plan.rooms.length} rooms [${plan.rooms.map((r) => r.name).join(', ')}], ceiling ${plan.ceilingHeightM} m`);
console.log(errors.length ? `browser errors:\n  ${[...new Set(errors)].join('\n  ')}` : 'no browser errors');
console.log(`screenshots in ${out}`);
await browser.close();
process.exit(errors.length ? 1 : 0);

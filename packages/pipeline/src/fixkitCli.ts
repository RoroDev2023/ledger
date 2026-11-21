// [Rahim] CLI: pnpm --filter @ledger/pipeline fixkit <diff.json> [--plan plan.json] [--frames frames.json]
//   [--unit <id>] [--no-checkout] [--out fixkit.json]
// Defaults follow the run:pair layout: plan.json next to diff.json, frames from walkthroughs/*/frames.json.
// GEMINI_MODE / SHOP_MODE come from the command line first, then .env (both default to mock).
// Prints the live progress feed, the kit table and one checkout link per seller. Never places an order.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { geminiMode, readCallStats, repoRoot } from '@ledger/gemini';
import { shopMode } from '@ledger/shop';
import { DiffItemSchema, FloorPlanSchema, FrameSchema, type Frame } from '@ledger/shared';
import { buildFixKit, describeFixKitEvent } from './fixkit.js';
import { loadDotEnv } from './runPair.js';

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-checkout') flags['no-checkout'] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? '';
    else pos.push(a);
  }
  return { pos, flags };
}

const DiffFileSchema = z.union([z.array(DiffItemSchema), z.object({ items: z.array(DiffItemSchema) }).transform((x) => x.items)]);

function readFrames(path: string): Frame[] {
  return z.array(FrameSchema).parse(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<number> {
  loadDotEnv(join(repoRoot(), '.env'));
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (pos.length !== 1) {
    console.error('usage: fixkit <diff.json> [--plan plan.json] [--frames frames.json] [--unit <id>] [--no-checkout] [--out fixkit.json]');
    return 1;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const diffPath = resolve(cwd, pos[0]!);
  const dir = dirname(diffPath);
  const planPath = typeof flags.plan === 'string' ? resolve(cwd, flags.plan) : join(dir, 'plan.json');
  if (!existsSync(planPath)) {
    console.error(`plan not found: ${planPath} (pass --plan)`);
    return 1;
  }
  const diff = DiffFileSchema.parse(JSON.parse(readFileSync(diffPath, 'utf8')));
  const plan = FloorPlanSchema.parse(JSON.parse(readFileSync(planPath, 'utf8')));

  let frames: Frame[] = [];
  if (typeof flags.frames === 'string') frames = readFrames(resolve(cwd, flags.frames));
  else if (existsSync(join(dir, 'walkthroughs'))) {
    for (const w of readdirSync(join(dir, 'walkthroughs'))) {
      const f = join(dir, 'walkthroughs', w, 'frames.json');
      if (existsSync(f)) frames.push(...readFrames(f));
    }
  }

  const checkout = flags['no-checkout'] !== true;
  const started = Date.now();
  console.log(`fixkit GEMINI_MODE=${geminiMode()} SHOP_MODE=${shopMode()} · ${diff.length} diff item(s) · ${frames.length} frame(s) · checkout ${checkout ? 'on' : 'off'}`);
  const kit = await buildFixKit(diff, plan, frames, {
    unitId: typeof flags.unit === 'string' ? flags.unit : plan.unitId,
    checkout,
    onEvent: (e) => console.log(`  [${e.done}/${e.total}] ${describeFixKitEvent(e)}`),
  });

  console.log('');
  console.table(
    kit.items.map((i) => ({
      surface: i.forDiffItem.surfaceId,
      need: i.needLabel,
      qty: i.quantity,
      product: i.product.title.length > 48 ? `${i.product.title.slice(0, 45)}…` : i.product.title,
      seller: i.seller.name,
      price: `$${i.price.toFixed(2)}`,
      line: `$${i.lineTotal.toFixed(2)}`,
      conf: `${Math.round(i.confidence * 100)}%${i.needsChoice ? ' (choose)' : ''}`,
    })),
  );
  for (const i of kit.items.filter((x) => x.needsChoice)) {
    for (const a of i.alternatives) console.log(`  alternative for ${i.needLabel}: ${a.product.title} · $${a.price.toFixed(2)} · ${a.seller.name} · ${a.url}`);
  }
  for (const m of kit.missing) console.log(`  missing: ${m.needLabel} for ${m.surfaceId} (${m.reason})`);
  for (const u of kit.uncovered) console.log(`  no DIY rule: ${u.surfaceId} ${u.issueType ?? ''} (${u.reason})`);
  for (const w of kit.warnings) console.warn(`  warning: ${w}`);

  console.log('');
  console.log(`Fix it yourself: $${kit.diyTotal.toFixed(2)} vs $${kit.deductionTotal.toFixed(2)} deduction → ${kit.savings >= 0 ? 'saves' : 'costs'} $${Math.abs(kit.savings).toFixed(2)}${kit.complete ? '' : ' (partial kit)'}`);
  for (const c of kit.checkouts) {
    console.log(`  ${c.seller} (${c.shop}) · $${c.subtotal.toFixed(2)} before tax/shipping · ${c.status ?? 'failed'}`);
    if (c.continue_url) console.log(`    ${c.continue_url}`);
    if (c.error) console.log(`    error: ${c.error}`);
    for (const m of c.messages) console.log(`    note: ${m}`);
  }
  const out = typeof flags.out === 'string' ? resolve(cwd, flags.out) : join(dir, 'fixkit.json');
  writeFileSync(out, `${JSON.stringify(kit, null, 2)}\n`);
  const shopStats = readCallStats({ tagPrefix: 'shop.', since: started });
  const dec = readCallStats({ decisions: true, since: started });
  console.log(`Shop MCP: ${shopStats.calls} calls (${shopStats.errors} errors) · Decisions: ${dec.calls} calls, ${dec.questions} questions · wrote ${out}`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? (e.stack ?? e.message) : e);
      process.exit(1);
    },
  );
}

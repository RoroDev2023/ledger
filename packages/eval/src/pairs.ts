// pnpm --filter @ledger/eval pairs [pairId...] [--jobs 2] [--force] [--no-baseline] [--timeout-min 20]
// Runs every filmed pair in data/pairs/<pairId>/ (baseline.mp4 + moveout.mp4 + a plan: room.json scan,
// plan.json, or plan.txt with a fixture name) through LEDGER (pipeline run:pair) and the Neon baseline,
// so `pnpm eval` has both sides. Skips work already done unless --force. Times go to .data/eval/pairs-log.jsonl.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pairPlan } from './plan-source.js';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = join(root, process.env.DATA_DIR ?? '.data');
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: number) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) || d : d);
const jobs = opt('--jobs', 2);
const timeoutMs = opt('--timeout-min', 20) * 60_000;
const named = args.filter((a, i) => !a.startsWith('--') && !['--jobs', '--timeout-min'].includes(args[i - 1] ?? ''));

const pairsDir = join(root, 'data', 'pairs');
const all = existsSync(pairsDir) ? readdirSync(pairsDir).filter((d) => existsSync(join(pairsDir, d, 'baseline.mp4')) && existsSync(join(pairsDir, d, 'moveout.mp4'))) : [];
const todo = named.length ? named : all;
if (!todo.length) {
  console.log('No pairs: film data/pairs/<pairId>/{baseline,moveout}.mp4 and add room.json (scan), plan.json or plan.txt.');
  process.exit(0);
}

function run(cmd: string[], label: string): Promise<{ code: number; ms: number; tail: string }> {
  const t = Date.now();
  return new Promise((res) => {
    const p = spawn('pnpm', cmd, { cwd: root, env: { ...process.env, INIT_CWD: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (b: Buffer) => { tail = (tail + b.toString()).slice(-4000); };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    const timer = setTimeout(() => { tail += `\n[pairs] ${label} timed out after ${timeoutMs / 60_000} min`; p.kill('SIGTERM'); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); res({ code: code ?? 1, ms: Date.now() - t, tail }); });
  });
}

mkdirSync(join(dataDir, 'eval'), { recursive: true });
const logPath = join(dataDir, 'eval', 'pairs-log.jsonl');

async function one(id: string): Promise<string> {
  const dir = join(pairsDir, id);
  const missing = ['baseline.mp4', 'moveout.mp4'].filter((f) => !existsSync(join(dir, f)));
  if (missing.length) return `${id}: SKIP, missing ${missing.join(' and ')}`;
  const plan = pairPlan(dir, id);
  if (!plan) return `${id}: SKIP, no plan (add room.json, plan.json or plan.txt)`;
  const planPath = join(dir, 'plan.json');
  if (!existsSync(planPath)) writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const out: string[] = [];
  if (flag('--force') || !existsSync(join(dataDir, 'units', id, 'diff.json'))) {
    const r = await run(['--filter', '@ledger/pipeline', 'run:pair', planPath, join(dir, 'baseline.mp4'), join(dir, 'moveout.mp4'), '--unit', id], `${id} LEDGER`);
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), pairId: id, system: 'ledger', ok: r.code === 0, ms: r.ms })}\n`);
    out.push(`LEDGER ${r.code === 0 ? 'ok' : 'FAILED'} ${(r.ms / 1000).toFixed(0)} s`);
    if (r.code !== 0) console.error(`--- ${id} LEDGER output (tail)\n${r.tail}`);
  } else out.push('LEDGER cached');
  if (!flag('--no-baseline')) {
    if (flag('--force') || !existsSync(join(dataDir, 'eval', 'baseline', `${id}.json`))) {
      const r = await run(['--filter', '@ledger/eval', 'baseline', id], `${id} baseline`);
      appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), pairId: id, system: 'neon', ok: r.code === 0, ms: r.ms })}\n`);
      out.push(`Neon ${r.code === 0 ? 'ok' : 'FAILED'} ${(r.ms / 1000).toFixed(0)} s`);
      if (r.code !== 0) console.error(`--- ${id} baseline output (tail)\n${r.tail}`);
    } else out.push('Neon cached');
  }
  return `${id}: ${out.join(' · ')}`;
}

const queue = [...todo];
const results: string[] = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  for (let id = queue.shift(); id; id = queue.shift()) {
    const line = await one(id);
    results.push(line);
    console.log(line);
  }
}));
const labelled = todo.filter((id) => existsSync(join(root, 'data', 'labels', `${id}.json`)));
console.log(`\n${results.length} pairs done. ${labelled.length}/${todo.length} have a card in data/labels/. Next: pnpm eval --split test`);

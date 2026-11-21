// [Rahim] CLI: pnpm --filter @ledger/pipeline localize <plan.json> <video> [--unit id] [--wid id] [--seconds n]
// Frames -> Hydrogen captions -> R3 localization. Prints per-frame surface + confidence and the coverage table,
// writes .data/units/<unitId>/walkthroughs/<wid>/localization.json. Reads .env, then .env.example.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { dataDir, geminiMode, readCallStats, repoRoot } from '@ledger/gemini';
import { FloorPlanSchema } from '@ledger/shared';
import { extractFrames } from './frames.js';
import { captionFrames } from './landmarks.js';
import { localizeWalkthrough } from './localize.js';

const root = repoRoot();
for (const f of ['.env', '.env.example']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? '';
    else pos.push(a);
  }
  return { pos, flags };
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('usage: pnpm --filter @ledger/pipeline localize <plan.json> <video> [--unit id] [--wid id] [--seconds n]');
    process.exit(2);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const planPath = resolve(cwd, pos[0]!);
  let video = resolve(cwd, pos[1]!);
  const plan = FloorPlanSchema.parse(JSON.parse(await readFile(planPath, 'utf8')));
  const unitId = flags.unit || plan.unitId;
  const wid = flags.wid || `cli-${basename(video, extname(video)).replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const workDir = join(dataDir(), 'units', unitId, 'walkthroughs', wid);
  await mkdir(workDir, { recursive: true });

  if (flags.seconds) {
    const trimmed = join(workDir, 'video-trim.mp4');
    await promisify(execFile)(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-v', 'error', '-i', video, '-t', flags.seconds, '-c', 'copy', trimmed]);
    video = trimmed;
  }

  const sibling = planPath.replace(/\.json$/i, '.svg');
  const planSvgPath = flags.svg ? resolve(cwd, flags.svg) : existsSync(sibling) ? sibling : undefined;
  const since = Date.now();
  console.log(`GEMINI_MODE=${geminiMode()} · plan ${basename(planPath)} · video ${basename(video)} · plan image ${planSvgPath ? basename(planSvgPath) : 'none (text fallback)'}`);

  const frames = await extractFrames(video, wid, { workDir });
  console.log(`${frames.length} keyframes`);
  const captions = await captionFrames(frames);
  const progress = (stage: string, done: number, total: number) => {
    if (done === total || done % 10 === 0) process.stderr.write(`  ${stage} ${done}/${total}\n`);
  };
  const outPath = join(workDir, 'localization.json');
  const res = await localizeWalkthrough(plan, frames, { captions, planSvgPath, outPath, onProgress: progress });

  const hints = new Map(captions.map((c) => [c.frameId, c.landmarks]));
  console.log('\nPer frame');
  console.log(`${pad('t (s)', 7)}${pad('room', 14)}${pad('surface', 24)}${pad('conf', 6)}${pad('by', 8)}${pad('raw surface', 24)}hints`);
  for (const r of res.trace) {
    console.log(
      `${pad((r.tMs / 1000).toFixed(1), 7)}${pad(r.roomId + (r.rawRoom !== r.roomId ? '*' : ''), 14)}${pad(r.surfaceId, 24)}${pad(r.confidence.toFixed(2), 6)}${pad(r.decidedBy, 8)}${pad(r.rawSurfaceId, 24)}${(hints.get(r.frameId) ?? []).join(',')}`,
    );
  }
  console.log('(* = room smoothed away from the raw per-frame answer)');

  console.log('\nCoverage (frames with P(visible) > 0.7)');
  for (const s of plan.surfaces) {
    const c = res.coverage[s.id]!;
    console.log(`${pad(s.id, 26)}${pad(c.frames, 5)}${c.notVisible ? 'NOT VISIBLE' : 'covered'}`);
  }

  if (res.carbon.length) {
    console.log('\nCarbon second looks');
    for (const c of res.carbon) {
      console.log(`${pad(c.frameId, 26)}${pad(c.hmmSurfaceId, 22)}-> ${pad(c.surfaceId, 22)}${c.error ? `ERROR ${c.error}` : c.reason}`);
    }
  }

  const d = readCallStats({ decisions: true, since, tagPrefix: 'localize.' });
  const all = readCallStats({ since });
  console.log(
    `\nDecisions: ${d.calls} requests, ${d.questions} questions, avg ${d.avgLatencyMs} ms (live ${d.bySource.live}, cache ${d.bySource.cache}, replay ${d.bySource.replay}, mock ${d.bySource.mock}) · all model calls: ${all.calls}, errors ${all.errors}`,
  );
  console.log(`wrote ${outPath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});

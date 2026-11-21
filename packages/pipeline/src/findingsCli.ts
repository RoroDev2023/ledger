// [Rahim] CLI: pnpm --filter @ledger/pipeline findings <plan.json> <localization.json> [--frames frames.json] [--out findings.json]
// R4 on an R3 localization: prints the per-surface checklist table and the findings, writes findings.json
// (Finding[], API storage layout) and findings.trace.json next to the localization file. Reads .env, then .env.example.
//
// localization.json: R3's LocalizeResult ({ localizations, coverage, ... }) or a bare Localization[]
// (coverage is then recomputed: P(visible) > 0.7 on ≥ 2 frames). Frames come from --frames (Frame[] JSON),
// else from <dir of localization.json>/frames/NNNNN.jpg for each "<wid>.fNNNNN" ID, sharpness recomputed.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { geminiMode, readCallStats, repoRoot } from '@ledger/gemini';
import { FloorPlanSchema, FrameSchema, LocalizationSchema, type Frame, type Localization } from '@ledger/shared';
import { CHECKLIST_ISSUES, detectFindings, type FindingsCoverage } from './findings.js';
import { FRAME_FPS, frameSharpness } from './frames.js';

const root = repoRoot();
for (const f of ['.env', '.env.example']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));

/** R3 coverage rule, for a bare Localization[] input. */
const VISIBLE_ABOVE = 0.7;
const MIN_COVERAGE = 2;

const CoverageSchema = z.record(z.string(), z.object({ frames: z.number(), frameIds: z.array(z.string()), notVisible: z.boolean() }));
const LocalizationFileSchema = z.union([
  z.array(LocalizationSchema),
  z.object({ localizations: z.array(LocalizationSchema), coverage: CoverageSchema.optional() }).passthrough(),
]);

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

function coverageFrom(surfaceIds: string[], localizations: Localization[]): FindingsCoverage {
  const out: FindingsCoverage = {};
  for (const id of surfaceIds) {
    const frameIds = localizations.filter((l) => (l.visible[id] ?? 0) > VISIBLE_ABOVE).map((l) => l.frameId);
    out[id] = { frames: frameIds.length, frameIds, notVisible: frameIds.length < MIN_COVERAGE };
  }
  return out;
}

async function framesFromDir(dir: string, ids: string[]): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const id of ids) {
    const m = /^(.+)\.f(\d{5})$/.exec(id);
    if (!m) throw new Error(`frame ID "${id}" is not "<walkthroughId>.fNNNNN"; pass --frames frames.json`);
    const path = join(dir, `${m[2]}.jpg`);
    if (!existsSync(path)) throw new Error(`missing frame image ${path}; pass --frames frames.json`);
    const index = Number(m[2]);
    frames.push(
      FrameSchema.parse({ id, walkthroughId: m[1], tMs: Math.round(((index - 1) * 1000) / FRAME_FPS), path, sharpness: await frameSharpness(path), phash: '' }),
    );
  }
  return frames;
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('usage: pnpm --filter @ledger/pipeline findings <plan.json> <localization.json> [--frames frames.json] [--out findings.json]');
    process.exit(2);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const planPath = resolve(cwd, pos[0]!);
  const locPath = resolve(cwd, pos[1]!);
  const plan = FloorPlanSchema.parse(JSON.parse(await readFile(planPath, 'utf8')));
  const locFile = LocalizationFileSchema.parse(JSON.parse(await readFile(locPath, 'utf8')));
  const localizations = Array.isArray(locFile) ? locFile : locFile.localizations;
  const coverage = (!Array.isArray(locFile) && locFile.coverage) || coverageFrom(plan.surfaces.map((s) => s.id), localizations);

  // Only frames some covered surface could use need to be on disk.
  const needed = [...new Set(Object.values(coverage).filter((c) => !c.notVisible).flatMap((c) => c.frameIds))];
  const frames = flags.frames
    ? z.array(FrameSchema).parse(JSON.parse(await readFile(resolve(cwd, flags.frames), 'utf8')))
    : await framesFromDir(join(dirname(locPath), 'frames'), needed);

  const since = Date.now();
  console.log(`GEMINI_MODE=${geminiMode()} · plan ${planPath} · ${localizations.length} localized frames · ${frames.length} frames loaded`);
  const res = await detectFindings(plan, frames, { localizations, coverage }, {
    onProgress: (_stage, done, total) => {
      if (total && (done === total || done % 10 === 0)) process.stderr.write(`  findings ${done}/${total}\n`);
    },
  });

  const short: Record<string, string> = { crack: 'crack', stain: 'stain', hole: 'hole', scuff: 'scuff', 'missing-fixture': 'missing' };
  console.log('\nPer surface (noisy-OR P per issue over frames that passed the gate; F = finding, C = Carbon, cap = over Carbon cap)');
  console.log(`${pad('surface', 26)}${pad('frames', 8)}${CHECKLIST_ISSUES.map((i) => pad(short[i]!, 11)).join('')}`);
  for (const s of plan.surfaces) {
    const t = res.surfaces[s.id]!;
    if (t.status === 'not-visible') {
      console.log(`${pad(s.id, 26)}${pad(`${t.accepted.length}/${t.selected.length}`, 8)}NOT VISIBLE (${t.reason})`);
      continue;
    }
    const cells = CHECKLIST_ISSUES.map((i) => {
      const x = t.issues[i]!;
      const tag = { finding: 'F', none: '', carbon: 'C', 'carbon-absent': 'C-', 'carbon-cap': 'cap', 'carbon-error': 'C!', 'carbon-duplicate': 'C=' }[x.outcome];
      return pad(`${x.p.toFixed(2)} ${tag}`, 11);
    });
    console.log(`${pad(s.id, 26)}${pad(`${t.accepted.length}/${t.selected.length}`, 8)}${cells.join('')}`);
  }

  console.log(`\nFindings (${res.findings.length})`);
  for (const f of res.findings) {
    console.log(
      `${pad(f.surfaceId, 26)}${pad(f.type, 17)}sev ${f.severity}  conf ${f.confidence.toFixed(2)}  ${pad(f.decidedBy, 14)}frames ${f.frameIds.join(', ')}${f.bbox ? `  bbox [${f.bbox.map((v) => v.toFixed(2)).join(', ')}]` : ''}${f.note ? `  "${f.note}"` : ''}`,
    );
  }
  for (const c of res.carbon.filter((x) => x.error)) console.log(`Carbon error on ${c.surfaceId} ${c.issueType}: ${c.error}`);

  const d = readCallStats({ decisions: true, since, tagPrefix: 'findings.' });
  const all = readCallStats({ since, tagPrefix: 'findings.' });
  console.log(
    `\nDecisions: ${d.calls} requests, ${d.questions} questions, avg ${d.avgLatencyMs} ms (live ${d.bySource.live}, cache ${d.bySource.cache}, replay ${d.bySource.replay}, mock ${d.bySource.mock}) · Carbon calls: ${all.calls - d.calls}, errors ${all.errors}`,
  );

  const outPath = flags.out ? resolve(cwd, flags.out) : join(dirname(locPath), 'findings.json');
  const tracePath = outPath.replace(/\.json$/i, '') + '.trace.json';
  await writeFile(outPath, JSON.stringify(res.findings, null, 2));
  await writeFile(tracePath, JSON.stringify({ notVisible: res.notVisible, surfaces: res.surfaces, carbon: res.carbon }, null, 2));
  console.log(`wrote ${outPath}\nwrote ${tracePath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});

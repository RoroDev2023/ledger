// [Rahim] CLI: pnpm --filter @ledger/pipeline run:pair <plan.json> <baseline.mp4> <moveout.mp4>
//   [--unit <id>] [--move-out-date YYYY-MM-DD]
// frames → Hydrogen captions → localize (R3) → findings (R4) → diff + price + statement (R5).
// GEMINI_MODE comes from the command line first, then .env (e.g. `GEMINI_MODE=live pnpm ... run:pair`).
// Writes everything under <DATA_DIR>/units/<unitId>/ (diff.json is what `pnpm eval` reads).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dataDir, geminiMode, readCallStats, repoRoot } from '@ledger/gemini';
import { FloorPlanSchema, type Finding, type FloorPlan, type Frame, type Localization } from '@ledger/shared';
import { diffWalkthroughs, type SurfaceCoverage, type WalkthroughEvidence } from './diff.js';
import { extractFrames } from './frames.js';
import * as pipeline from './index.js';
import { captionFrames, type FrameCaption } from './landmarks.js';
import { buildStatement, isCharged } from './statement.js';

/** Entry points of the parallel branches. Looked up at runtime so this CLI runs before they merge. */
const R3_ENTRY = 'localizeWalkthrough'; // rahim/r3-localize
const R4_ENTRY = 'detectFindings'; // rahim/r4-findings

type LocalizeFn = (
  plan: FloorPlan,
  frames: Frame[],
  opts: { captions?: FrameCaption[]; outPath?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ localizations: Localization[]; coverage: Record<string, SurfaceCoverage> }>;
type FindingsFn = (
  plan: FloorPlan,
  frames: Frame[],
  loc: { localizations: Localization[]; coverage: Record<string, SurfaceCoverage> },
  opts: { walkthroughId?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ findings: Finding[]; notVisible: string[] }>;

/** Load KEY=VALUE lines from .env without overriding variables already set on the command line. */
export function loadDotEnv(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || env[m[1]!] !== undefined) continue;
    let v = m[2]!.trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]!] = v;
  }
}

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

const write = (path: string, data: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

async function main(): Promise<number> {
  loadDotEnv(join(repoRoot(), '.env'));
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (pos.length !== 3) {
    console.error('usage: run:pair <plan.json> <baseline.mp4> <moveout.mp4> [--unit <id>] [--move-out-date YYYY-MM-DD]');
    return 1;
  }
  // pnpm --filter runs scripts inside packages/pipeline; resolve paths against where the user typed them.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const [planPath, baselineVideo, moveOutVideo] = pos.map((p) => resolve(cwd, p)) as [string, string, string];
  const plan0 = FloorPlanSchema.parse(JSON.parse(readFileSync(planPath, 'utf8')));
  const unitId = flags.unit ?? plan0.unitId ?? basename(planPath, '.json');
  const plan: FloorPlan = { ...plan0, unitId };
  const moveOutDate = flags['move-out-date'] ?? new Date().toISOString().slice(0, 10);
  const mode = geminiMode();
  const started = Date.now();
  const unitDir = join(dataDir(), 'units', unitId);
  console.log(`run:pair unit=${unitId} GEMINI_MODE=${mode} → ${unitDir}`);

  const ns = pipeline as unknown as Record<string, unknown>;
  const localize = typeof ns[R3_ENTRY] === 'function' ? (ns[R3_ENTRY] as LocalizeFn) : undefined;
  const detect = typeof ns[R4_ENTRY] === 'function' ? (ns[R4_ENTRY] as FindingsFn) : undefined;

  const walk = async (kind: 'baseline' | 'move-out', video: string) => {
    const wid = `${unitId}-${kind}`;
    const workDir = join(unitDir, 'walkthroughs', wid);
    console.log(`[${kind}] frames…`);
    const frames = await extractFrames(video, wid, { workDir });
    write(join(workDir, 'frames.json'), frames);
    console.log(`[${kind}] ${frames.length} keyframes; Hydrogen captions…`);
    const captions = await captionFrames(frames);
    write(join(workDir, 'captions.json'), captions);
    return { wid, workDir, frames, captions };
  };
  const base = await walk('baseline', baselineVideo);
  const out = await walk('move-out', moveOutVideo);

  if (!localize || !detect) {
    const missing = [!localize && `R3 (${R3_ENTRY}, branch rahim/r3-localize)`, !detect && `R4 (${R4_ENTRY}, branch rahim/r4-findings)`].filter(Boolean);
    console.error(`\nR3/R4 not merged: @ledger/pipeline has no ${missing.join(' or ')} on this branch yet.`);
    console.error(`Frames and captions were saved under ${join(unitDir, 'walkthroughs')}. Diff skipped (it needs localization + findings).`);
    return 2;
  }

  const evidence = async (w: typeof base): Promise<WalkthroughEvidence> => {
    console.log(`[${w.wid}] localize…`);
    const loc = await localize(plan, w.frames, { captions: w.captions, outPath: join(w.workDir, 'localization.json') });
    console.log(`[${w.wid}] findings…`);
    const found = await detect(plan, w.frames, loc, { walkthroughId: w.wid });
    write(join(w.workDir, 'findings.json'), found.findings);
    // R4 also drops surfaces whose frames all failed its visibility gate: treat those as not covered.
    const coverage: Record<string, SurfaceCoverage> = {};
    for (const [id, c] of Object.entries(loc.coverage)) coverage[id] = { ...c, notVisible: c.notVisible || found.notVisible.includes(id) };
    return { walkthroughId: w.wid, findings: found.findings, frames: w.frames, coverage, localizations: loc.localizations, captions: w.captions };
  };
  const baseline = await evidence(base);
  const moveOut = await evidence(out);

  console.log('diff…');
  const diff = await diffWalkthroughs({ plan, baseline, moveOut });
  const statement = buildStatement(unitId, moveOutDate, diff.items);
  write(join(unitDir, 'plan.json'), plan);
  write(join(unitDir, 'diff.json'), diff.items);
  write(join(unitDir, 'diff-evidence.json'), { evidence: diff.evidence, warnings: diff.warnings });
  write(join(unitDir, 'statement.json'), statement);

  const rows = diff.items
    .filter((d) => d.verdict !== 'no-change')
    .map((d) => {
      const ev = diff.evidence.find((e) => e.surfaceId === d.surfaceId && e.issueType === d.issueType);
      return {
        surface: d.surfaceId,
        verdict: d.verdict,
        issue: d.issueType ?? '',
        pairs: ev ? `${ev.supportingPairs}/2` : '',
        cost: isCharged(d) ? `$${(d.costUsd ?? 0).toFixed(2)}` : '$0.00',
        reason: d.reason.length > 90 ? `${d.reason.slice(0, 87)}…` : d.reason,
      };
    });
  console.log('');
  console.table(rows);
  const noChange = diff.items.length - rows.length;
  if (noChange) console.log(`(${noChange} surface(s) with no change not shown)`);
  for (const w of diff.warnings) console.warn(`warning: ${w}`);
  console.log(`Total: $${statement.totalUsd.toFixed(2)} · due by ${statement.dueBy}`);
  const s = readCallStats({ decisions: true, since: started });
  const live = s.bySource.live ?? 0;
  console.log(`Decisions: ${s.calls} calls (${live} live, ${s.calls - live} cache/replay/mock), ${s.questions} questions, avg ${s.avgLatencyMs} ms`);
  console.log(`Wrote ${join(unitDir, 'diff.json')}, diff-evidence.json, statement.json`);
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

// [Alex] The real pipeline behind the API (Rahim's R2–R5), step for step like `run:pair`:
//   video -> keyframes (ffmpeg) -> Hydrogen captions -> which room/wall (R3) -> damage findings (R4)
//   baseline + move-out evidence -> before/after diff with the two-pair proof rule + pricing (R5).
// Each walkthrough's full evidence (frames, coverage, localizations, captions) is saved to evidence.json in its
// folder, because the diff needs more than the findings. PIPELINE=real turns it on (server.ts).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readCallStats } from '@ledger/gemini';
import { captionFrames, detectFindings, diffWalkthroughs, extractFrames, localizeWalkthrough, type SurfaceCoverage, type WalkthroughEvidence } from '@ledger/pipeline';
import type { PipelineAdapter, RunHooks } from './pipeline.js';

/**
 * Speed. Carbon second opinions take ~60 s each (measured live on the conference-room video) while a Decisions
 * call takes ~4 s, so Carbon was ~90% of the wait. Fast (the default for the app) caps it: at most 6 when placing
 * frames on walls, 3 for damage. A cap of 0 for placing frames was tried and was wrong: on the conference-room
 * move-out almost every frame stuck to one wall, and the damage check then never looked at the right frames.
 * PIPELINE_SPEED=thorough uses Rahim's defaults (12 and 8), as run:pair and the eval do.
 */
export function speedConfig(env: NodeJS.ProcessEnv = process.env) {
  const thorough = env.PIPELINE_SPEED === 'thorough';
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    localize: thorough ? {} : { MAX_CARBON_CALLS: num(env.CARBON_LOCALIZE_MAX, 6) },
    findings: thorough ? {} : { MAX_CARBON_CALLS: num(env.CARBON_FINDINGS_MAX, 3) },
  };
}

/**
 * Which model gives second opinions. Move-in: Argon (MODEL_PLAN), the faster one; the move-in record only needs
 * frames on the right wall and existing damage noted. Move-out: Carbon (MODEL_DEEP), where the comparison and the
 * money are. SECOND_OPINION_MOVE_IN=carbon puts Carbon back on the move-in.
 */
export function secondOpinionEnv(kind: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (kind === 'move-out' || env.SECOND_OPINION_MOVE_IN === 'carbon' || !env.MODEL_PLAN) return env;
  return { ...env, MODEL_DEEP: env.MODEL_PLAN };
}

const writeJson = async (path: string, data: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
};

/** Streams Decisions API stats for the demo panel while a step runs: counted from the step's start, as the API expects. */
function watchDecisions(hooks: RunHooks): () => void {
  const since = Date.now();
  let last = -1;
  const tick = () => {
    const s = readCallStats({ decisions: true, since });
    if (s.calls === last) return;
    last = s.calls;
    hooks.onDecisions({ calls: s.calls, questions: s.questions, lastLatencyMs: s.lastLatencyMs, avgLatencyMs: Math.round(s.avgLatencyMs) });
  };
  const timer = setInterval(tick, 700);
  return () => {
    clearInterval(timer);
    tick();
  };
}

export function realPipeline(base: Pick<PipelineAdapter, 'parsePlan'>): PipelineAdapter {
  return {
    name: 'real',
    parsePlan: base.parsePlan,

    async runWalkthrough({ plan, walkthrough, workDir, ...hooks }) {
      const stop = watchDecisions(hooks);
      try {
        const wid = walkthrough.id;
        const env = secondOpinionEnv(walkthrough.kind);
        const frames = await extractFrames(walkthrough.videoPath, wid, { workDir, onProgress: (d, t) => hooks.onProgress('frames', d, t) });
        await writeJson(join(workDir, 'frames.json'), frames);
        const captions = await captionFrames(frames);
        const loc = await localizeWalkthrough(plan, frames, {
          captions,
          outPath: join(workDir, 'localization.json'),
          planSvgPath: join(workDir, '..', '..', 'plan.svg'),
          config: speedConfig().localize,
          env,
          onProgress: (stage, d, t) => hooks.onProgress(stage, d, t),
        });
        const found = await detectFindings(plan, frames, loc, { walkthroughId: wid, config: speedConfig().findings, env, onProgress: (_s, d, t) => hooks.onProgress('findings', d, t) });
        // R4 also drops surfaces whose frames all failed its visibility gate: those count as not covered.
        const coverage: Record<string, SurfaceCoverage> = {};
        for (const [id, c] of Object.entries(loc.coverage)) coverage[id] = { ...c, notVisible: c.notVisible || found.notVisible.includes(id) };
        const evidence: WalkthroughEvidence = { walkthroughId: wid, findings: found.findings, frames, coverage, localizations: loc.localizations, captions };
        await writeJson(join(workDir, 'evidence.json'), evidence);
        return found.findings;
      } finally {
        stop();
      }
    },

    async runDiff({ plan, dirs, ...hooks }) {
      if (!dirs) throw new Error('real pipeline: runDiff needs the walkthrough folders');
      const load = async (dir?: string) => (dir ? (JSON.parse(await readFile(join(dir, 'evidence.json'), 'utf8')) as WalkthroughEvidence) : undefined);
      const stop = watchDecisions(hooks);
      try {
        const [baseline, addendum, moveOut] = await Promise.all([load(dirs.baseline), load(dirs.addendum), load(dirs.moveOut)]);
        const diff = await diffWalkthroughs({ plan, baseline, addendum, moveOut: moveOut!, onProgress: (_s, d, t) => hooks.onProgress('diff', d, t) });
        // The proof (which before/after pairs, the box on the frame) for the evidence panel.
        await writeJson(join(dirs.moveOut, '..', '..', 'diff-evidence.json'), { evidence: diff.evidence, warnings: diff.warnings });
        return diff.items;
      } finally {
        stop();
      }
    },
  };
}

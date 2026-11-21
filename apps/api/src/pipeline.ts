// [Alex] What the API needs from the pipeline. `mockPipeline` keeps the whole app working
// (GEMINI_MODE=mock / PIPELINE=mock) until Rahim's @ledger/pipeline and Elmir's parsePlan are wired in.
import { listPlanFixtures, loadPlanFixture, type DiffItem, type Finding, type FloorPlan, type Walkthrough } from '@ledger/shared';
import type { DecisionsStat, Stage } from './events.js';

export interface RunHooks {
  onProgress: (stage: Stage, done: number, total: number) => void;
  /** Stats counted from zero for this step (runWalkthrough or runDiff). The API keeps the job-wide total. */
  onDecisions: (stats: DecisionsStat) => void;
}

export interface PipelineAdapter {
  name: string;
  /** Plan image/PDF on disk -> validated FloorPlan. */
  parsePlan(input: { unitId: string; filePath: string; originalName?: string }): Promise<FloorPlan>;
  /** One walkthrough video -> findings pinned to plan surfaces. */
  runWalkthrough(input: { plan: FloorPlan; walkthrough: Walkthrough; workDir: string } & RunHooks): Promise<Finding[]>;
  /** Baseline (+ addendum) findings vs move-out findings -> per-surface verdicts with costs. */
  runDiff(input: { plan: FloorPlan; baseline: Finding[]; moveOut: Finding[] } & RunHooks): Promise<DiffItem[]>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic fake pipeline: plan-agnostic (picks walls by index), so it works with any fixture. */
export function mockPipeline(opts: { stepMs?: number; fixture?: string } = {}): PipelineAdapter {
  const stepMs = opts.stepMs ?? Number(process.env.MOCK_STEP_MS ?? 120);
  const fixture = opts.fixture ?? process.env.MOCK_PLAN ?? 'demo-table';
  const walls = (plan: FloorPlan) => plan.surfaces.filter((s) => s.kind === 'wall');

  async function fakeStages(stages: [Stage, number][], hooks: RunHooks): Promise<void> {
    let calls = 0;
    let questions = 0;
    let latencySum = 0;
    for (const [stage, total] of stages) {
      for (let done = 1; done <= total; done++) {
        await sleep(stepMs);
        hooks.onProgress(stage, done, total);
        if (stage !== 'frames') {
          const latency = 380 + ((done * 97 + calls * 31) % 420);
          calls++;
          questions += stage === 'rooms' ? 3 : stage === 'surfaces' ? 9 : 14;
          latencySum += latency;
          hooks.onDecisions({ calls, questions, lastLatencyMs: latency, avgLatencyMs: Math.round(latencySum / calls) });
        }
      }
    }
  }

  return {
    name: 'mock',
    /** Mock only: a plan file named after a fixture (e.g. studio-l.png) loads that fixture. */
    async parsePlan({ unitId, originalName }) {
      await sleep(stepMs * 3);
      const named = listPlanFixtures().find((n) => originalName?.toLowerCase().startsWith(n));
      return { ...loadPlanFixture(named ?? fixture), unitId };
    },

    async runWalkthrough({ plan, walkthrough, ...hooks }) {
      await fakeStages([['frames', 8], ['rooms', 4], ['surfaces', 6], ['findings', 6]], hooks);
      const w = walls(plan);
      const f = (i: number, surfaceIdx: number, type: Finding['type'], severity: Finding['severity'], confidence: number): Finding | null => {
        const s = w[surfaceIdx % Math.max(w.length, 1)];
        if (!s) return null;
        return {
          id: `${walkthrough.id}-finding-${i}`,
          walkthroughId: walkthrough.id,
          surfaceId: s.id,
          type,
          confidence,
          severity,
          frameIds: [`${walkthrough.id}-f${String(10 + i * 7).padStart(5, '0')}`, `${walkthrough.id}-f${String(12 + i * 7).padStart(5, '0')}`],
          bbox: [0.35, 0.4, 0.55, 0.62],
          decidedBy: confidence < 0.7 ? 'carbon' : 'decisions-api',
          note: 'mock finding',
        };
      };
      const list =
        walkthrough.kind === 'move-out'
          ? [f(0, 0, 'scuff', 2, 0.91), f(1, 2, 'stain', 3, 0.88), f(2, 4, 'hole', 3, 0.62)]
          : [f(0, 0, 'scuff', 2, 0.9)];
      return list.filter((x): x is Finding => x !== null);
    },

    async runDiff({ plan, baseline, moveOut, ...hooks }) {
      await fakeStages([['diff', 5]], hooks);
      const items: DiffItem[] = [];
      const holeWall = walls(plan)[4 % Math.max(walls(plan).length, 1)]?.id;
      for (const m of moveOut) {
        const before = baseline.find((b) => b.surfaceId === m.surfaceId && b.type === m.type);
        const area = plan.surfaces.find((s) => s.id === m.surfaceId)?.areaM2;
        const base = { surfaceId: m.surfaceId, issueType: m.type, afterFrameId: m.frameIds[0], areaM2: area, confidence: m.confidence };
        if (before) {
          items.push({ ...base, verdict: 'pre-existing', beforeFrameId: before.frameIds[0], reason: `Same ${m.type} was there at move-in.` });
        } else if (m.surfaceId === holeWall) {
          items.push({ ...base, verdict: 'not-visible', reason: 'Not provable: only one clear before/after view of this spot. Two are needed.' });
        } else {
          // Mock price only. Real pricing is code in @ledger/pipeline (price.ts + pricing.json).
          const cost = Math.round((area ?? 1) * 12 * 100) / 100;
          items.push({ ...base, verdict: 'new-damage', beforeFrameId: `${baseline[0]?.walkthroughId ?? 'baseline'}-f00024`, costUsd: cost, reason: `New ${m.type}, confirmed in both before/after views. Repaint ${area ?? '?'} m² at $12/m².` });
        }
      }
      const floor = plan.surfaces.find((s) => s.kind === 'floor');
      if (floor) items.push({ surfaceId: floor.id, verdict: 'moved', reason: 'A chair was moved. Furniture is never charged.', confidence: 0.86, costUsd: 0 });
      return items;
    },
  };
}

// [Alex] Entry point: `pnpm --filter @ledger/api dev`. Listens on PORT (default 3001).
// PLAN_PARSER=argon parses uploaded plans with Argon (needs GEMINI_MODE=live|record|replay and the MODEL_* vars);
// otherwise plans come from the mock fixtures.
import './env.js';
import { serve } from '@hono/node-server';
import { gemini } from '@ledger/gemini';
import { createApp } from './app.js';
import { mockPipeline } from './pipeline.js';
import { argonPlanParser } from './planParser.js';
import { realPipeline } from './realPipeline.js';

const port = Number(process.env.PORT ?? 3001);
// PIPELINE=real runs Rahim's pipeline on uploaded videos (needs ffmpeg, FFMPEG_PATH if not on PATH, and a live key).
const mock = mockPipeline();
const plans = process.env.PLAN_PARSER === 'argon' ? { ...mock, name: 'mock+argon-plans', parsePlan: argonPlanParser(gemini) } : mock;
const pipeline = process.env.PIPELINE === 'real' ? { ...realPipeline(plans), name: process.env.PLAN_PARSER === 'argon' ? 'real+argon-plans' : 'real' } : plans;
const { app, deps } = createApp({ pipeline });
serve({ fetch: app.fetch, port }, () => {
  console.log(`LEDGER api on http://localhost:${port} · pipeline=${deps.pipeline.name} · data=${deps.storage.root}`);
});

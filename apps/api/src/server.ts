// [Alex] Entry point: `pnpm --filter @ledger/api dev`. Listens on PORT (default 3001).
// PLAN_PARSER=argon parses uploaded plans with Argon (needs GEMINI_MODE=live|record|replay and the MODEL_* vars);
// otherwise plans come from the mock fixtures.
import './env.js';
import { serve } from '@hono/node-server';
import { gemini } from '@ledger/gemini';
import { createApp } from './app.js';
import { mockPipeline } from './pipeline.js';
import { argonPlanParser } from './planParser.js';

const port = Number(process.env.PORT ?? 3001);
const base = mockPipeline();
const pipeline = process.env.PLAN_PARSER === 'argon' ? { ...base, name: 'mock+argon-plans', parsePlan: argonPlanParser(gemini) } : base;
const { app, deps } = createApp({ pipeline });
serve({ fetch: app.fetch, port }, () => {
  console.log(`LEDGER api on http://localhost:${port} · pipeline=${deps.pipeline.name} · data=${deps.storage.root}`);
});

// [Alex] Entry point: `pnpm --filter @ledger/api dev`. Listens on PORT (default 3001).
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const { app, deps } = createApp();
serve({ fetch: app.fetch, port }, () => {
  console.log(`LEDGER api on http://localhost:${port} · pipeline=${deps.pipeline.name} · data=${deps.storage.root}`);
});

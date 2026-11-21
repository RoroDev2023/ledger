// [Alex] The Hono app. server.ts serves it; tests call app.request() directly.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import type { Deps } from './deps.js';
import { JobRegistry } from './events.js';
import { mockPipeline, type PipelineAdapter } from './pipeline.js';
import { SerialQueue } from './queue.js';
import { TEST_PAGE } from './testPage.js';
import { cartRoutes } from './routes/cart.js';
import { fixkitRoutes } from './routes/fixkit.js';
import { frameRoutes } from './routes/frames.js';
import { jobRoutes } from './routes/jobs.js';
import { resultRoutes } from './routes/results.js';
import { scanRoutes } from './routes/scan.js';
import { unitsRoutes } from './routes/units.js';
import { walkthroughRoutes } from './routes/walkthroughs.js';
import { HttpError, Storage, defaultDataDir } from './storage.js';

export function createApp(opts: { dataDir?: string; pipeline?: PipelineAdapter } = {}) {
  const deps: Deps = {
    storage: new Storage(opts.dataDir ?? defaultDataDir()),
    jobs: new JobRegistry(),
    queue: new SerialQueue(),
    pipeline: opts.pipeline ?? mockPipeline(),
  };

  const app = new Hono();
  app.use('*', cors({ origin: (o) => o ?? '*' }));
  app.get('/', (c) => c.html(TEST_PAGE));
  app.get('/health', (c) => c.json({ ok: true, pipeline: deps.pipeline.name, queued: deps.queue.size }));
  app.route('/units', unitsRoutes(deps));
  app.route('/units', scanRoutes(deps));
  app.route('/units', walkthroughRoutes(deps));
  app.route('/units', resultRoutes(deps));
  app.route('/units', frameRoutes(deps));
  app.route('/units', fixkitRoutes(deps));
  app.route('/units', cartRoutes(deps));
  app.route('/jobs', jobRoutes(deps));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: 'invalid data', issues: err.issues }, 500);
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });
  return { app, deps };
}

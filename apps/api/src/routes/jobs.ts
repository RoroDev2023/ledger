// [Alex] GET /jobs/:id (status + events so far) and GET /jobs/:id/events (SSE: progress, decisions, done, error).
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Deps } from '../deps.js';
import type { JobEvent } from '../events.js';
import { HttpError } from '../storage.js';

export function jobRoutes(d: Deps) {
  const r = new Hono();

  r.get('/:id', (c) => {
    const job = d.jobs.get(c.req.param('id'));
    if (!job) throw new HttpError(404, 'job not found');
    return c.json(job);
  });

  r.get('/:id/events', (c) => {
    const id = c.req.param('id');
    if (!d.jobs.get(id)) throw new HttpError(404, 'job not found');
    return streamSSE(c, async (stream) => {
      const queue: JobEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = d.jobs.subscribe(id, (e) => {
        queue.push(e);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      let n = 0;
      try {
        while (!closed) {
          const e = queue.shift();
          if (!e) {
            await new Promise<void>((res) => {
              wake = res;
              setTimeout(res, 15_000); // heartbeat interval
            });
            wake = null;
            if (queue.length === 0 && !closed) await stream.writeSSE({ event: 'ping', data: '' });
            continue;
          }
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e), id: String(n++) });
          if (e.type === 'done' || e.type === 'error') break;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return r;
}

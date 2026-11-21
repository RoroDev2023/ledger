// [Alex] Everything the routes share. Built once in app.ts; tests build their own.
import type { JobRegistry } from './events.js';
import type { PipelineAdapter } from './pipeline.js';
import type { SerialQueue } from './queue.js';
import type { Storage } from './storage.js';

export interface Deps {
  storage: Storage;
  jobs: JobRegistry;
  queue: SerialQueue;
  pipeline: PipelineAdapter;
}

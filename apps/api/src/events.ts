// [Alex] Job registry + per-job event log, streamed to the web app over SSE.
// Late subscribers get every past event first, so a page reload never misses progress.

export type Stage = 'frames' | 'rooms' | 'surfaces' | 'findings' | 'diff';

/** Live Decisions API stats for the demo screen (from Rahim's calls.jsonl rows). */
export interface DecisionsStat {
  calls: number;
  questions: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
}

export type JobEvent =
  | { type: 'progress'; stage: Stage; done: number; total: number }
  | { type: 'decisions'; stats: DecisionsStat }
  | { type: 'done'; result: { walkthroughId: string; findings: number; diffItems?: number } }
  | { type: 'error'; message: string };

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  unitId: string;
  walkthroughId: string;
  status: JobStatus;
  createdAt: string;
  events: JobEvent[];
}

type Listener = (e: JobEvent) => void;

export class JobRegistry {
  private jobs = new Map<string, Job>();
  private listeners = new Map<string, Set<Listener>>();

  create(id: string, unitId: string, walkthroughId: string): Job {
    const job: Job = { id, unitId, walkthroughId, status: 'queued', createdAt: new Date().toISOString(), events: [] };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  setStatus(id: string, status: JobStatus): void {
    const job = this.jobs.get(id);
    if (job) job.status = status;
  }

  emit(id: string, e: JobEvent): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(e);
    if (e.type === 'done') job.status = 'done';
    if (e.type === 'error') job.status = 'failed';
    for (const l of this.listeners.get(id) ?? []) l(e);
  }

  /** Replays past events, then calls `l` for new ones. Returns an unsubscribe function. */
  subscribe(id: string, l: Listener): () => void {
    const job = this.jobs.get(id);
    for (const e of job?.events ?? []) l(e);
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(l);
    return () => set.delete(l);
  }
}

// [Alex] Job registry + per-job event log, streamed to the web app over SSE.
// Late subscribers get every past event first, so a page reload never misses progress.
import type { CartEvent } from '@ledger/cart-agent';
import type { FixKitEvent } from '@ledger/pipeline';

export type Stage = 'frames' | 'rooms' | 'surfaces' | 'findings' | 'diff' | 'fixkit' | 'cart';

/** Live Decisions API stats for the demo screen (from Rahim's calls.jsonl rows). */
export interface DecisionsStat {
  calls: number;
  questions: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
}

/**
 * Running Decisions totals for a whole job. Each pipeline step (runWalkthrough, then runDiff) reports
 * stats counted from zero; `begin()` starts a new step so the totals keep growing instead of resetting.
 */
export class DecisionsTotals {
  private done = { calls: 0, questions: 0, latencySum: 0 };
  private step = { calls: 0, questions: 0, latencySum: 0 };

  /** Call before each pipeline step. */
  begin(): void {
    this.done.calls += this.step.calls;
    this.done.questions += this.step.questions;
    this.done.latencySum += this.step.latencySum;
    this.step = { calls: 0, questions: 0, latencySum: 0 };
  }

  /** Takes the current step's own stats, returns job-wide totals. */
  add(s: DecisionsStat): DecisionsStat {
    this.step = { calls: s.calls, questions: s.questions, latencySum: s.avgLatencyMs * s.calls };
    const calls = this.done.calls + s.calls;
    return {
      calls,
      questions: this.done.questions + s.questions,
      lastLatencyMs: s.lastLatencyMs,
      avgLatencyMs: calls ? Math.round((this.done.latencySum + this.step.latencySum) / calls) : 0,
    };
  }
}

export type JobEvent =
  | { type: 'progress'; stage: Stage; done: number; total: number }
  | { type: 'decisions'; stats: DecisionsStat }
  | { type: 'done'; result: { walkthroughId: string; findings: number; diffItems?: number } | { fixkit: FixKitSummary } | { carts: CartSummary[] } }
  /** Fix kit steps (POST /units/:id/fixkit): `event` is @ledger/pipeline's FixKitEvent, `text` a ready-made feed line. */
  | { type: 'fixkit'; event: FixKitEvent; text: string }
  /** Cart agent steps (POST /units/:id/fixkit/cart): `event` is @ledger/cart-agent's CartEvent (screenshot = URL), `text` a feed line. */
  | { type: 'cart'; event: CartEvent; text: string }
  | { type: 'error'; message: string };

/** Totals in the `done` event of a fix kit job; the full kit is at GET /units/:id/fixkit. */
export interface FixKitSummary {
  items: number;
  checkouts: number;
  diyTotal: number;
  deductionTotal: number;
  savings: number;
  complete: boolean;
}

/** One seller's cart after the cart agent ran (POST /units/:id/fixkit/cart). Nothing is ever bought. */
export interface CartSummary {
  seller: string;
  shop: string;
  /** The store's own /cart page (the tab the agent leaves open). */
  cartUrl: string;
  /** Every picked variant is in the cart at the right quantity, read back from /cart.js. */
  verified: boolean;
  itemCount: number;
  /** From the store's /cart.js, before tax and shipping. */
  subtotal: number;
  currency: string;
  lines: { title: string; quantity: number; via?: 'button' | 'cart-api' | 'button+cart-api'; error?: string }[];
  /** URL of the cart screenshot (GET /units/:id/fixkit/cart/shots/<file>). */
  screenshot?: string;
  error?: string;
  /** Shop MCP continue_url to show instead when the browser run failed. Carries an access key: never log it. */
  fallbackUrl?: string;
}

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

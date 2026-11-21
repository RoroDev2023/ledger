// [Alex] Every call from the web app to apps/api goes through here, typed with @ledger/shared (types only, so
// nothing from the server-side package ends up in the browser bundle).
import type { DiffItem, Finding, FloorPlan, Statement, Walkthrough, WalkthroughKind } from '@ledger/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path, { cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
  return (await res.json()) as T;
}

/** Like get(), but a 404 ("not ready yet") becomes null. */
async function maybe<T>(path: string): Promise<T | null> {
  try {
    return await get<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export interface Unit {
  unitId: string;
  createdAt: string;
  planFile: string;
  walkthroughs: Walkthrough[];
}

export type Stage = 'frames' | 'rooms' | 'surfaces' | 'findings' | 'diff';
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

async function send<T>(method: 'POST' | 'PATCH', path: string, body: FormData | object): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(API_URL + path, {
    method,
    body: isForm ? body : JSON.stringify(body),
    headers: isForm ? undefined : { 'content-type': 'application/json' },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText);
  return json as T;
}

/** POST a file with upload progress (fetch can't report upload progress; XHR can). */
function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json: { error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText) as { error?: string };
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as T);
      else reject(new ApiError(xhr.status, json.error ?? (xhr.statusText || 'upload failed')));
    };
    xhr.onerror = () => reject(new ApiError(0, `cannot reach the API at ${API_URL}`));
    xhr.send(form);
  });
}

export const api = {
  unit: (unitId: string) => get<Unit>(`/units/${unitId}`),
  createUnit: (plan: File, unitId?: string) => {
    const f = new FormData();
    f.set('plan', plan);
    if (unitId) f.set('unitId', unitId);
    return send<{ unit: Unit; plan: FloorPlan }>('POST', '/units', f);
  },
  patchPlan: (unitId: string, patch: { ceilingHeightM?: number; roomNames?: Record<string, string> }) => send<FloorPlan>('PATCH', `/units/${unitId}/plan`, patch),
  uploadWalkthrough: (unitId: string, video: File, kind: WalkthroughKind, capturedAt?: string, onProgress?: (f: number) => void) => {
    const f = new FormData();
    f.set('video', video);
    f.set('kind', kind);
    if (capturedAt) f.set('capturedAt', capturedAt);
    return upload<{ jobId: string; walkthroughId: string }>(`/units/${unitId}/walkthroughs`, f, onProgress);
  },
  /** Live job events (SSE). Returns a function that stops listening. */
  followJob: (jobId: string, onEvent: (e: JobEvent) => void): (() => void) => {
    const es = new EventSource(`${API_URL}/jobs/${jobId}/events`);
    for (const type of ['progress', 'decisions', 'done', 'error'] as const) {
      es.addEventListener(type, (m) => {
        const data = (m as MessageEvent<string>).data;
        if (!data) return; // a bare connection error, not our error event
        const e = JSON.parse(data) as JobEvent;
        onEvent(e);
        if (e.type === 'done' || e.type === 'error') es.close();
      });
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) onEvent({ type: 'error', message: 'lost connection to the API' });
    };
    return () => es.close();
  },
  plan: (unitId: string) => get<FloorPlan>(`/units/${unitId}/plan`),
  statement: (unitId: string) => maybe<Statement>(`/units/${unitId}/statement`),
  findings: (unitId: string, kind: 'baseline' | 'move-out') => maybe<{ walkthrough: Walkthrough; findings: Finding[] }>(`/units/${unitId}/findings?kind=${kind}`),
  diff: (unitId: string) => maybe<DiffItem[]>(`/units/${unitId}/diff`),
  frameUrl: (unitId: string, frameId: string) => `${API_URL}/units/${unitId}/frames/${frameId}`,
  statementHtmlUrl: (unitId: string) => `${API_URL}/units/${unitId}/statement.html`,
};

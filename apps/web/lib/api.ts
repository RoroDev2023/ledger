// [Alex] Every call from the web app to apps/api goes through here, typed with @ledger/shared (types only, so
// nothing from the server-side package ends up in the browser bundle).
import type { DiffItem, Finding, FloorPlan, Statement, Walkthrough } from '@ledger/shared';

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

export const api = {
  plan: (unitId: string) => get<FloorPlan>(`/units/${unitId}/plan`),
  statement: (unitId: string) => maybe<Statement>(`/units/${unitId}/statement`),
  findings: (unitId: string, kind: 'baseline' | 'move-out') => maybe<{ walkthrough: Walkthrough; findings: Finding[] }>(`/units/${unitId}/findings?kind=${kind}`),
  diff: (unitId: string) => maybe<DiffItem[]>(`/units/${unitId}/diff`),
  frameUrl: (unitId: string, frameId: string) => `${API_URL}/units/${unitId}/frames/${frameId}`,
  statementHtmlUrl: (unitId: string) => `${API_URL}/units/${unitId}/statement.html`,
};

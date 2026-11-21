// [Rahim] R5: DiffItem[] -> Statement, in code (no model). Same charging rule as apps/api/src/statement/build.ts:
// only provable new damage with a positive cost is charged; everything else is listed at $0.

import { StatementSchema, statementDueBy, type DiffItem, type Statement } from '@ledger/shared';

export const STATEMENT_DISCLAIMER = 'Draft for review, not legal advice. Rates are placeholders until confirmed.';

/** Reason prefix for a suspected change without 2 independent before/after pairs (until the contract has its own verdict). */
export const NOT_PROVABLE_PREFIX = 'Not provable:';

export function isNotProvable(d: DiffItem): boolean {
  return d.reason.trimStart().toLowerCase().startsWith(NOT_PROVABLE_PREFIX.toLowerCase());
}

export function isCharged(d: DiffItem): boolean {
  return d.verdict === 'new-damage' && !isNotProvable(d) && (d.costUsd ?? 0) > 0;
}

/** Build the itemized statement. dueBy = moveOutDate + 14 days (NY GOL 7-108) via the shared helper. */
export function buildStatement(unitId: string, moveOutDate: string, diff: DiffItem[]): Statement {
  const items = diff
    .filter((d) => d.verdict !== 'no-change')
    .map((d) => ({ ...d, costUsd: isCharged(d) ? Math.round((d.costUsd ?? 0) * 100) / 100 : 0 }))
    .sort((a, b) => Number(isCharged(b)) - Number(isCharged(a)) || a.surfaceId.localeCompare(b.surfaceId));
  const cents = items.reduce((sum, d) => sum + Math.round((d.costUsd ?? 0) * 100), 0);
  return StatementSchema.parse({
    unitId,
    moveOutDate: moveOutDate.slice(0, 10),
    dueBy: statementDueBy(moveOutDate),
    items,
    totalUsd: cents / 100,
    disclaimer: STATEMENT_DISCLAIMER,
  });
}

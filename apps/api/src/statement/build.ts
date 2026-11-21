// [Alex] DiffItem[] -> Statement, in code (no model). Only proven new damage is ever charged.
import { StatementSchema, statementDueBy, type DiffItem, type Statement } from '@ledger/shared';

export const DISCLAIMER = 'Draft for review, not legal advice. Rates are placeholders until confirmed.';

/** True when the pipeline marked the item as lacking 2 agreeing before/after pairs. */
export function isNotProvable(d: DiffItem): boolean {
  return d.reason.trimStart().toLowerCase().startsWith('not provable');
}

/** A line is charged only if it is new damage, provable, and has a positive cost. */
export function isCharged(d: DiffItem): boolean {
  return d.verdict === 'new-damage' && !isNotProvable(d) && (d.costUsd ?? 0) > 0;
}

export function buildStatement(unitId: string, moveOutDate: string, diff: DiffItem[]): Statement {
  const items = diff
    .filter((d) => d.verdict !== 'no-change')
    .map((d) => (isCharged(d) ? d : { ...d, costUsd: 0 }))
    .sort((a, b) => Number(isCharged(b)) - Number(isCharged(a)) || a.surfaceId.localeCompare(b.surfaceId));
  const cents = items.reduce((sum, d) => sum + Math.round((d.costUsd ?? 0) * 100), 0);
  return StatementSchema.parse({
    unitId,
    moveOutDate: moveOutDate.slice(0, 10),
    dueBy: statementDueBy(moveOutDate),
    items,
    totalUsd: cents / 100,
    disclaimer: DISCLAIMER,
  });
}

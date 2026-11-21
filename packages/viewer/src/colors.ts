// [Alex] Verdict -> pin color and label. One place, so the 3D view, the panel and the statement agree.
import type { DiffItem } from '@ledger/shared';

export type PinKind = 'new-damage' | 'pre-existing' | 'wear' | 'moved' | 'not-provable' | 'not-visible' | 'no-change';

export const PIN_STYLE: Record<PinKind, { color: string; label: string; charged: boolean }> = {
  'new-damage': { color: '#dc2626', label: 'New damage', charged: true },
  'pre-existing': { color: '#2563eb', label: 'Already there', charged: false },
  wear: { color: '#6b7280', label: 'Normal wear', charged: false },
  moved: { color: '#d97706', label: 'Moved, not charged', charged: false },
  'not-provable': { color: '#7c3aed', label: 'Not provable', charged: false },
  'not-visible': { color: '#9ca3af', label: 'Not visible', charged: false },
  'no-change': { color: '#16a34a', label: 'No change', charged: false },
};

export function isNotProvable(item: Pick<DiffItem, 'reason'>): boolean {
  return item.reason.trimStart().toLowerCase().startsWith('not provable');
}

export function pinKind(item: Pick<DiffItem, 'verdict' | 'reason'>): PinKind {
  if (isNotProvable(item)) return 'not-provable';
  return item.verdict;
}

export const pinStyle = (item: Pick<DiffItem, 'verdict' | 'reason'>) => PIN_STYLE[pinKind(item)];

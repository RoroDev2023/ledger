// [Alex] Shared look: one place for the colors and the few styles every page uses.
import type { CSSProperties } from 'react';

export const C = { ink: '#15130f', muted: '#6b6255', faint: '#8a8173', line: '#e2dccf', card: '#ffffff', bg: '#f6f4ef', red: '#dc2626', green: '#16a34a', blue: '#2563eb' };

export const card: CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 };
export const btn: CSSProperties = { padding: '9px 16px', border: 0, borderRadius: 8, background: C.ink, color: '#fff', font: 'inherit', cursor: 'pointer' };
export const btnGhost: CSSProperties = { ...btn, background: '#fff', color: C.ink, border: `1px solid ${C.line}` };
export const input: CSSProperties = { padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, font: 'inherit', width: '100%' };
export const label: CSSProperties = { display: 'block', fontSize: 13, color: C.muted, margin: '10px 0 4px' };
export const h1: CSSProperties = { fontSize: 26, margin: '0 0 4px' };
export const page: CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '28px 24px 60px' };

export const usd = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`;
export const area = (poly: [number, number][]) => Math.abs(poly.reduce((s, [x, y], i) => s + x * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * y, 0)) / 2;

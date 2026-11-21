// [Alex] Statement as a standalone HTML page (GET /units/:id/statement.html). PDF export is cut.
import type { Statement } from '@ledger/shared';
import { isCharged, isNotProvable } from './build.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (n: number) => `$${n.toFixed(2)}`;

export function renderStatementHtml(s: Statement): string {
  const rows = s.items
    .map((d) => {
      const label = isNotProvable(d) ? 'not provable' : d.verdict;
      return `<tr class="${isCharged(d) ? 'charged' : 'free'}"><td>${esc(d.surfaceId)}</td><td>${esc(label)}</td><td>${esc(d.issueType ?? '')}</td><td>${d.areaM2 ?? ''}</td><td>${esc(d.reason)}</td><td class="num">${usd(d.costUsd ?? 0)}</td></tr>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Deposit statement ${esc(s.unitId)}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 16px;color:#111}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
.num{text-align:right;white-space:nowrap}.free{color:#666}.total td{font-weight:700;border-top:2px solid #111}.note{color:#666;font-size:13px}</style></head>
<body><h1>Itemized deposit statement (draft)</h1>
<p>Unit <b>${esc(s.unitId)}</b> · Move-out ${esc(s.moveOutDate)} · <b>Send by ${esc(s.dueBy)}</b> (14 days, NY GOL 7-108)</p>
<table><thead><tr><th>Surface</th><th>Verdict</th><th>Issue</th><th>m²</th><th>Evidence</th><th class="num">Charge</th></tr></thead>
<tbody>${rows}<tr class="total"><td colspan="5">Total</td><td class="num">${usd(s.totalUsd)}</td></tr></tbody></table>
<p class="note">${esc(s.disclaimer)}</p></body></html>
`;
}

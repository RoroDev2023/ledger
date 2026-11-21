// [Alex] The itemized draft deposit statement: due date, total, then every line with its verdict, reason, cost
// and the before/after evidence. Charged lines first; $0 lines stay visible so the tenant sees what wasn't charged.
'use client';
import type { Finding, FloorPlan, Statement } from '@ledger/shared';
import { pinStyle } from '@ledger/viewer/colors';
import { api } from '../lib/api';
import { C, card, usd } from '../lib/ui';
import { Frame } from './EvidencePanel';

export function StatementView({ statement, plan, findings }: { statement: Statement; plan: FloorPlan; findings: Finding[] }) {
  const label = (id: string) => plan.surfaces.find((s) => s.id === id)?.label ?? id;
  const charged = statement.items.filter((i) => pinStyle(i).charged);
  const free = statement.items.filter((i) => !pinStyle(i).charged);
  return (
    <div>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          ['Move-out', statement.moveOutDate],
          ['Send by', statement.dueBy],
          ['Charged lines', String(charged.length)],
          ['Total', usd(statement.totalUsd)],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div>
            <div style={{ fontSize: k === 'Total' ? 28 : 20, fontWeight: 700, color: k === 'Total' && statement.totalUsd > 0 ? C.red : C.ink }}>{v}</div>
          </div>
        ))}
      </div>
      <p style={{ color: C.muted, fontSize: 13 }}>
        New York: the landlord must send an itemized statement within 14 days of move-out (GOL § 7-108). {statement.disclaimer}
      </p>
      {[
        ['Charged', charged],
        ['Not charged', free],
      ].map(([title, lines]) =>
        (lines as Statement['items']).length ? (
          <section key={title as string} style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{title as string}</h2>
            {(lines as Statement['items']).map((d, i) => {
              const s = pinStyle(d);
              const bbox = findings.find((f) => f.surfaceId === d.surfaceId && (!d.issueType || f.type === d.issueType))?.bbox;
              return (
                <div key={i} style={{ ...card, borderLeft: `4px solid ${s.color}`, marginBottom: 10, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ font: '600 12px system-ui', color: s.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {s.label}
                        {d.issueType ? ` · ${d.issueType}` : ''}
                      </span>
                      <b style={{ fontSize: 18, color: s.charged ? C.red : C.faint }}>{usd(d.costUsd)}</b>
                    </div>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{label(d.surfaceId)}</div>
                    <div style={{ color: '#4a443b', marginTop: 4, fontSize: 14 }}>{d.reason}</div>
                    <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>
                      confidence {Math.round(d.confidence * 100)}%{d.areaM2 ? ` · ${d.areaM2} m²` : ''}
                      {' · '}
                      <a href={`/units/${statement.unitId}?select=${encodeURIComponent(d.surfaceId)}`}>show in 3D</a>
                    </div>
                  </div>
                  {(d.beforeFrameId || d.afterFrameId) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <Frame title="Move-in" src={d.beforeFrameId ? api.frameUrl(statement.unitId, d.beforeFrameId) : null} />
                      <Frame title="Move-out" src={d.afterFrameId ? api.frameUrl(statement.unitId, d.afterFrameId) : null} bbox={bbox} color={s.color} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ) : null,
      )}
    </div>
  );
}

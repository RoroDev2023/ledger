// [Alex] The itemized draft deposit statement: due date, total, then every line with its verdict, reason, cost
// and the before/after evidence. Charged lines first; $0 lines stay visible so the tenant sees what wasn't charged.
'use client';
import { motion } from 'motion/react';
import type { Finding, FloorPlan, Statement } from '@ledger/shared';
import { displayReason, pinStyle } from '@ledger/viewer/colors';
import { api } from '../lib/api';
import { usd } from '../lib/ui';
import { Frame } from './EvidencePanel';
import { CountUp, EASE, Reveal } from './motion';

export function StatementView({ statement, plan, findings }: { statement: Statement; plan: FloorPlan; findings: Finding[] }) {
  const label = (id: string) => plan.surfaces.find((s) => s.id === id)?.label ?? id;
  const charged = statement.items.filter((i) => pinStyle(i).charged);
  const free = statement.items.filter((i) => !pinStyle(i).charged);
  const days = Math.round((Date.parse(statement.dueBy) - Date.now()) / 864e5);
  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }} className="card" style={{ padding: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr' }}>
        <div style={{ padding: '26px 28px', background: 'var(--ink)', color: 'var(--paper)' }}>
          <div className="eyebrow" style={{ color: '#b9ad99' }}>
            Total
          </div>
          <div className="display" style={{ fontSize: 64, marginTop: 6, color: statement.totalUsd > 0 ? '#ff8a73' : 'var(--paper)' }}>
            $<CountUp value={statement.totalUsd} format={(n) => n.toFixed(2)} duration={1.8} />
          </div>
        </div>
        {[
          ['Send by', statement.dueBy, days >= 0 ? `${days} day${days === 1 ? '' : 's'} left` : `${-days} days overdue`],
          ['Move-out', statement.moveOutDate, 'NY GOL § 7-108'],
          ['Items', `${charged.length} charged`, `${free.length} at $0`],
        ].map(([k, v, sub], i) => (
          <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + i * 0.1 }} style={{ padding: '26px 24px', borderLeft: i ? '1px solid var(--line)' : undefined }}>
            <div className="eyebrow">{k}</div>
            <div className="display" style={{ fontSize: 30, marginTop: 8 }}>
              {v}
            </div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
              {sub}
            </div>
          </motion.div>
        ))}
      </motion.div>
      <p className="faint" style={{ fontSize: 13, margin: '14px 2px 0' }}>
        {statement.disclaimer}
      </p>
      {(
        [
          ['Charged', charged],
          ['Not charged', free],
        ] as const
      ).map(([title, lines]) =>
        lines.length ? (
          <section key={title} style={{ marginTop: 34 }}>
            <Reveal>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
                <h2 className="h2" style={{ fontSize: 30 }}>
                  {title}
                </h2>
                <span className="faint">{lines.length}</span>
              </div>
            </Reveal>
            {lines.map((d, i) => {
              const s = pinStyle(d);
              const bbox = findings.find((f) => f.surfaceId === d.surfaceId && (!d.issueType || f.type === d.issueType))?.bbox;
              return (
                <Reveal key={i} delay={i * 0.06}>
                  <div className="card" style={{ padding: 20, marginBottom: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 22, position: 'relative', overflow: 'hidden' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: s.color }} />
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ font: '600 11px var(--sans)', color: s.color, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          {s.label}
                          {d.issueType ? ` · ${d.issueType}` : ''}
                        </span>
                        <b className="display" style={{ fontSize: 30, color: s.charged ? 'var(--red)' : 'var(--faint)' }}>
                          {usd(d.costUsd)}
                        </b>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 17, marginTop: 4 }}>{label(d.surfaceId)}</div>
                      <div style={{ color: 'var(--ink-2)', marginTop: 6 }}>{displayReason(d)}</div>
                      <div className="faint mono" style={{ fontSize: 12, marginTop: 10 }}>
                        confidence {Math.round(d.confidence * 100)}%{d.areaM2 ? ` · ${d.areaM2} m²` : ''} ·{' '}
                        <a href={`/units/${statement.unitId}?select=${encodeURIComponent(d.surfaceId)}`}>View in 3D →</a>
                      </div>
                    </div>
                    {(d.beforeFrameId || d.afterFrameId) && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Frame title="Move-in" src={d.beforeFrameId ? api.frameUrl(statement.unitId, d.beforeFrameId) : null} />
                        <Frame title="Move-out" src={d.afterFrameId ? api.frameUrl(statement.unitId, d.afterFrameId) : null} bbox={bbox} color={s.color} />
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </section>
        ) : null,
      )}
    </div>
  );
}

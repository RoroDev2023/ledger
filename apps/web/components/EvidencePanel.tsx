// [Alex] Right-hand panel: with nothing selected, every line (click to select); with a surface selected, its
// lines with verdict, reason, cost and before/after frames (damage box drawn on the after frame).
'use client';
import { AnimatePresence, motion } from 'motion/react';
import type { DiffItem, Finding } from '@ledger/shared';
import { displayReason, pinStyle } from '@ledger/viewer/colors';
import { api } from '../lib/api';
import { usd } from '../lib/ui';
import { EASE } from './motion';

export interface EvidencePanelProps {
  unitId: string;
  items: DiffItem[];
  /** Move-out findings, used to find the damage box for an item. */
  findings: Finding[];
  selected: string | null;
  onSelect: (surfaceId: string | null) => void;
  surfaceLabel: (surfaceId: string) => string;
}

export function EvidencePanel({ unitId, items, findings, selected, onSelect, surfaceLabel }: EvidencePanelProps) {
  const shown = selected ? items.filter((i) => i.surfaceId === selected) : items;
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div className="eyebrow">{selected ? 'Selected' : `Findings · ${items.length}`}</div>
        {selected && (
          <button className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>
            ← All
          </button>
        )}
      </div>
      {selected && <h2 className="h2" style={{ fontSize: 28 }}>{surfaceLabel(selected)}</h2>}
      <AnimatePresence mode="popLayout">
        {shown.length === 0 && (
          <motion.p key="empty" className="muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {selected ? 'Nothing on this wall.' : 'No findings yet.'}
          </motion.p>
        )}
        {shown.map((item, i) => (
          <motion.div key={`${selected ?? 'all'}-${item.surfaceId}-${i}`} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.45, ease: EASE, delay: i * 0.05 }}>
            <Line unitId={unitId} item={item} findings={findings} expanded={!!selected} onClick={() => onSelect(item.surfaceId)} surfaceLabel={surfaceLabel} />
          </motion.div>
        ))}
      </AnimatePresence>
    </aside>
  );
}

function Line({ unitId, item, findings, expanded, onClick, surfaceLabel }: { unitId: string; item: DiffItem; findings: Finding[]; expanded: boolean; onClick: () => void; surfaceLabel: (id: string) => string }) {
  const s = pinStyle(item);
  const bbox = findings.find((f) => f.surfaceId === item.surfaceId && (!item.issueType || f.type === item.issueType))?.bbox;
  return (
    <motion.div
      onClick={expanded ? undefined : onClick}
      whileHover={expanded ? undefined : { y: -2 }}
      className="card"
      style={{ padding: 16, cursor: expanded ? 'default' : 'pointer', position: 'relative', overflow: 'hidden', borderRadius: 16 }}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: s.color }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ font: '600 11px var(--sans)', color: s.color, textTransform: 'uppercase', letterSpacing: '.1em' }}>
          {s.label}
          {item.issueType ? ` · ${item.issueType}` : ''}
        </span>
        <b className="display" style={{ fontSize: 26, color: s.charged ? 'var(--red)' : 'var(--faint)' }}>
          {usd(item.costUsd)}
        </b>
      </div>
      {!expanded && <div style={{ fontWeight: 600, marginTop: 2 }}>{surfaceLabel(item.surfaceId)}</div>}
      <div style={{ color: 'var(--ink-2)', marginTop: 4, fontSize: 14 }}>{displayReason(item)}</div>
      {expanded && (item.beforeFrameId || item.afterFrameId) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          <Frame title="Move-in" src={item.beforeFrameId ? api.frameUrl(unitId, item.beforeFrameId) : null} />
          <Frame title="Move-out" src={item.afterFrameId ? api.frameUrl(unitId, item.afterFrameId) : null} bbox={bbox} color={s.color} />
        </div>
      )}
      {expanded && (
        <div className="faint mono" style={{ fontSize: 12, marginTop: 10 }}>
          confidence {Math.round(item.confidence * 100)}%{item.areaM2 ? ` · ${item.areaM2} m²` : ''}
        </div>
      )}
    </motion.div>
  );
}

export function Frame({ title, src, bbox, color = 'var(--red)' }: { title: string; src: string | null; bbox?: [number, number, number, number]; color?: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>
        {title}
      </figcaption>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'var(--paper-2)', borderRadius: 10, overflow: 'hidden' }}>
        {src ? (
          <img src={src} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div className="faint" style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 12 }}>
            no frame
          </div>
        )}
        {src && bbox && (
          <motion.div
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.25 }}
            style={{
              position: 'absolute',
              top: `${bbox[0] * 100}%`,
              left: `${bbox[1] * 100}%`,
              height: `${(bbox[2] - bbox[0]) * 100}%`,
              width: `${(bbox[3] - bbox[1]) * 100}%`,
              border: `2px solid ${color}`,
              borderRadius: 6,
              boxShadow: '0 0 0 9999px rgba(21,18,13,.18)',
            }}
          />
        )}
      </div>
    </figure>
  );
}

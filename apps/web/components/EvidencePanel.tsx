// [Alex] Right-hand panel: with nothing selected, every line (click to select); with a surface selected, its
// lines with verdict, reason, cost and before/after frames (damage box drawn on the after frame).
'use client';
import type { DiffItem, Finding } from '@ledger/shared';
import { pinStyle } from '@ledger/viewer/colors';
import { api } from '../lib/api';

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
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', paddingRight: 4 }}>
      {selected && (
        <button onClick={() => onSelect(null)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', color: '#6b6255', padding: 0 }}>
          ← all lines
        </button>
      )}
      {selected && <h2 style={{ margin: 0, fontSize: 18 }}>{surfaceLabel(selected)}</h2>}
      {shown.length === 0 && <p style={{ color: '#8a8173' }}>{selected ? 'Nothing recorded on this surface.' : 'No findings yet.'}</p>}
      {shown.map((item, i) => (
        <Line key={i} unitId={unitId} item={item} findings={findings} expanded={!!selected} onClick={() => onSelect(item.surfaceId)} surfaceLabel={surfaceLabel} />
      ))}
    </aside>
  );
}

function Line({ unitId, item, findings, expanded, onClick, surfaceLabel }: { unitId: string; item: DiffItem; findings: Finding[]; expanded: boolean; onClick: () => void; surfaceLabel: (id: string) => string }) {
  const s = pinStyle(item);
  const bbox = findings.find((f) => f.surfaceId === item.surfaceId && (!item.issueType || f.type === item.issueType))?.bbox;
  return (
    <div onClick={expanded ? undefined : onClick} style={{ background: '#fff', border: '1px solid #e6e0d4', borderLeft: `4px solid ${s.color}`, borderRadius: 10, padding: 14, cursor: expanded ? 'default' : 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ font: '600 12px system-ui', color: s.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {s.label}
          {item.issueType ? ` · ${item.issueType}` : ''}
        </span>
        <b style={{ fontSize: 18, color: s.charged ? '#dc2626' : '#8a8173' }}>${(item.costUsd ?? 0).toFixed(2)}</b>
      </div>
      {!expanded && <div style={{ fontWeight: 600, marginTop: 2 }}>{surfaceLabel(item.surfaceId)}</div>}
      <div style={{ color: '#4a443b', marginTop: 4, fontSize: 14 }}>{item.reason}</div>
      {expanded && (item.beforeFrameId || item.afterFrameId) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <Frame title="Move-in" src={item.beforeFrameId ? api.frameUrl(unitId, item.beforeFrameId) : null} />
          <Frame title="Move-out" src={item.afterFrameId ? api.frameUrl(unitId, item.afterFrameId) : null} bbox={bbox} color={s.color} />
        </div>
      )}
      {expanded && (
        <div style={{ color: '#8a8173', fontSize: 12, marginTop: 8 }}>
          confidence {Math.round(item.confidence * 100)}%{item.areaM2 ? ` · ${item.areaM2} m²` : ''}
        </div>
      )}
    </div>
  );
}

export function Frame({ title, src, bbox, color = '#dc2626' }: { title: string; src: string | null; bbox?: [number, number, number, number]; color?: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 12, color: '#6b6255', marginBottom: 4 }}>{title}</figcaption>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#ece7dd', borderRadius: 6, overflow: 'hidden' }}>
        {src ? (
          <img src={src} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#8a8173', fontSize: 12 }}>no frame</div>
        )}
        {src && bbox && (
          <div
            style={{
              position: 'absolute',
              top: `${bbox[0] * 100}%`,
              left: `${bbox[1] * 100}%`,
              height: `${(bbox[2] - bbox[0]) * 100}%`,
              width: `${(bbox[3] - bbox[1]) * 100}%`,
              border: `2px solid ${color}`,
              borderRadius: 4,
              boxShadow: '0 0 0 9999px rgba(0,0,0,.12)',
            }}
          />
        )}
      </div>
    </figure>
  );
}

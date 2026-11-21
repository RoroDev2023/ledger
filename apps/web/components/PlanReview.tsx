// [Alex] Check what was read from the plan before filming: 3D preview, rooms with areas, warnings. The owner can
// fix the ceiling height (the parser has to assume one) and room names. Saved with PATCH /units/:id/plan.
'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { api } from '../lib/api';
import { C, area, btn, input, label } from '../lib/ui';

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), { ssr: false });

export function PlanReview({ plan, onConfirmed }: { plan: FloorPlan; onConfirmed: (p: FloorPlan) => void }) {
  const [ceiling, setCeiling] = useState(String(plan.ceilingHeightM));
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(plan.rooms.map((r) => [r.id, r.name])));
  const [view, setView] = useState<'top' | '3d'>('top');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doors = plan.openings.filter((o) => o.kind === 'door').length;
  const windows = plan.openings.length - doors;
  const total = plan.rooms.reduce((s, r) => s + area(r.polygon), 0);

  const save = async () => {
    const h = Number(ceiling);
    if (!Number.isFinite(h) || h < 1.8 || h > 6) {
      setError('Ceiling height must be between 1.8 and 6 m.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onConfirmed(await api.patchPlan(plan.unitId, { ceilingHeightM: h, roomNames: names }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20 }}>
      <div style={{ position: 'relative', height: 440 }}>
        <UnitModel plan={{ ...plan, ceilingHeightM: Number(ceiling) || plan.ceilingHeightM }} view={view} />
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
          {(['top', '3d'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: view === v ? C.ink : '#fff', color: view === v ? '#fff' : C.ink }}>
              {v === 'top' ? 'Plan' : '3D'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 14, color: C.muted }}>
          {plan.rooms.length} rooms · {total.toFixed(1)} m² · {doors} doors · {windows} windows · scale from {plan.scaleSource === 'labels' ? 'printed dimensions' : plan.scaleSource}
        </div>
        <label style={label}>Rooms (rename if needed)</label>
        {plan.rooms.map((r) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input value={names[r.id] ?? ''} onChange={(e) => setNames({ ...names, [r.id]: e.target.value })} style={input} />
            <span style={{ fontSize: 13, color: C.faint, textAlign: 'right' }}>{area(r.polygon).toFixed(1)} m²</span>
          </div>
        ))}
        <label style={label}>Ceiling height (m)</label>
        <input type="number" step="0.05" min="1.8" max="6" value={ceiling} onChange={(e) => setCeiling(e.target.value)} style={{ ...input, width: 120 }} />
        {plan.warnings.length > 0 && (
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, color: '#a16207', fontSize: 13 }}>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <button onClick={() => void save()} disabled={busy} style={{ ...btn, marginTop: 16, width: '100%', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Saving…' : 'Looks right, continue'}
        </button>
        {error && <p style={{ color: C.red, fontSize: 14 }}>{error}</p>}
      </div>
    </div>
  );
}

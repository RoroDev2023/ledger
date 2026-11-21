// [Alex] Check what was read from the plan before filming: 3D preview, rooms with areas, warnings. The owner can
// fix the ceiling height (the parser has to assume one) and room names. Saved with PATCH /units/:id/plan.
'use client';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { api } from '../lib/api';
import { area } from '../lib/ui';
import { CountUp, Icon, Stagger, StaggerItem } from './motion';

/** Parser warnings, said the way a person would. Unknown ones pass through. */
function friendly(w: string): string {
  const m = /^ceiling height assumed ([\d.]+) m/.exec(w);
  if (m) return `We guessed the ceiling height (${m[1]} m). Change it if it’s different.`;
  if (w.startsWith('unresolved:')) return `Some walls didn't line up: ${w.slice(11).trim()}`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), { ssr: false });

export function PlanReview({ plan, onConfirmed }: { plan: FloorPlan; onConfirmed: (p: FloorPlan) => void }) {
  const [ceiling, setCeiling] = useState(String(plan.ceilingHeightM));
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(plan.rooms.map((r) => [r.id, r.name])));
  const [view, setView] = useState<'top' | '3d'>('3d');
  // What the camera will see on each wall. Doors and windows come from the plan; the rest helps tell walls apart.
  const walls = plan.surfaces.filter((s) => s.kind === 'wall');
  const [marks, setMarks] = useState<Record<string, string>>(
    Object.fromEntries(walls.map((w) => [w.id, (w.landmarks ?? []).filter((l) => l !== 'door' && l !== 'window').join(', ')])),
  );
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
      const landmarks = Object.fromEntries(
        Object.entries(marks).map(([id, text]) => [
          id,
          text
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        ]),
      );
      onConfirmed(await api.patchPlan(plan.unitId, { ceilingHeightM: h, roomNames: names, landmarks }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 28 }}>
      <div style={{ position: 'relative', height: 500 }}>
        <UnitModel plan={{ ...plan, ceilingHeightM: Number(ceiling) || plan.ceilingHeightM }} view={view} />
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
          {(['3d', 'top'] as const).map((v) => (
            <button key={v} className={`btn btn-sm ${view === v ? '' : 'btn-ghost'}`} onClick={() => setView(v)} style={view === v ? undefined : { background: 'rgba(255,253,249,.8)' }}>
              {v === 'top' ? 'Plan' : '3D'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow">Step 2</div>
        <h2 className="h2" style={{ marginTop: 8 }}>
          Check the plan
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 16 }}>
          {[
            [<CountUp key="a" value={total} format={(n) => n.toFixed(1)} />, 'm²'],
            [<CountUp key="d" value={doors} />, 'doors'],
            [<CountUp key="w" value={windows} />, 'windows'],
          ].map(([v, k], i) => (
            <div key={i} style={{ background: 'var(--paper)', borderRadius: 12, padding: '10px 12px' }}>
              <div className="display" style={{ fontSize: 28 }}>
                {v}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                {k}
              </div>
            </div>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
          {plan.scaleSource === 'labels' ? 'Sizes come from the measurements on the plan' : plan.scaleSource === 'known-measurement' ? 'Sizes come from your measurement' : 'Sizes are estimated, please check them'}
        </div>
        <label className="label">Rooms</label>
        <Stagger gap={0.05}>
          {plan.rooms.map((r) => (
            <StaggerItem key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input className="input" value={names[r.id] ?? ''} onChange={(e) => setNames({ ...names, [r.id]: e.target.value })} style={{ padding: '8px 12px' }} />
              <span className="mono faint" style={{ fontSize: 12.5, textAlign: 'right' }}>
                {area(r.polygon).toFixed(1)} m²
              </span>
            </StaggerItem>
          ))}
        </Stagger>
        <label className="label">What&apos;s on each wall</label>
        <p className="faint" style={{ fontSize: 12.5, margin: '-2px 0 8px' }}>
          Pictures, lights, a column. It helps us tell the walls apart in the video.
        </p>
        {walls.map((w) => {
          const fixed = (w.landmarks ?? []).filter((l) => l === 'door' || l === 'window');
          return (
            <div key={w.id} style={{ marginBottom: 6 }}>
              <div className="faint" style={{ fontSize: 12, marginBottom: 3 }}>
                {w.label}
                {fixed.length ? ` · ${[...new Set(fixed)].join(', ')}` : ''}
              </div>
              <input className="input" value={marks[w.id] ?? ''} onChange={(e) => setMarks({ ...marks, [w.id]: e.target.value })} placeholder="e.g. framed painting, wall lights" style={{ padding: '8px 12px' }} />
            </div>
          );
        })}
        <label className="label">Ceiling height (m)</label>
        <input className="input" type="number" step="0.05" min="1.8" max="6" value={ceiling} onChange={(e) => setCeiling(e.target.value)} style={{ width: 130 }} />
        {plan.warnings.length > 0 && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ margin: '14px 0 0', padding: '10px 12px 10px 28px', color: '#8a5a12', fontSize: 13, background: '#fbf1dc', borderRadius: 12 }}>
            {plan.warnings.map((w) => (
              <li key={w}>{friendly(w)}</li>
            ))}
          </motion.ul>
        )}
        <button className="btn btn-block btn-lg" onClick={() => void save()} disabled={busy} style={{ marginTop: 18 }}>
          {busy ? 'Saving…' : 'Looks right, continue'} {!busy && Icon.arrow}
        </button>
        {error && <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>}
      </div>
    </div>
  );
}

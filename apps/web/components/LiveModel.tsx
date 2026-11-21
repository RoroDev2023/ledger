// [Alex] The apartment in 3D next to the progress while a video is processed: a highlight moves from wall to wall
// with the current step, you can turn and zoom it, and when the job is done the real results drop in as pins.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { DiffItem, FloorPlan, WalkthroughKind } from '@ledger/shared';
import { api, type Stage } from '../lib/api';
import { EASE } from './motion';

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: '100%' }} />,
});

const DOING: Partial<Record<Stage, string>> = {
  frames: 'Picking the clearest frames',
  rooms: 'Finding the rooms',
  surfaces: 'Matching frames to walls',
  findings: 'Looking for damage, wall by wall',
  diff: 'Comparing with move-in',
};

export function LiveModel({ unitId, kind, stage, state }: { unitId: string; kind: WalkthroughKind; stage: Stage | null; state: 'running' | 'done' | 'error' }) {
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [items, setItems] = useState<DiffItem[]>([]);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    void api.plan(unitId).then(setPlan).catch(() => setPlan(null));
  }, [unitId]);

  // The walls the highlight walks over, in plan order.
  const walls = useMemo(() => plan?.surfaces.filter((s) => s.kind === 'wall').map((s) => s.id) ?? [], [plan]);
  const scanning = state === 'running' && !!stage && stage !== 'frames' && !picked;
  useEffect(() => {
    if (!scanning || !walls.length) return;
    const t = setInterval(() => setTick((n) => n + 1), 850);
    return () => clearInterval(t);
  }, [scanning, walls.length]);

  // Done: load what was found and drop it in as pins.
  useEffect(() => {
    if (state !== 'done') return;
    void (async () => {
      if (kind === 'move-out') {
        const s = await api.statement(unitId).catch(() => null);
        setItems(s?.items ?? []);
      } else {
        const f = await api.findings(unitId, 'baseline').catch(() => null);
        setItems(
          (f?.findings ?? []).map((x) => ({
            surfaceId: x.surfaceId,
            verdict: 'pre-existing' as const,
            issueType: x.type,
            reason: `${x.type.charAt(0).toUpperCase() + x.type.slice(1)} found at move-in.`,
            confidence: x.confidence,
            costUsd: 0,
          })),
        );
      }
    })();
  }, [state, kind, unitId]);

  const selected = picked ?? (scanning ? (walls[tick % walls.length] ?? null) : null);
  const label = state === 'done' ? (items.length ? `${items.length} item${items.length === 1 ? '' : 's'} found. Click a pin.` : 'Nothing found.') : state === 'error' ? 'Stopped' : stage ? (DOING[stage] ?? 'Working on it') : 'Waiting to start';
  const charged = items.filter((i) => (i.costUsd ?? 0) > 0).reduce((s, i) => s + (i.costUsd ?? 0), 0);

  return (
    <div className="card" style={{ position: 'relative', height: 380, padding: 0, overflow: 'hidden', marginBottom: 18, background: 'linear-gradient(180deg, #fff, #f1efe9)' }}>
      {plan && <UnitModel plan={plan} items={items} selected={selected} onSelect={(id) => setPicked((p) => (p === id ? null : id))} style={{ borderRadius: 0 }} />}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderRadius: 10, background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(8px)', border: '1px solid var(--line)', fontSize: 13, fontWeight: 600 }}>
        <span style={{ position: 'relative', width: 8, height: 8 }}>
          <span className="dot" style={{ position: 'absolute', inset: 0, color: state === 'done' ? 'var(--green)' : 'var(--red)' }} />
          {state === 'running' && <motion.span className="dot" style={{ position: 'absolute', inset: 0, color: 'var(--red)' }} animate={{ scale: [1, 2.6], opacity: [0.6, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
        </span>
        <AnimatePresence mode="wait">
          <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
      {state === 'done' && kind === 'move-out' && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.4 }} style={{ position: 'absolute', top: 12, right: 12, padding: '7px 12px', borderRadius: 10, background: 'var(--ink)', color: '#fff', font: '700 15px var(--mono)' }}>
          ${charged.toFixed(2)}
        </motion.div>
      )}
      <div className="faint" style={{ position: 'absolute', left: 14, bottom: 10, fontSize: 12 }}>
        Drag to turn · Scroll to zoom
      </div>
    </div>
  );
}

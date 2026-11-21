// [Alex] Unit page: the 3D evidence map next to the statement lines. Before move-out it shows the move-in record
// (existing damage, all pre-existing); after move-out it shows the statement.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { DiffItem, Finding, FloorPlan, Statement } from '@ledger/shared';
import { EvidencePanel } from '../../../components/EvidencePanel';
import { Header } from '../../../components/Header';
import { VideoUpload } from '../../../components/VideoUpload';
import { api, type Unit } from '../../../lib/api';
import { CountUp, EASE, Icon } from '../../../components/motion';
import { area } from '../../../lib/ui';

// three.js needs the browser (WebGL), so the 3D view never renders on the server.
const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), {
  ssr: false,
  loading: () => <div className="faint" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>Building the 3D model…</div>,
});

interface Loaded {
  unit: Unit;
  plan: FloorPlan;
  statement: Statement | null;
  items: DiffItem[];
  moveOutFindings: Finding[];
}

function UnitPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?select=<surfaceId>&view=top open the page on a given wall or view (handy for the demo and for screenshots).
  const q = useSearchParams();
  const [selected, setSelected] = useState<string | null>(q.get('select'));
  const [view, setView] = useState<'3d' | 'top'>(q.get('view') === 'top' ? 'top' : '3d');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [unit, plan] = await Promise.all([api.unit(id), api.plan(id)]);
      // Only ask for results that can exist yet (a 404 is handled, but the browser still logs it as an error).
      const statement = unit.walkthroughs.some((w) => w.kind === 'move-out') ? await api.statement(id) : null;
      let items = statement?.items ?? [];
      let moveOutFindings: Finding[] = [];
      if (statement) {
        moveOutFindings = (await api.findings(id, 'move-out'))?.findings ?? [];
      } else {
        const base = unit.walkthroughs.some((w) => w.kind === 'baseline') ? await api.findings(id, 'baseline') : null;
        items = (base?.findings ?? []).map((f) => ({
          surfaceId: f.surfaceId,
          verdict: 'pre-existing' as const,
          issueType: f.type,
          reason: `${f.type.charAt(0).toUpperCase() + f.type.slice(1)}, severity ${f.severity} of 5. On record since move-in.`,
          beforeFrameId: f.frameIds[0], // a move-in frame: shown under "Move-in" in the evidence panel
          confidence: f.confidence,
          costUsd: 0,
        }));
        moveOutFindings = base?.findings ?? [];
      }
      setData({ unit, plan, statement, items, moveOutFindings });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = useMemo(() => new Map(data?.plan.surfaces.map((s) => [s.id, s.label]) ?? []), [data]);
  const surfaceLabel = useCallback((sid: string) => labels.get(sid) ?? sid, [labels]);

  if (error) return <Centered>Could not load unit “{id}”: {error}</Centered>;
  if (!data) return <Centered>Loading…</Centered>;
  const { plan, statement, items } = data;
  const hasBaseline = data.unit.walkthroughs.some((w) => w.kind === 'baseline');
  const next = statement
    ? { href: `/units/${plan.unitId}/statement`, label: 'Open statement →' }
    : hasBaseline
      ? { href: `/units/${plan.unitId}/moveout`, label: 'Upload move-out →' }
      : null;
  const total = plan.rooms.reduce((s, r) => s + area(r.polygon), 0);
  const phase = statement ? 'Move-out complete' : hasBaseline ? 'Move-in on record' : 'Floor plan ready';

  return (
    <>
      <Header unitId={plan.unitId} />
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '26px 28px 30px' }}>
        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} style={{ display: 'flex', alignItems: 'end', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="eyebrow">{phase}</div>
            <h1 className="display" style={{ fontSize: 52, marginTop: 8 }}>
              {plan.unitId}
            </h1>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {plan.rooms.map((r) => (
                <span key={r.id} className="chip">
                  {r.name}
                </span>
              ))}
              <span className="chip mono">{total.toFixed(1)} m²</span>
              <span className="chip mono">ceiling {plan.ceilingHeightM} m</span>
            </div>
          </div>
          {statement ? (
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow">Send by {statement.dueBy}</div>
              <div className="display" style={{ fontSize: 48, color: statement.totalUsd > 0 ? 'var(--red)' : 'var(--ink)', marginTop: 4 }}>
                $<CountUp value={statement.totalUsd} format={(n) => n.toFixed(2)} />
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 14, textAlign: 'right' }}>
              {hasBaseline ? (
                <>
                  On record since move-in
                  <br />
                  <b style={{ color: 'var(--ink)', fontSize: 22 }}>{items.length}</b> existing issue{items.length === 1 ? '' : 's'}
                </>
              ) : (
                'No move-in video yet'
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => void load()}>
              Refresh
            </button>
            {next ? (
              <a href={next.href} className="btn">
                {next.label}
              </a>
            ) : (
              <button className="btn" onClick={() => setUploading(true)}>
                Upload move-in video {Icon.arrow}
              </button>
            )}
          </div>
        </motion.header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 20, height: 'calc(100vh - 250px)', minHeight: 520 }}>
          <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 }} className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden', minHeight: 0 }}>
            <UnitModel plan={plan} items={items} selected={selected} onSelect={setSelected} view={view} style={{ borderRadius: 0 }} />
            <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: 'rgba(255,253,249,.85)', backdropFilter: 'blur(8px)', border: '1px solid var(--line)' }}>
              {(['3d', 'top'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} style={{ position: 'relative', border: 0, background: 'none', padding: '6px 14px', borderRadius: 999, fontSize: 13, color: view === v ? 'var(--paper)' : 'var(--ink-2)' }}>
                  {view === v && <motion.span layoutId="view-pill" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--ink)' }} transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                  <span style={{ position: 'relative' }}>{v === '3d' ? '3D' : 'Plan'}</span>
                </button>
              ))}
            </div>
            <div className="faint" style={{ position: 'absolute', left: 16, bottom: 14, fontSize: 12 }}>
              Drag to orbit · Scroll to zoom · Click a wall
            </div>
          </motion.div>
          <EvidencePanel unitId={plan.unitId} items={items} findings={data.moveOutFindings} selected={selected} onSelect={setSelected} surfaceLabel={surfaceLabel} />
        </div>
      </main>

      <AnimatePresence>
        {uploading && !hasBaseline && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(21,18,13,.35)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center' }} onClick={() => setUploading(false)}>
            <motion.div initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} className="card" style={{ width: 560, padding: 28 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                <h2 className="h2">Move-in video</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setUploading(false)}>
                  Close
                </button>
              </div>
              <VideoUpload
                unitId={plan.unitId}
                kind="baseline"
                onDone={() => {
                  setUploading(false);
                  void load();
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <UnitPage />
    </Suspense>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="muted" style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
      {children}
    </main>
  );
}


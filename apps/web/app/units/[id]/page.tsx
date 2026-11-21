// [Alex] Unit page: the 3D evidence map next to the statement lines. Before move-out it shows the move-in record
// (existing damage, all pre-existing); after move-out it shows the statement.
'use client';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { DiffItem, Finding, FloorPlan, Statement } from '@ledger/shared';
import { EvidencePanel } from '../../../components/EvidencePanel';
import { api } from '../../../lib/api';

// three.js needs the browser (WebGL), so the 3D view never renders on the server.
const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), {
  ssr: false,
  loading: () => <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#8a8173' }}>loading 3D…</div>,
});

interface Loaded {
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

  const load = useCallback(async () => {
    try {
      const plan = await api.plan(id);
      const statement = await api.statement(id);
      let items = statement?.items ?? [];
      let moveOutFindings: Finding[] = [];
      if (statement) {
        moveOutFindings = (await api.findings(id, 'move-out'))?.findings ?? [];
      } else {
        const base = await api.findings(id, 'baseline');
        items = (base?.findings ?? []).map((f) => ({
          surfaceId: f.surfaceId,
          verdict: 'pre-existing' as const,
          issueType: f.type,
          reason: `In the move-in record: ${f.type}, severity ${f.severity}/5.`,
          afterFrameId: f.frameIds[0],
          confidence: f.confidence,
          costUsd: 0,
        }));
        moveOutFindings = base?.findings ?? [];
      }
      setData({ plan, statement, items, moveOutFindings });
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

  return (
    <main style={{ height: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr', padding: '18px 24px', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{plan.unitId}</h1>
        <span style={{ color: '#6b6255' }}>
          {plan.rooms.map((r) => r.name).join(' · ')} · ceiling {plan.ceilingHeightM} m
        </span>
        <span style={{ flex: 1 }} />
        {statement ? (
          <span>
            Send by <b>{statement.dueBy}</b> · total <b style={{ fontSize: 20, color: statement.totalUsd > 0 ? '#dc2626' : undefined }}>${statement.totalUsd.toFixed(2)}</b> ·{' '}
            <a href={api.statementHtmlUrl(plan.unitId)} target="_blank" rel="noreferrer">
              statement
            </a>
          </span>
        ) : (
          <span style={{ color: '#6b6255' }}>Move-in record · {items.length} existing issue(s)</span>
        )}
        <button onClick={() => void load()} style={btn}>
          Refresh
        </button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 20, minHeight: 0 }}>
        <div style={{ position: 'relative', minHeight: 0 }}>
          <UnitModel plan={plan} items={items} selected={selected} onSelect={setSelected} view={view} />
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
            {(['3d', 'top'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{ ...btn, background: view === v ? '#15130f' : '#fff', color: view === v ? '#fff' : '#15130f' }}>
                {v === '3d' ? '3D' : 'Top-down'}
              </button>
            ))}
          </div>
        </div>
        <EvidencePanel unitId={plan.unitId} items={items} findings={data.moveOutFindings} selected={selected} onSelect={setSelected} surfaceLabel={surfaceLabel} />
      </div>
    </main>
  );
}

const btn = { padding: '6px 12px', border: '1px solid #d8d2c6', borderRadius: 8, background: '#fff' } as const;

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ height: '100vh', display: 'grid', placeItems: 'center', color: '#6b6255' }}>{children}</main>;
}

export default function Page() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <UnitPage />
    </Suspense>
  );
}

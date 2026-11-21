// [Alex] /lab : renders the viewer's test plans (packages/viewer/src/samples.ts) one at a time, for checking the
// 3D view by eye. URL: /lab?case=<id>&view=3d|top&select=<surfaceId>. Not part of the product.
'use client';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SAMPLES } from '@ledger/viewer/samples';

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), { ssr: false });

function Lab() {
  const q = useSearchParams();
  const router = useRouter();
  const sample = SAMPLES.find((s) => s.id === q.get('case')) ?? SAMPLES[0]!;
  const view = q.get('view') === 'top' ? 'top' : '3d';
  const selected = q.get('select');
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/lab?${next.toString()}`);
  };

  return (
    <main style={{ height: '100vh', display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, padding: 16 }}>
      <nav style={{ overflow: 'auto' }}>
        <h1 style={{ fontSize: 16, margin: '0 0 10px' }}>Viewer lab</h1>
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            onClick={() => go({ case: s.id, select: null })}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, border: '1px solid #e2dccf', borderRadius: 8, background: s.id === sample.id ? '#15130f' : '#fff', color: s.id === sample.id ? '#fff' : '#15130f' }}
          >
            {s.title}
          </button>
        ))}
      </nav>
      <section style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 10, minHeight: 0 }}>
        <div>
          <b>{sample.title}</b> <span style={{ color: '#6b6255' }}>· checks: {sample.checks}</span>
          <span style={{ float: 'right', display: 'flex', gap: 6 }}>
            {(['3d', 'top'] as const).map((v) => (
              <button key={v} onClick={() => go({ view: v })} style={{ padding: '4px 10px', border: '1px solid #d8d2c6', borderRadius: 8, background: view === v ? '#15130f' : '#fff', color: view === v ? '#fff' : '#15130f' }}>
                {v === '3d' ? '3D' : 'Top-down'}
              </button>
            ))}
          </span>
          {selected && <div style={{ color: '#6b6255', fontSize: 13 }}>selected: {selected}</div>}
        </div>
        <UnitModel key={sample.id} plan={sample.plan} items={sample.items} view={view} selected={selected} onSelect={(id) => go({ select: id })} />
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}

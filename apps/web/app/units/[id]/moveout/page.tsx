// [Alex] A3 move-out: upload the second walkthrough; the pipeline compares it with the move-in record surface by
// surface and writes the statement.
'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '../../../../components/Header';
import { VideoUpload } from '../../../../components/VideoUpload';
import { api, type Unit } from '../../../../lib/api';
import { C, card, h1, page } from '../../../../lib/ui';

export default function MoveOut() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.unit(id).then(setUnit, (e: Error) => setError(e.message));
  }, [id]);
  const hasBaseline = unit?.walkthroughs.some((w) => w.kind === 'baseline');

  return (
    <>
      <Header unitId={id} />
      <main style={{ ...page, maxWidth: 760 }}>
        <h1 style={h1}>Move-out walkthrough</h1>
        <p style={{ color: C.muted, marginTop: 0 }}>
          Film the same unit again. The path and angles don&apos;t need to match the move-in video: both are pinned to the same floor plan, and only damage that
          two before/after views agree on gets charged.
        </p>
        {error && <p style={{ color: C.red }}>Could not load unit “{id}”: {error}</p>}
        {unit && !hasBaseline && (
          <div style={card}>
            There is no move-in video for this unit yet, so there is nothing to compare against. <a href={`/owner/new`}>Start a new unit</a> or upload the move-in first.
          </div>
        )}
        {unit && hasBaseline && (
          <div style={card}>
            <VideoUpload unitId={id} kind="move-out" onDone={() => router.push(`/units/${id}/statement`)} />
          </div>
        )}
      </main>
    </>
  );
}

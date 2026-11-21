// [Alex] A3 move-out: upload the second walkthrough; the pipeline compares it with the move-in record surface by
// surface and writes the statement.
'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '../../../../components/Header';
import { VideoUpload } from '../../../../components/VideoUpload';
import { api, type Unit } from '../../../../lib/api';
import { EASE } from '../../../../components/motion';
import { motion } from 'motion/react';

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
      <main className="page" style={{ maxWidth: 1000 }}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <div className="eyebrow">Unit {id}</div>
          <h1 className="display" style={{ fontSize: 56, marginTop: 8 }}>
            Upload the move-out video
          </h1>
          <p className="lede" style={{ marginTop: 14 }}>
            Walk through the same rooms again. Any route is fine. We only charge for damage we can show in photos.
          </p>
        </motion.div>
        {error && <p style={{ color: 'var(--red)' }}>Could not load unit “{id}”: {error}</p>}
        {unit && !hasBaseline && (
          <div className="card card-pad" style={{ marginTop: 24 }}>
            We need the move-in video first, to have something to compare with. <a href={`/units/${id}`}>Upload it</a>.
          </div>
        )}
        {unit && hasBaseline && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 }} className="card" style={{ padding: 28, marginTop: 24 }}>
            <VideoUpload unitId={id} kind="move-out" onDone={() => router.push(`/units/${id}/statement`)} />
          </motion.div>
        )}
      </main>
    </>
  );
}

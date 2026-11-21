// [Alex] Pick a walkthrough video, upload it (with upload progress), then follow the pipeline job live.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WalkthroughKind } from '@ledger/shared';
import { api, type Stage } from '../lib/api';
import { JobProgress } from './JobProgress';
import { LiveModel } from './LiveModel';
import { Dropzone, EASE, Icon } from './motion';

const today = () => new Date().toISOString().slice(0, 10);

export function VideoUpload({ unitId, kind, onDone }: { unitId: string; kind: WalkthroughKind; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(today());
  const [sent, setSent] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const moveOut = kind === 'move-out';
  const [live, setLive] = useState<{ stage: Stage | null; state: 'running' | 'done' | 'error' }>({ stage: null, state: 'running' });
  const onChange = useCallback((stage: Stage | null, state: 'running' | 'done' | 'error') => setLive({ stage, state }), []);

  const start = async () => {
    if (!file) return;
    setError('');
    setSent(0);
    try {
      const { jobId: id } = await api.uploadWalkthrough(unitId, file, kind, date, setSent);
      setJobId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSent(null);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {jobId ? (
        <motion.div key="job">
          <Processing
            unitId={unitId}
            kind={kind}
            title={moveOut ? 'Checking the move-out video' : 'Reading the move-in video'}
            model={<LiveModel unitId={unitId} kind={kind} stage={live.stage} state={live.state} height="100%" />}
            progress={<JobProgress jobId={jobId} withDiff={moveOut} onDone={onDone} onChange={onChange} hold />}
          />
        </motion.div>
      ) : (
        <motion.div key="pick" exit={{ opacity: 0, y: -10 }}>
          <Dropzone
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
            file={file}
            onFile={setFile}
            icon={Icon.video}
            title={moveOut ? 'Drop the move-out video here' : 'Drop the move-in video here'}
            hint="Straight from your phone. Walk slowly, a few seconds per wall."
          />
          <div style={{ display: 'flex', alignItems: 'end', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
            <div>
              <label className="label" style={{ marginTop: 0 }}>
                {moveOut ? 'Move-out date' : 'Date filmed'}
              </label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 190 }} />
            </div>
            <button className="btn btn-lg" onClick={() => void start()} disabled={!file || sent !== null} style={{ position: 'relative', overflow: 'hidden' }}>
              {sent !== null && <span style={{ position: 'absolute', inset: 0, width: `${sent * 100}%`, background: 'rgba(255,255,255,.16)', transition: 'width .2s' }} />}
              <span style={{ position: 'relative' }}>{sent === null ? (moveOut ? 'Upload move-out' : 'Upload move-in') : `Uploading ${Math.round(sent * 100)}%`}</span>
              {sent === null && Icon.arrow}
            </button>
          </div>
          {moveOut && <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>In New York the statement has to go out within 14 days of this date.</p>}
          {error && <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Full-screen processing view: the 3D big on the left, the progress on the right. Rendered on top of the page
 * (portal), so it looks the same from the move-in popup, the new-apartment flow and the move-out page. */
function Processing({ unitId, kind, title, model, progress }: { unitId: string; kind: WalkthroughKind; title: string; model: ReactNode; progress: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setEl(document.body);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (!el) return null;
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--paper)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(420px, 1fr)', gap: 24, padding: 24 }}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, ease: EASE }} style={{ minHeight: 0 }}>
        {model}
      </motion.div>
      <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.1 }} style={{ overflowY: 'auto', minHeight: 0, padding: '8px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, font: '800 19px var(--display)', letterSpacing: '-0.04em' }}>
          <i style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--red)', transform: 'rotate(45deg) scale(.8)', display: 'inline-block' }} /> LEDGER
          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 400, letterSpacing: 0 }}>{unitId}</span>
        </div>
        <h1 className="display" style={{ fontSize: 44, margin: '28px 0 6px' }}>{title}</h1>
        <p className="muted" style={{ margin: '0 0 22px' }}>{kind === 'move-out' ? 'Turn the apartment around while we compare it with move-in.' : 'Turn the apartment around while we go through the video.'}</p>
        {progress}
      </motion.div>
    </motion.div>,
    el,
  );
}

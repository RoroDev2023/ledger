// [Alex] Pick a walkthrough video, upload it (with upload progress), then follow the pipeline job live.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useState } from 'react';
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
        <motion.div key="job" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
          <LiveModel unitId={unitId} kind={kind} stage={live.stage} state={live.state} />
          <JobProgress jobId={jobId} withDiff={moveOut} onDone={onDone} onChange={onChange} hold />
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

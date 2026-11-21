// [Alex] Pick a walkthrough video, upload it (with upload progress), then follow the pipeline job live.
'use client';
import { useState } from 'react';
import type { WalkthroughKind } from '@ledger/shared';
import { api } from '../lib/api';
import { C, btn, input, label } from '../lib/ui';
import { JobProgress } from './JobProgress';

const today = () => new Date().toISOString().slice(0, 10);

export function VideoUpload({ unitId, kind, onDone }: { unitId: string; kind: WalkthroughKind; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(today());
  const [sent, setSent] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const moveOut = kind === 'move-out';

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

  if (jobId) return <JobProgress jobId={jobId} withDiff={moveOut} onDone={onDone} />;
  return (
    <div>
      <p style={{ color: C.muted, marginTop: 0, fontSize: 14 }}>
        Film every wall with a slow pan, about 5 seconds per wall. MP4, MOV or WEBM from a phone is fine.
      </p>
      <label style={label}>{moveOut ? 'Move-out video' : 'Move-in video'}</label>
      <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={input} />
      <label style={label}>{moveOut ? 'Move-out date (the statement is due 14 days later)' : 'Filmed on'}</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input, width: 200 }} />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => void start()} disabled={!file || sent !== null} style={{ ...btn, opacity: !file || sent !== null ? 0.5 : 1 }}>
          {sent === null ? (moveOut ? 'Upload move-out' : 'Upload move-in') : `Uploading ${Math.round(sent * 100)}%`}
        </button>
        {file && <span style={{ color: C.faint, fontSize: 13 }}>{file.name} · {(file.size / 1e6).toFixed(1)} MB</span>}
      </div>
      {error && <p style={{ color: C.red, fontSize: 14 }}>{error}</p>}
    </div>
  );
}

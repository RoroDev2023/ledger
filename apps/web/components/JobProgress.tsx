// [Alex] Live pipeline progress for one job: a bar per stage plus the Decisions API counters.
'use client';
import { useEffect, useState } from 'react';
import { api, type DecisionsStat, type JobEvent, type Stage } from '../lib/api';
import { C } from '../lib/ui';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'frames', label: 'Keyframes' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'surfaces', label: 'Walls' },
  { id: 'findings', label: 'Damage check' },
  { id: 'diff', label: 'Before / after' },
];

export function JobProgress({ jobId, withDiff, onDone, onError }: { jobId: string; withDiff: boolean; onDone?: () => void; onError?: (msg: string) => void }) {
  const [progress, setProgress] = useState<Partial<Record<Stage, { done: number; total: number }>>>({});
  const [stats, setStats] = useState<DecisionsStat | null>(null);
  const [state, setState] = useState<'running' | 'done' | 'error'>('running');
  const [error, setError] = useState('');

  useEffect(
    () =>
      api.followJob(jobId, (e: JobEvent) => {
        if (e.type === 'progress') setProgress((p) => ({ ...p, [e.stage]: { done: e.done, total: e.total } }));
        else if (e.type === 'decisions') setStats(e.stats);
        else if (e.type === 'done') {
          setState('done');
          onDone?.();
        } else {
          setState('error');
          setError(e.message);
          onError?.(e.message);
        }
      }),
    [jobId],
  );

  return (
    <div>
      {STAGES.filter((s) => withDiff || s.id !== 'diff').map((s) => {
        const p = progress[s.id];
        const frac = p ? p.done / p.total : 0;
        return (
          <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 56px', gap: 10, alignItems: 'center', fontSize: 14, margin: '6px 0' }}>
            <span style={{ color: frac >= 1 ? C.ink : C.muted }}>{s.label}</span>
            <div style={{ height: 8, background: C.line, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${frac * 100}%`, background: frac >= 1 ? C.green : C.blue, transition: 'width .2s' }} />
            </div>
            <span style={{ color: C.faint, fontSize: 12, textAlign: 'right' }}>{p ? `${p.done}/${p.total}` : '–'}</span>
          </div>
        );
      })}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
        {[
          ['Decisions calls', stats?.calls ?? 0],
          ['Questions asked', stats?.questions ?? 0],
          ['Avg response', stats ? `${stats.avgLatencyMs} ms` : '–'],
        ].map(([k, v]) => (
          <div key={k} style={{ background: C.bg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <b style={{ fontSize: 20, display: 'block' }}>{v}</b>
            <span style={{ fontSize: 12, color: C.muted }}>{k}</span>
          </div>
        ))}
      </div>
      {state === 'done' && <p style={{ color: C.green, margin: '12px 0 0' }}>✓ Done</p>}
      {state === 'error' && <p style={{ color: C.red, margin: '12px 0 0' }}>Failed: {error}</p>}
    </div>
  );
}

// [Alex] Live pipeline progress for one job: a row per stage plus the Decisions API counters.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api, type DecisionsStat, type JobEvent, type Stage } from '../lib/api';
import { EASE, Icon } from './motion';

const STAGES: { id: Stage; label: string; who: string }[] = [
  { id: 'frames', label: 'Keyframes', who: '' },
  { id: 'rooms', label: 'Rooms', who: 'Decisions API' },
  { id: 'surfaces', label: 'Walls', who: 'Decisions API' },
  { id: 'findings', label: 'Damage', who: 'Decisions API · Carbon' },
  { id: 'diff', label: 'Before and after', who: 'Decisions API' },
];

export function JobProgress({ jobId, withDiff, onDone, onError }: { jobId: string; withDiff: boolean; onDone?: () => void; onError?: (msg: string) => void }) {
  // Move-in = record only (frames on walls); damage and before/after run on the move-out.
  const [progress, setProgress] = useState<Partial<Record<Stage, { done: number; total: number }>>>({});
  const [stats, setStats] = useState<DecisionsStat | null>(null);
  const [state, setState] = useState<'running' | 'done' | 'error'>('running');
  const [error, setError] = useState('');
  // Until the first event arrives the job may be waiting behind others (one job runs at a time).
  const [waiting, setWaiting] = useState<number | null>(null);
  // A clock and the time of the last event: second opinions (Argon/Carbon) send no progress for up to a minute,
  // and a silent page looks frozen.
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());
  const [lastEventAt, setLastEventAt] = useState(() => Date.now());
  useEffect(() => {
    if (state !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);
  const started = Object.keys(progress).length > 0;
  useEffect(() => {
    if (started || state !== 'running') return setWaiting(null);
    let alive = true;
    const check = async () => {
      try {
        const [j, h] = await Promise.all([api.job(jobId), api.health()]);
        if (alive) setWaiting(j.status === 'queued' ? Math.max(1, h.queued - 1) : null);
      } catch {
        /* keep the last value */
      }
    };
    void check();
    const t = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId, started, state]);

  useEffect(
    () =>
      api.followJob(jobId, (e: JobEvent) => {
        setLastEventAt(Date.now());
        if (e.type === 'progress') setProgress((p) => ({ ...p, [e.stage]: { done: e.done, total: e.total } }));
        else if (e.type === 'decisions') setStats(e.stats);
        else if (e.type === 'done') {
          setState('done');
          setTimeout(() => onDone?.(), 700);
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
      <div className="eyebrow">{state === 'done' ? 'Complete' : state === 'error' ? 'Stopped' : waiting ? 'Waiting in line' : 'Processing'}</div>
      {state === 'running' && waiting === null && (
        <div className="faint mono" style={{ fontSize: 12, marginTop: 6 }}>
          {fmtClock(now - startedAt)}
          {now - lastEventAt > 6000 && Object.keys(progress).length > 0 && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginLeft: 10, color: 'var(--brass)' }}>
              Second opinion on the unsure frames · can take up to a minute
            </motion.span>
          )}
        </div>
      )}
      {waiting !== null && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="muted" style={{ margin: '8px 0 0', fontSize: 14 }}>
          {waiting === 1 ? 'One video' : `${waiting} videos`} ahead of this one. Videos are processed one at a time; this starts automatically.
        </motion.p>
      )}
      <div style={{ marginTop: 14 }}>
        {STAGES.filter((s) => withDiff || (s.id !== 'diff' && s.id !== 'findings')).map((s, i) => {
          const p = progress[s.id];
          const frac = p ? p.done / p.total : 0;
          const done = frac >= 1;
          const live = !!p && !done;
          return (
            <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, ease: EASE }} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 140px', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: done ? 'var(--green)' : 'transparent', border: done ? 0 : '1.5px solid var(--line-2)', color: '#fff', transition: 'background .3s' }}>
                <AnimatePresence>{done && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>{Icon.check}</motion.span>}</AnimatePresence>
              </span>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
                  <span style={{ color: p ? 'var(--ink)' : 'var(--faint)' }}>{s.label}</span>
                  <span className="mono faint" style={{ fontSize: 12 }}>
                    {p ? `${p.done}/${p.total}` : ''}
                  </span>
                </div>
                <div className="track" style={{ marginTop: 6 }}>
                  <div className={`fill${live ? ' live' : ''}${done ? ' done' : ''}`} style={{ width: `${frac * 100}%` }} />
                </div>
              </div>
              <span className="faint" style={{ fontSize: 12, textAlign: 'right' }}>
                {s.who}
              </span>
            </motion.div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
        {[
          ['Decisions calls', stats?.calls ?? 0],
          ['Questions', stats?.questions ?? 0],
          ['Avg. response', stats ? `${stats.avgLatencyMs} ms` : '–'],
        ].map(([k, v]) => (
          <div key={k} style={{ background: 'var(--paper)', borderRadius: 14, padding: '12px 14px' }}>
            <motion.div key={String(v)} initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="display num" style={{ fontSize: 30 }}>
              {v}
            </motion.div>
            <div className="faint" style={{ fontSize: 12 }}>
              {k}
            </div>
          </div>
        ))}
      </div>
      {state === 'error' && <p style={{ color: 'var(--red)', marginTop: 12 }}>Something went wrong: {error}</p>}
    </div>
  );
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

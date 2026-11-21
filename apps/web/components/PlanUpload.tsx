// [Alex] Upload a floor plan. While Argon reads it, a scan line sweeps the drawing (images) or the page icon (PDFs).
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { api, type Unit } from '../lib/api';
import { Dropzone, EASE, Icon } from './motion';

const READING = ['Rooms', 'Walls', 'Doors and windows', 'Dimensions', '3D model'];

export function PlanUpload({ onParsed, onNameChange }: { onParsed: (r: { unit: Unit; plan: FloorPlan }) => void; onNameChange?: (name: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [unitId, setUnitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    try {
      onParsed(await api.createUnit(file, unitId.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(t);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 28 }}>
      <div style={{ position: 'relative' }}>
        <AnimatePresence mode="wait">
          {busy ? (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="drop" style={{ cursor: 'default', overflow: 'hidden', minHeight: 300 }}>
              {preview ? (
                <img src={preview} alt="" style={{ position: 'absolute', inset: 16, width: 'calc(100% - 32px)', height: 'calc(100% - 32px)', objectFit: 'contain', opacity: 0.55, filter: 'grayscale(1)' }} />
              ) : (
                <div style={{ color: 'var(--brass)', transform: 'scale(2.2)' }}>{Icon.plan}</div>
              )}
              <motion.div
                style={{ position: 'absolute', left: 0, right: 0, height: 90, background: 'linear-gradient(180deg, rgba(164,123,63,0) 0%, rgba(164,123,63,.22) 85%, rgba(164,123,63,.9) 100%)' }}
                animate={{ top: ['-90px', '100%'] }}
                transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
              />
            </motion.div>
          ) : (
            <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Dropzone accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" file={file} onFile={setFile} icon={Icon.plan} title="Drop the floor plan here" hint="PDF or image, straight from the listing" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div>
        <div className="eyebrow">Step 1</div>
        <h2 className="h2" style={{ marginTop: 8 }}>
          Upload the floor plan
        </h2>
        <p className="muted" style={{ marginTop: 10 }}>
          We read the rooms, doors and windows and build a 3D model you can check.
        </p>
        <label className="label">Unit name</label>
        <input className="input" value={unitId} onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_-]/g, '-'); setUnitId(v); onNameChange?.(v); }} placeholder="e.g. apt-4b" />
        <button className="btn btn-block btn-lg" onClick={() => void start()} disabled={!file || busy} style={{ marginTop: 18 }}>
          {busy ? `Reading the plan… ${seconds}s` : 'Read plan'} {!busy && Icon.arrow}
        </button>
        <AnimatePresence>
          {busy && (
            <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', fontSize: 14 }}>
              {READING.map((r, i) => {
                // Honest: Argon returns everything in one answer, so nothing is ticked off early. The list only
                // shows what the model is doing, with a highlight moving through it while we wait.
                const on = Math.floor(seconds / 2) % READING.length === i;
                return (
                  <motion.li key={r} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08, ease: EASE }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', color: on ? 'var(--ink)' : 'var(--faint)', transition: 'color .4s' }}>
                    <motion.span className="dot" style={{ color: on ? 'var(--brass)' : 'var(--line-2)' }} animate={on ? { scale: [1, 1.6, 1] } : { scale: 1 }} transition={{ duration: 1, repeat: on ? Infinity : 0 }} />
                    {r}
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
        {error && <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>}
      </div>
    </div>
  );
}

// [Alex] Upload a floor plan (PDF or image). The API reads it (Argon when PLAN_PARSER=argon) and returns the plan.
'use client';
import { useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { api, type Unit } from '../lib/api';
import { C, btn, input, label } from '../lib/ui';

export function PlanUpload({ onParsed }: { onParsed: (r: { unit: Unit; plan: FloorPlan }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [unitId, setUnitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);

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
    <div>
      <p style={{ color: C.muted, marginTop: 0, fontSize: 14 }}>The floor plan from the listing: PDF, PNG or JPG. LEDGER reads the rooms, doors, windows and printed dimensions.</p>
      <label style={label}>Floor plan</label>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={input} />
      <label style={label}>Unit name (optional, letters, numbers and dashes)</label>
      <input value={unitId} onChange={(e) => setUnitId(e.target.value.replace(/[^A-Za-z0-9_-]/g, '-'))} placeholder="e.g. apt-4b" style={{ ...input, width: 260 }} />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => void start()} disabled={!file || busy} style={{ ...btn, opacity: !file || busy ? 0.5 : 1 }}>
          {busy ? `Reading the plan… ${seconds}s` : 'Read plan'}
        </button>
        {busy && <span style={{ color: C.faint, fontSize: 13 }}>Gemini 4 Argon is reading the drawing; this takes 10–30 seconds.</span>}
      </div>
      {error && <p style={{ color: C.red, fontSize: 14 }}>{error}</p>}
    </div>
  );
}

// [Alex] Landing: open a unit by id (create units on the API test page for now; /owner/new comes later).
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '../lib/api';

export default function Page() {
  const router = useRouter();
  const [id, setId] = useState('');
  return (
    <main style={{ maxWidth: 560, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>LEDGER</h1>
      <p style={{ color: '#6b6255', marginTop: 4 }}>An agent that won&apos;t charge what it can&apos;t prove.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) router.push(`/units/${encodeURIComponent(id.trim())}`);
        }}
        style={{ display: 'flex', gap: 8, marginTop: 28 }}
      >
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="unit id, e.g. demo-1" style={{ flex: 1, padding: '10px 12px', border: '1px solid #d8d2c6', borderRadius: 8 }} />
        <button style={{ padding: '10px 18px', border: 0, borderRadius: 8, background: '#15130f', color: '#fff' }}>Open in 3D</button>
      </form>
      <a href="/owner/new" style={{ display: 'inline-block', marginTop: 18, padding: '12px 20px', borderRadius: 8, background: '#15130f', color: '#fff', textDecoration: 'none' }}>
        + New unit from a floor plan
      </a>
      <p style={{ color: '#8a8173', fontSize: 13 }}>
        Developer tools: <a href={API_URL}>API test page</a> · <a href="/lab">3D viewer lab</a>
      </p>
    </main>
  );
}

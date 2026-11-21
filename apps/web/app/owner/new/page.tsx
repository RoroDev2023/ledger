// [Alex] A3 owner flow: 1 upload the plan (Argon reads it) -> 2 check it, fix ceiling height and names -> 3 film
// the move-in walkthrough -> the unit page with the move-in record.
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { Header } from '../../../components/Header';
import { PlanReview } from '../../../components/PlanReview';
import { PlanUpload } from '../../../components/PlanUpload';
import { VideoUpload } from '../../../components/VideoUpload';
import { C, card, h1, page } from '../../../lib/ui';

const STEPS = ['Floor plan', 'Check the plan', 'Move-in video'];

export default function OwnerNew() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<FloorPlan | null>(null);

  return (
    <>
      <Header unitId={plan?.unitId} />
      <main style={page}>
        <h1 style={h1}>New unit</h1>
        <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '12px 0 20px' }}>
          {STEPS.map((s, i) => (
            <li key={s} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 14, background: i === step ? C.ink : i < step ? '#e7f6ec' : '#fff', color: i === step ? '#fff' : i < step ? C.green : C.muted, border: `1px solid ${i === step ? C.ink : C.line}` }}>
              {i < step ? '✓ ' : `${i + 1} · `}
              {s}
            </li>
          ))}
        </ol>
        <div style={card}>
          {step === 0 && (
            <PlanUpload
              onParsed={({ plan: p }) => {
                setPlan(p);
                setStep(1);
              }}
            />
          )}
          {step === 1 && plan && (
            <PlanReview
              plan={plan}
              onConfirmed={(p) => {
                setPlan(p);
                setStep(2);
              }}
            />
          )}
          {step === 2 && plan && <VideoUpload unitId={plan.unitId} kind="baseline" onDone={() => router.push(`/units/${plan.unitId}`)} />}
        </div>
        {step === 2 && plan && (
          <p style={{ color: C.muted, fontSize: 14 }}>
            No video yet? <a href={`/units/${plan.unitId}`}>Skip to the unit</a> and upload it later.
          </p>
        )}
      </main>
    </>
  );
}

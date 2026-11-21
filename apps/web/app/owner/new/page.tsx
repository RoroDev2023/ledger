// [Alex] A3 owner flow: 1 upload the plan (Argon reads it) -> 2 check it, fix ceiling height and names -> 3 film
// the move-in walkthrough -> the unit page with the move-in record.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FloorPlan } from '@ledger/shared';
import { Header } from '../../../components/Header';
import { EASE, Icon } from '../../../components/motion';
import { PlanReview } from '../../../components/PlanReview';
import { PlanUpload } from '../../../components/PlanUpload';
import { VideoUpload } from '../../../components/VideoUpload';

const STEPS = ['Floor plan', 'Review', 'Move-in video'];

export default function OwnerNew() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<FloorPlan | null>(null);

  return (
    <>
      <Header unitId={plan?.unitId} />
      <main className="page">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <div className="eyebrow">New unit</div>
          <h1 className="display" style={{ fontSize: 56, marginTop: 10 }}>
            Start with the <em>floor plan.</em>
          </h1>
        </motion.div>

        <ol style={{ display: 'flex', gap: 10, listStyle: 'none', padding: 0, margin: '30px 0 22px', position: 'relative' }}>
          {STEPS.map((s, i) => (
            <li key={s} style={{ position: 'relative', padding: '9px 16px 9px 12px', borderRadius: 999, fontSize: 14, display: 'flex', alignItems: 'center', gap: 9, color: i === step ? 'var(--paper)' : i < step ? 'var(--green)' : 'var(--muted)' }}>
              {i === step && <motion.span layoutId="step-pill" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--ink)', zIndex: -1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, background: i < step ? 'var(--green)' : i === step ? 'rgba(255,255,255,.14)' : 'var(--paper-2)', color: i < step ? '#fff' : 'inherit' }}>
                {i < step ? Icon.check : i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>

        <div className="card" style={{ padding: 28, overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.45, ease: EASE }}>
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
              {step === 2 && plan && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 28 }}>
                  <VideoUpload unitId={plan.unitId} kind="baseline" onDone={() => router.push(`/units/${plan.unitId}`)} />
                  <div>
                    <div className="eyebrow">Step 3</div>
                    <h2 className="h2" style={{ marginTop: 8 }}>
                      Move-in video
                    </h2>
                    <p className="muted" style={{ marginTop: 10 }}>
                      Walk through every room. Anything already damaged goes on the record for <b style={{ color: 'var(--ink)' }}>{plan.unitId}</b>, so it can&apos;t be charged later.
                    </p>
                    <p className="faint" style={{ fontSize: 14 }}>
                      No video yet? <a href={`/units/${plan.unitId}`}>Skip for now</a>.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}

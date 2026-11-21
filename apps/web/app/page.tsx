// [Alex] Landing: the pitch, a live 3D unit, how it works (which Gemini 4 model does what), and the proof rule.
'use client';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HERO } from '@ledger/viewer/samples';
import { Header } from '../components/Header';
import { CountUp, EASE, Icon, Reveal } from '../components/motion';
import { API_URL } from '../lib/api';

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), { ssr: false });

const STEPS = [
  {
    n: '01',
    title: 'Upload the floor plan',
    body: 'Any plan from a listing works. We turn it into a 3D model of the apartment.',
    model: 'Gemini 4 Argon',
  },
  {
    n: '02',
    title: 'Film move-in and move-out',
    body: 'Walk through with your phone. You don’t have to follow the same route twice.',
    model: 'Decisions API · Hydrogen',
  },
  {
    n: '03',
    title: 'Get the statement',
    body: 'Each charge comes with before and after photos. Moved furniture and normal wear stay free.',
    model: 'Gemini 4 Carbon',
  },
];

export default function Home() {
  const router = useRouter();
  const [id, setId] = useState('');
  const words = ['Move-out,'];

  return (
    <>
      <Header />
      <main>
        {/* Hero */}
        <section style={{ maxWidth: 1280, margin: '0 auto', padding: '56px 28px 40px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: 40, alignItems: 'center' }}>
          <div>
            <motion.div className="chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
              <span className="dot" style={{ color: 'var(--red)' }} /> For landlords and tenants in New York
            </motion.div>
            <h1 className="display" style={{ fontSize: 'clamp(48px, 6.4vw, 92px)', margin: '22px 0 0' }}>
              {words.map((w, i) => (
                <motion.span key={w} style={{ display: 'inline-block', marginRight: '0.22em' }} initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.08 }}>
                  {w}
                </motion.span>
              ))}
              <br />
              <motion.em style={{ display: 'inline-block' }} initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1, ease: EASE, delay: 0.5 }}>
                without the argument.
              </motion.em>
            </h1>
            <motion.p className="lede" style={{ marginTop: 26 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.8 }}>
              Film the apartment when a tenant moves in and again when they leave. LEDGER compares the two videos and writes the deposit statement, with photos for every charge.
            </motion.p>
            <motion.div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 1 }}>
              <Link href="/owner/new" className="btn btn-lg">
                Start with a floor plan {Icon.arrow}
              </Link>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (id.trim()) router.push(`/units/${encodeURIComponent(id.trim())}`);
                }}
                style={{ display: 'flex', gap: 8 }}
              >
                <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="Unit ID" style={{ width: 210, borderRadius: 999 }} />
                <button className="btn btn-ghost btn-lg" disabled={!id.trim()}>
                  Open
                </button>
              </form>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 1.2, ease: EASE, delay: 0.2 }} style={{ position: 'relative' }}>
            <div className="card" style={{ height: 520, padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
              <UnitModel plan={HERO.plan} items={HERO.items} autoRotate />
            </div>
            <motion.div className="card" style={{ position: 'absolute', left: -28, top: 36, padding: '14px 18px', width: 250 }} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 2.4 }}>
              <div className="eyebrow">Deposit statement</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  1 charge · 3 items free
                </span>
                <b className="display" style={{ fontSize: 32, color: 'var(--red)' }}>
                  $<CountUp value={72.72} format={(n) => n.toFixed(2)} />
                </b>
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* How it works */}
        <section style={{ maxWidth: 1180, margin: '0 auto', padding: '60px 28px 30px' }}>
          <Reveal>
            <div className="eyebrow">How it works</div>
            <h2 className="h2" style={{ marginTop: 10, maxWidth: 640 }}>
              Three steps, a few minutes.
            </h2>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 34 }}>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.12}>
                <motion.div className="card card-pad" whileHover={{ y: -4 }} transition={{ duration: 0.3, ease: EASE }} style={{ height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span className="display" style={{ fontSize: 44, color: 'var(--brass)' }}>
                      {s.n}
                    </span>
                    <span className="chip" style={{ fontSize: 11.5 }}>
                      {s.model}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 19, margin: '18px 0 8px', fontWeight: 600 }}>{s.title}</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    {s.body}
                  </p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* The rule */}
        <section style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 28px 90px' }}>
          <Reveal>
            <div className="card" style={{ padding: '44px 48px', background: 'var(--ink)', color: 'var(--paper)', border: 0, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 40, alignItems: 'center' }}>
              <div>
                <div className="eyebrow" style={{ color: '#b9ad99' }}>
                  The rule
                </div>
                <p className="display" style={{ fontSize: 52, marginTop: 14 }}>
                  If we can’t show it, <em style={{ color: '#e0b878' }}>you don’t pay for it.</em>
                </p>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {[
                  ['New damage, seen in two views', 'Charged', 'var(--red)'],
                  ['Already there at move-in', '$0', '#7ea3d6'],
                  ['Furniture moved', '$0', '#e0b04f'],
                  ['Not clear enough to prove', '$0', '#a990dc'],
                ].map(([k, v, c]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                    <span className="dot" style={{ color: c, width: 10, height: 10 }} />
                    <span style={{ flex: 1 }}>{k}</span>
                    <b className="mono" style={{ color: v === '$0' ? '#b9ad99' : '#ff8a73' }}>
                      {v}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <p className="faint" style={{ fontSize: 13, marginTop: 22, textAlign: 'center' }}>
            Statements are drafts for you to review, not legal advice · Developer tools: <a href={API_URL}>API test page</a> · <Link href="/lab">3D viewer lab</Link>
          </p>
        </section>
      </main>
    </>
  );
}

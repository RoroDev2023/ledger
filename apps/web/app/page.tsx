// [Alex] Landing: a big headline, a statement that prints itself next to the live 3D unit, how it works, the rule.
'use client';
import { motion, useScroll, useTransform } from 'motion/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { HERO } from '@ledger/viewer/samples';
import { Header } from '../components/Header';
import { CountUp, EASE, Icon, Reveal } from '../components/motion';
import { API_URL } from '../lib/api';

const UnitModel = dynamic(() => import('@ledger/viewer/UnitModel').then((m) => m.UnitModel), { ssr: false });

const LINES: [string, string, 'charge' | 'free'][] = [
  ['Hole in bedroom wall', '$72.72', 'charge'],
  ['Scuff by the kitchen door', '$0.00', 'free'],
  ['Sofa moved to the window', '$0.00', 'free'],
  ['Stain under the rug', '$0.00', 'free'],
];

const STEPS = [
  { n: '1', title: 'Drop in the floor plan', body: 'The one from the listing. You get a 3D model of the apartment in about a minute.' },
  { n: '2', title: 'Walk through with your phone', body: 'Once when the tenant moves in, once when they leave. Any route, any pace.' },
  { n: '3', title: 'Send the statement', body: 'Every charge has a before and after photo. Everything else is $0, with the reason why.' },
];

/** A headline line that slides up from behind a mask. */
function Line({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span style={{ display: 'block', overflow: 'hidden', paddingBottom: '0.06em' }}>
      <motion.span style={{ display: 'block' }} initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 1, ease: EASE, delay }}>
        {children}
      </motion.span>
    </span>
  );
}

function Receipt() {
  return (
    <motion.div className="receipt" initial={{ opacity: 0, y: -30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: -2 }} transition={{ duration: 0.9, ease: EASE, delay: 1.1 }} style={{ width: 300, padding: '22px 22px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>LEDGER</span>
        <span>APT 4B</span>
      </div>
      <div className="faint" style={{ marginTop: 4 }}>Deposit statement · due in 14 days</div>
      <div style={{ borderTop: '1px dashed var(--line-2)', margin: '14px 0 10px' }} />
      {LINES.map(([what, cost, kind], i) => (
        <motion.div key={what} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 1.7 + i * 0.35 }} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', color: kind === 'charge' ? 'var(--ink)' : 'var(--muted)' }}>
          <span>{what}</span>
          <span style={{ fontWeight: kind === 'charge' ? 700 : 400 }}>{cost}</span>
        </motion.div>
      ))}
      <div style={{ borderTop: '1px dashed var(--line-2)', margin: '10px 0' }} />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.2 }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, fontWeight: 700 }}>
        <span>TOTAL</span>
        <span style={{ color: 'var(--red)' }}>$72.72</span>
      </motion.div>
      <motion.div initial={{ opacity: 0, scale: 2.2, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 3.6 }} style={{ position: 'absolute', left: 92, bottom: 14 }}>
        <span className="stamp" style={{ color: 'var(--red)' }}>
          PHOTO PROOF
        </span>
      </motion.div>
    </motion.div>
  );
}

export default function Home() {
  const router = useRouter();
  const [id, setId] = useState('');
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const modelY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const receiptY = useTransform(scrollYProgress, [0, 1], [0, -60]);

  return (
    <>
      <Header />
      <main>
        <section ref={hero} style={{ maxWidth: 1320, margin: '0 auto', padding: '64px 28px 40px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 48, alignItems: 'center' }}>
          <div>
            <motion.div className="chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
              <span className="dot" style={{ color: 'var(--red)' }} /> New York gives landlords 14 days. This takes minutes.
            </motion.div>
            <h1 className="display" style={{ fontSize: 'clamp(50px, 6vw, 92px)', margin: '26px 0 0' }}>
              <Line delay={0.1}>Every dent.</Line>
              <Line delay={0.22}>
                <em>Proven</em> or free.
              </Line>
            </h1>
            <motion.p className="lede" style={{ marginTop: 28 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.6 }}>
              Film the apartment when the tenant moves in and again when they move out. LEDGER spots what changed and writes the deposit statement. No photo proof, no charge.
            </motion.p>
            <motion.div style={{ display: 'flex', gap: 10, marginTop: 34, flexWrap: 'wrap' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.8 }}>
              <Link href="/owner/new" className="btn btn-lg">
                Add an apartment {Icon.arrow}
              </Link>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (id.trim()) router.push(`/units/${encodeURIComponent(id.trim())}`);
                }}
                style={{ display: 'flex', gap: 8 }}
              >
                <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="Have an apartment ID?" style={{ width: 220 }} />
                <button className="btn btn-ghost btn-lg" disabled={!id.trim()}>
                  Open
                </button>
              </form>
            </motion.div>
          </div>

          <div style={{ position: 'relative' }}>
            <motion.div style={{ y: modelY }} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}>
              <div className="card" style={{ height: 540, padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', background: 'linear-gradient(180deg, #fff, #f1efe9)' }}>
                <UnitModel plan={HERO.plan} items={HERO.items} autoRotate />
              </div>
            </motion.div>
            {/* Decorative: tucked into the corner and click-through, so the 3D underneath stays draggable. */}
            <motion.div style={{ position: 'absolute', right: -50, top: -30, y: receiptY, scale: 0.82, transformOrigin: '100% 0%', pointerEvents: 'none' }}>
              <Receipt />
            </motion.div>
          </div>
        </section>

        {/* Strip */}
        <div className="marquee" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '18px 0', marginTop: 70, background: 'var(--card)' }}>
          <div>
            {[0, 1].flatMap((k) =>
              ['Floor plan to 3D in a minute', 'Two walkthroughs, any route', 'Two photo pairs per charge', 'Moved furniture is free', 'Already there? $0', 'Statement ready in 14 days or less'].map((t) => (
                <span key={`${k}-${t}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 48, font: '700 22px var(--display)', letterSpacing: '-0.03em' }}>
                  {t}
                  <span style={{ width: 10, height: 10, background: 'var(--red)', transform: 'rotate(45deg)', borderRadius: 2 }} />
                </span>
              )),
            )}
          </div>
        </div>

        {/* How it works */}
        <section style={{ maxWidth: 1180, margin: '0 auto', padding: '100px 28px 40px' }}>
          <Reveal>
            <h2 className="display" style={{ fontSize: 'clamp(40px, 5vw, 68px)', maxWidth: 760 }}>
              Three steps. <span style={{ color: 'var(--faint)' }}>No arguing about what was there before.</span>
            </h2>
          </Reveal>
          <div style={{ marginTop: 50, borderTop: '1px solid var(--ink)' }}>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <motion.div whileHover="hover" initial="rest" animate="rest" style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1.2fr', gap: 24, alignItems: 'baseline', padding: '30px 0', borderBottom: '1px solid var(--line-2)', cursor: 'default' }}>
                  <motion.span variants={{ rest: { color: 'var(--faint)' }, hover: { color: 'var(--red)' } }} className="display" style={{ fontSize: 64 }}>
                    {s.n}
                  </motion.span>
                  <motion.h3 variants={{ rest: { x: 0 }, hover: { x: 10 } }} transition={{ duration: 0.4, ease: EASE }} className="display" style={{ fontSize: 34, letterSpacing: '-0.035em' }}>
                    {s.title}
                  </motion.h3>
                  <p className="muted" style={{ margin: 0, fontSize: 18 }}>
                    {s.body}
                  </p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* The rule */}
        <section style={{ maxWidth: 1180, margin: '0 auto', padding: '60px 28px 100px' }}>
          <Reveal>
            <div style={{ borderRadius: 20, padding: '56px 56px', background: 'var(--ink)', color: '#fff', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 48, alignItems: 'center', overflow: 'hidden', position: 'relative' }}>
              <div>
                <div className="eyebrow" style={{ color: 'rgba(255,255,255,.55)' }}>The one rule</div>
                <p className="display" style={{ fontSize: 'clamp(40px, 4.6vw, 64px)', marginTop: 18 }}>
                  Two photos say it&apos;s new, <em>or it&apos;s free.</em>
                </p>
                <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 17, maxWidth: 440, marginTop: 20 }}>
                  A charge needs two separate before-and-after pairs of the same spot. One blurry frame isn&apos;t enough, so the tenant never pays for a guess.
                </p>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['New damage, shown twice', 'Charged', 'var(--red)'],
                  ['Already there at move-in', '$0', '#7d9bff'],
                  ['Furniture moved', '$0', '#f2a20c'],
                  ['Not clear enough', '$0', '#a98bff'],
                ].map(([k, v, c], i) => (
                  <motion.div key={k} initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: EASE, delay: 0.15 + i * 0.1 }} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                    <span style={{ flex: 1, fontSize: 16 }}>{k}</span>
                    <b className="mono" style={{ color: v === '$0' ? 'rgba(255,255,255,.5)' : 'var(--red)' }}>{v === 'Charged' ? <>$<CountUp value={72.72} format={(n) => n.toFixed(2)} /></> : v}</b>
                  </motion.div>
                ))}
              </div>
            </div>
          </Reveal>
          <p className="faint" style={{ fontSize: 13, marginTop: 26, textAlign: 'center' }}>
            Statements are drafts for you to check, not legal advice · Built at the Gemini 4 NYC hackathon · <a href={API_URL}>API</a> · <Link href="/lab">3D lab</Link>
          </p>
        </section>
      </main>
    </>
  );
}

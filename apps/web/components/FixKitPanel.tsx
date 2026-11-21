// [Rahim] "Find fixes on Shopify" on the statement page: builds the tenant's DIY fix kit (live feed), shows it
// against the deduction, then lets the cart agent fill each seller's real cart in a visible browser on the
// laptop running the API (one tab per seller, left open on /cart). Nothing is ever bought.
'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { api, type CartSummary, type FixKit, type JobEvent } from '../lib/api';
import { usd } from '../lib/ui';
import { CountUp, EASE, Icon } from './motion';

type Phase = 'idle' | 'kit' | 'carts' | 'done' | 'error';
interface Line {
  id: number;
  who: 'kit' | 'cart';
  step: string;
  text: string;
  screenshot?: string;
}

/** Runs one job to its end, feeding every fixkit/cart line to `onLine`. Resolves on done, rejects on error. */
function follow(jobId: string, onLine: (who: Line['who'], step: string, text: string, screenshot?: string) => void, onStats: (s: { calls: number; questions: number }) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    api.followJob(jobId, (e: JobEvent) => {
      if (e.type === 'fixkit') onLine('kit', e.event.step, e.text);
      else if (e.type === 'cart') onLine('cart', e.event.step, e.text, e.event.screenshot);
      else if (e.type === 'decisions') onStats(e.stats);
      else if (e.type === 'done') resolve();
      else if (e.type === 'error') reject(new Error(e.message));
    });
  });
}

export function FixKitPanel({ unitId }: { unitId: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [kit, setKit] = useState<FixKit | null>(null);
  const [carts, setCarts] = useState<CartSummary[] | null>(null);
  const [stats, setStats] = useState<{ calls: number; questions: number } | null>(null);
  const [error, setError] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  // A kit (and carts) from an earlier run stay visible after a reload.
  useEffect(() => {
    void (async () => {
      const [k, c] = await Promise.all([api.fixKit(unitId).catch(() => null), api.carts(unitId).catch(() => null)]);
      if (!k) return;
      setKit(k);
      if (c) setCarts(c.carts);
      setPhase((p) => (p === 'idle' ? 'done' : p));
    })();
  }, [unitId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  const push = (who: Line['who'], step: string, text: string, screenshot?: string) => setLines((l) => [...l, { id: nextId.current++, who, step, text, ...(screenshot ? { screenshot: api.apiUrl(screenshot) } : {}) }]);

  async function run() {
    setError('');
    setLines([]);
    setKit(null);
    setCarts(null);
    setStats(null);
    try {
      setPhase('kit');
      const { jobId } = await api.buildFixKit(unitId);
      await follow(jobId, push, setStats);
      const k = await api.fixKit(unitId);
      if (!k) throw new Error('the fix kit was not saved');
      setKit(k);
      if (!k.items.length) {
        setPhase('done');
        return;
      }
      // Let the kit land on screen, then the cart agent takes over.
      await new Promise((r) => setTimeout(r, 1200));
      setPhase('carts');
      const cart = await api.fillCarts(unitId);
      await follow(cart.jobId, push, () => {});
      setCarts((await api.carts(unitId))?.carts ?? []);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  const running = phase === 'kit' || phase === 'carts';
  const shots = lines.filter((l) => l.screenshot);
  const latestShot = shots[shots.length - 1];

  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="card card-pad" style={{ marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="eyebrow">For the tenant</div>
          <h2 className="h2" style={{ marginTop: 8 }}>
            Fix it <em style={{ fontStyle: 'italic', color: 'var(--brass)' }}>yourself</em>
          </h2>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            The agent finds the repair supplies on Shopify, then fills each seller&apos;s cart in a browser you can watch. It never checks out.
          </p>
        </div>
        <button type="button" className="btn btn-lg" onClick={() => void run()} disabled={running}>
          {running ? 'Working…' : kit ? 'Find fixes on Shopify again' : 'Find fixes on Shopify'}
          {!running && <span className="arrow">→</span>}
        </button>
      </div>

      {(lines.length > 0 || running) && (
        <div style={{ display: 'grid', gridTemplateColumns: latestShot ? 'minmax(0, 1fr) 320px' : '1fr', gap: 18, marginTop: 20 }}>
          <div>
            <div className="eyebrow" style={{ display: 'flex', gap: 10 }}>
              <span>{phase === 'kit' ? 'Finding products' : phase === 'carts' ? 'Filling carts' : 'Agent feed'}</span>
              {stats && (
                <span className="mono faint" style={{ letterSpacing: 0, textTransform: 'none' }}>
                  Decisions · {stats.calls} calls · {stats.questions} questions
                </span>
              )}
            </div>
            <div ref={feedRef} className="mono" style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', background: 'var(--paper)', borderRadius: 14, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.7 }}>
              <AnimatePresence initial={false}>
                {lines.map((l) => (
                  <motion.div key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} style={{ display: 'flex', gap: 10 }}>
                    <span style={{ color: l.who === 'kit' ? 'var(--brass)' : 'var(--blue)', minWidth: 34 }}>{l.who === 'kit' ? 'shop' : 'cart'}</span>
                    <span style={{ color: /failed|could not|missing|no product/.test(l.text) ? 'var(--red)' : l.step === 'cart-verified' || l.step === 'picked' ? 'var(--green)' : 'var(--ink-2)' }}>{l.text}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {running && (
                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }} className="faint">
                  …
                </motion.div>
              )}
            </div>
          </div>
          {latestShot && (
            <motion.figure key={latestShot.id} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} style={{ margin: 0 }}>
              <div className="eyebrow">What the agent sees</div>
              <img src={latestShot.screenshot} alt={latestShot.text} style={{ width: '100%', marginTop: 10, borderRadius: 12, border: '1px solid var(--line)' }} />
              <figcaption className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                {latestShot.text}
              </figcaption>
            </motion.figure>
          )}
        </div>
      )}

      {kit && <KitTable kit={kit} />}

      {phase === 'done' && carts && <CartList carts={carts} />}

      {phase === 'error' && (
        <p style={{ color: 'var(--red)', marginTop: 16 }}>
          Stopped: {error}
          {kit && !carts ? ' The kit above is still valid; try again to fill the carts.' : ''}
        </p>
      )}
    </motion.section>
  );
}

function KitTable({ kit }: { kit: FixKit }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} style={{ marginTop: 24 }}>
      <div style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: 16, padding: '20px 24px' }}>
        <div className="display" style={{ fontSize: 40 }}>
          Fix it yourself: <span style={{ color: '#9fd3a9' }}>$<CountUp value={kit.diyTotal} format={(n) => n.toFixed(2)} /></span>
          <span style={{ color: '#b9ad99' }}> vs </span>
          <span style={{ color: '#ff8a73' }}>$<CountUp value={kit.deductionTotal} format={(n) => n.toFixed(2)} /></span> deduction
        </div>
        <div style={{ fontSize: 13.5, color: '#b9ad99', marginTop: 6 }}>
          {kit.savings > 0 ? `${usd(kit.savings)} less than the deduction, before tax and shipping.` : 'Doing it yourself costs about the same as the deduction here.'}
        </div>
      </div>
      {kit.items.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          {kit.items.map((it) => (
            <div key={it.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 90px 90px', gap: 14, alignItems: 'baseline', padding: '11px 2px', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div className="faint" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {it.needLabel}
                </div>
                <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>
                  {it.product.title}
                </a>
                {it.variant.options.length > 0 && <span className="faint"> · {it.variant.options.join(', ')}</span>}
                <span className="mono faint" style={{ fontSize: 11.5, marginLeft: 8 }}>
                  {Math.round(it.confidence * 100)}%{it.needsChoice ? ' · unsure' : ''}
                </span>
              </div>
              <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.seller.name}
              </div>
              <div className="mono faint" style={{ textAlign: 'right' }}>
                {it.quantity} × {usd(it.price)}
              </div>
              <div className="mono" style={{ textAlign: 'right' }}>
                {usd(it.lineTotal)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 14 }}>
          No buyable product was found for these repairs.
        </p>
      )}
      {(kit.missing.length > 0 || kit.uncovered.length > 0) && (
        <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>
          Not in the kit: {[...kit.missing.map((m) => `${m.needLabel} (${m.reason})`), ...kit.uncovered.map((u) => `${u.surfaceId}${u.issueType ? ` ${u.issueType}` : ''} (${u.reason})`)].join(' · ')}
        </p>
      )}
    </motion.div>
  );
}

function CartList({ carts }: { carts: CartSummary[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h3 className="h2" style={{ fontSize: 26 }}>
          Carts filled
        </h3>
        <span className="faint">
          {carts.filter((c) => c.verified).length} of {carts.length} verified · nothing was bought · the tabs stay open in the agent&apos;s browser
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        {carts.map((c) => (
          <div key={c.shop} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', background: c.verified ? 'var(--green)' : 'var(--red)', color: '#fff', fontSize: 11 }}>{c.verified ? Icon.check : '!'}</span>
              <b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.seller}</b>
              <span className="mono">{c.verified || c.itemCount ? usd(c.subtotal) : ''}</span>
            </div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
              {c.lines.map((l) => `${l.title} ×${l.quantity}${l.error ? ' (not added)' : ''}`).join(' · ')}
            </div>
            {c.screenshot && (
              <img src={api.apiUrl(c.screenshot)} alt={`Cart at ${c.seller}`} style={{ width: '100%', marginTop: 10, borderRadius: 8, border: '1px solid var(--line)' }} />
            )}
            {c.error && (
              <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6 }}>
                {c.error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <a href={c.cartUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                Open cart
              </a>
              {!c.verified && c.fallbackUrl && (
                <a href={c.fallbackUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                  Shop checkout link
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

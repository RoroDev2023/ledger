// [Alex] A3 statement page: the itemized draft deposit statement with its evidence.
'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Finding, FloorPlan, Statement } from '@ledger/shared';
import { Header } from '../../../../components/Header';
import { FixKitPanel } from '../../../../components/FixKitPanel';
import { StatementView } from '../../../../components/StatementView';
import { api, type Proof } from '../../../../lib/api';
import { EASE, Skeleton } from '../../../../components/motion';
import { motion } from 'motion/react';

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ plan: FloorPlan; statement: Statement | null; findings: Finding[]; proofs: Proof[] } | null>(null);
  const [error, setError] = useState('');
  const [runToken, setRunToken] = useState(0);
  const [fixRunning, setFixRunning] = useState(false);
  const hasNewDamage = !!data?.statement?.items.some((i) => i.verdict === 'new-damage');
  useEffect(() => {
    void (async () => {
      try {
        const [unit, plan] = await Promise.all([api.unit(id), api.plan(id)]);
        const hasMoveOut = unit.walkthroughs.some((w) => w.kind === 'move-out');
        const [statement, moveOut, ev] = hasMoveOut ? await Promise.all([api.statement(id), api.findings(id, 'move-out'), api.evidence(id)]) : [null, null, null];
        setData({ plan, statement, findings: moveOut?.findings ?? [], proofs: ev?.evidence ?? [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  return (
    <>
      <Header unitId={id} />
      <main className="page">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} style={{ display: 'flex', alignItems: 'end', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Unit {id} · Draft for review</div>
            <h1 className="display" style={{ fontSize: 56, marginTop: 8 }}>
              Deposit <em>statement</em>
            </h1>
          </div>
          {data?.statement && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {hasNewDamage && (
                <button type="button" className="btn" onClick={() => setRunToken((t) => t + 1)} disabled={fixRunning}>
                  {fixRunning ? 'Finding fixes…' : 'Find fixes on Shopify'}
                </button>
              )}
              <a href={api.statementHtmlUrl(id)} target="_blank" rel="noreferrer" className="btn btn-ghost">
                Print
              </a>
            </div>
          )}
        </motion.div>
        {error && <p style={{ color: 'var(--red)' }}>Could not load unit “{id}”: {error}</p>}
        {!error && !data && (
          <div style={{ display: 'grid', gap: 14 }}>
            <Skeleton h={120} r={20} />
            <Skeleton h={180} r={20} />
            <Skeleton h={180} r={20} />
          </div>
        )}
        {data && !data.statement && (
          <div className="card card-pad">
            There’s no statement yet. <a href={`/units/${id}/moveout`}>Upload the move-out video</a> and it’s written for you.
          </div>
        )}
        {data?.statement && <StatementView statement={data.statement} plan={data.plan} findings={data.findings} proofs={data.proofs} />}
        {hasNewDamage && <FixKitPanel unitId={id} runToken={runToken} onRunningChange={setFixRunning} />}
      </main>
    </>
  );
}

// [Alex] A3 statement page: the itemized draft deposit statement with its evidence.
'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Finding, FloorPlan, Statement } from '@ledger/shared';
import { Header } from '../../../../components/Header';
import { FixKitPanel } from '../../../../components/FixKitPanel';
import { StatementView } from '../../../../components/StatementView';
import { api, type Proof } from '../../../../lib/api';
import { EASE } from '../../../../components/motion';
import { motion } from 'motion/react';

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ plan: FloorPlan; statement: Statement | null; findings: Finding[]; proofs: Proof[] } | null>(null);
  const [error, setError] = useState('');
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
            <div className="eyebrow">Unit {id} · Draft</div>
            <h1 className="display" style={{ fontSize: 56, marginTop: 8 }}>
              Itemized <em>statement</em>
            </h1>
          </div>
          {data?.statement && (
            <a href={api.statementHtmlUrl(id)} target="_blank" rel="noreferrer" className="btn btn-ghost">
              Printable version
            </a>
          )}
        </motion.div>
        {error && <p style={{ color: 'var(--red)' }}>Could not load unit “{id}”: {error}</p>}
        {!error && !data && <p className="muted">Loading…</p>}
        {data && !data.statement && (
          <div className="card card-pad">
            No statement yet. <a href={`/units/${id}/moveout`}>Upload the move-out video</a> to create it.
          </div>
        )}
        {data?.statement && <StatementView statement={data.statement} plan={data.plan} findings={data.findings} proofs={data.proofs} />}
        {data?.statement?.items.some((i) => i.verdict === 'new-damage') && <FixKitPanel unitId={id} />}
      </main>
    </>
  );
}

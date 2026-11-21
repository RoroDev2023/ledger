// [Alex] A3 statement page: the itemized draft deposit statement with its evidence.
'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Finding, FloorPlan, Statement } from '@ledger/shared';
import { Header } from '../../../../components/Header';
import { StatementView } from '../../../../components/StatementView';
import { api } from '../../../../lib/api';
import { C, btnGhost, card, h1, page } from '../../../../lib/ui';

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ plan: FloorPlan; statement: Statement | null; findings: Finding[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const [unit, plan] = await Promise.all([api.unit(id), api.plan(id)]);
        const hasMoveOut = unit.walkthroughs.some((w) => w.kind === 'move-out');
        const [statement, moveOut] = hasMoveOut ? await Promise.all([api.statement(id), api.findings(id, 'move-out')]) : [null, null];
        setData({ plan, statement, findings: moveOut?.findings ?? [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  return (
    <>
      <Header unitId={id} />
      <main style={page}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ ...h1, flex: 1 }}>Itemized deposit statement (draft)</h1>
          {data?.statement && (
            <a href={api.statementHtmlUrl(id)} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: 'none' }}>
              Printable version
            </a>
          )}
        </div>
        <p style={{ color: C.muted, marginTop: 0 }}>Unit {id}</p>
        {error && <p style={{ color: C.red }}>Could not load unit “{id}”: {error}</p>}
        {!error && !data && <p style={{ color: C.muted }}>Loading…</p>}
        {data && !data.statement && (
          <div style={card}>
            No statement yet: it is written after the move-out walkthrough. <a href={`/units/${id}/moveout`}>Upload the move-out video</a>.
          </div>
        )}
        {data?.statement && <StatementView statement={data.statement} plan={data.plan} findings={data.findings} />}
      </main>
    </>
  );
}

// [Alex] Top bar on every flow page.
import Link from 'next/link';
import { C } from '../lib/ui';

export function Header({ unitId }: { unitId?: string }) {
  const link = { color: C.muted, textDecoration: 'none', fontSize: 14 };
  return (
    <header style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: '14px 24px', borderBottom: `1px solid ${C.line}`, background: '#fff' }}>
      <Link href="/" style={{ fontWeight: 800, letterSpacing: '.08em', color: C.ink, textDecoration: 'none' }}>
        LEDGER
      </Link>
      <Link href="/owner/new" style={link}>
        New unit
      </Link>
      {unitId && (
        <>
          <span style={{ color: C.line }}>|</span>
          <Link href={`/units/${unitId}`} style={link}>
            {unitId}
          </Link>
          <Link href={`/units/${unitId}/moveout`} style={link}>
            Move-out
          </Link>
          <Link href={`/units/${unitId}/statement`} style={link}>
            Statement
          </Link>
        </>
      )}
    </header>
  );
}

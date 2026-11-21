// [Alex] Sticky, frosted top bar on every page.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header({ unitId }: { unitId?: string }) {
  const path = usePathname();
  const nav = (href: string, label: string) => (
    <Link href={href} className={`navlink${path === href ? ' on' : ''}`}>
      {label}
    </Link>
  );
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <i /> LEDGER
      </Link>
      <nav style={{ display: 'flex', gap: 20, alignItems: 'center', flex: 1 }}>
        {nav('/owner/new', 'New unit')}
        {unitId && (
          <>
            <span className="faint">/</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {unitId}
            </span>
            {nav(`/units/${unitId}`, 'Model')}
            {nav(`/units/${unitId}/moveout`, 'Move-out')}
            {nav(`/units/${unitId}/statement`, 'Statement')}
          </>
        )}
      </nav>
      <span className="chip">
        <span className="dot" style={{ color: 'var(--green)' }} /> Gemini 4
      </span>
    </header>
  );
}

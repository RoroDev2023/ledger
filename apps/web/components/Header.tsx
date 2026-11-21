// [Alex] Sticky, frosted top bar on every page.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header({ unitId, draftName }: { unitId?: string; draftName?: string }) {
  const path = usePathname();
  const nav = (href: string, label: string) => (
    <Link href={href} className={`navlink${path === href ? ' on' : ''}`}>
      {label}
    </Link>
  );
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true" style={{ flex: 'none' }}>
          <path d="M10 8 h11 v35 h35 v11 H10 Z" fill="var(--ink)" />
          <circle cx="35" cy="29" r="7.5" fill="var(--red)" />
        </svg>
        LEDGER
      </Link>
      <nav style={{ display: 'flex', gap: 20, alignItems: 'center', flex: 1 }}>
        {nav('/owner/new', 'Add an apartment')}
        {unitId && (
          <>
            <span className="faint">/</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {unitId}
            </span>
            {nav(`/units/${unitId}`, 'Apartment')}
            {nav(`/units/${unitId}/moveout`, 'Move-out')}
            {nav(`/units/${unitId}/statement`, 'Statement')}
          </>
        )}
        {!unitId && draftName && (
          <>
            <span className="faint">/</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {draftName}
            </span>
          </>
        )}
      </nav>
      <span className="chip">
        <span className="dot" style={{ color: 'var(--green)', boxShadow: '0 0 0 3px rgba(23,163,90,.18)' }} /> Running on Gemini
      </span>
    </header>
  );
}

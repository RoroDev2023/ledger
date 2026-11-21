// [Alex] Root layout.
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'LEDGER · condition record', description: 'Carfax for apartments' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

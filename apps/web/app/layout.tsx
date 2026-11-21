// [Alex] Root layout: fonts (self-hosted by next/font) and the global design system in globals.css.
// Bricolage Grotesque for headlines (characterful, heavy), Hanken Grotesk for reading, JetBrains Mono for money.
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', weight: ['400', '500', '600', '700', '800'] });
const sans = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata = { title: 'LEDGER · Deposit statements with proof', description: 'Film the apartment at move-in and move-out. LEDGER writes the deposit statement, with photos for every charge.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

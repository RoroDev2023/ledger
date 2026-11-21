// [Alex] Next.js config. The workspace packages ship TypeScript source, so Next compiles them too.
import type { NextConfig } from 'next';

const config: NextConfig = {
  // NEXT_DIST_DIR lets a production build run next to a running `next dev` without clobbering it.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@ledger/viewer', '@ledger/shared'],
  // Our agent rules live in the root AGENTS.md; don't let `next dev` write a second one into apps/web.
  agentRules: false,
  // Workspace packages use NodeNext-style imports ("./geometry.js" pointing at geometry.ts).
  webpack: (cfg: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
};
export default config;

// [Alex] Next.js config. The workspace packages ship TypeScript source, so Next compiles them too.
import type { NextConfig } from 'next';

const config: NextConfig = {
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

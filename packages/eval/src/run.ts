// pnpm eval -> eval/results.md. Real pairs land in data/pairs/<id>/ (git-ignored) with labels in data/labels/.
// Wired to the pipeline and the Neon baseline once R1-R5 exist; until then it reports what is missing.
import { existsSync, readdirSync } from 'node:fs';

const dir = 'data/labels';
const labels = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
console.log(labels.length ? `${labels.length} labelled pairs found` : 'No labelled pairs yet (data/labels/*.json). Nothing to score.');

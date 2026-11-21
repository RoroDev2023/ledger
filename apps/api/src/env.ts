// [Alex] Loads <repo>/.env into process.env (Node's built-in loader) if the file exists. Variables already set in
// the shell win, so `GEMINI_MODE=mock pnpm ... dev` still overrides the file. Import this first.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(file)) {
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}

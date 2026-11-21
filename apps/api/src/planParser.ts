// [Alex] Real plan parsing for the API: plan file -> image -> Elmir's parsePlan (Argon reads, code builds).
// PDFs are rasterized here first with pdftoppm, or macOS's built-in `sips` when poppler isn't installed, so
// parsePlan always gets a PNG.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parsePlan, type PlanModel } from '@ledger/plan';
import type { FloorPlan } from '@ledger/shared';

const has = (cmd: string) => {
  try {
    execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** First page of a PDF as a PNG path (200 dpi). Images pass through unchanged. */
export function planImagePath(path: string): string {
  if (extname(path).toLowerCase() !== '.pdf') return path;
  const dir = mkdtempSync(join(tmpdir(), 'ledger-plan-'));
  if (has('pdftoppm')) {
    execFileSync('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', '1', '-singlefile', path, join(dir, 'page')]);
  } else if (process.platform === 'darwin' && existsSync('/usr/bin/sips')) {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-s', 'dpiWidth', '200', '-s', 'dpiHeight', '200', path, '--out', join(dir, 'page.png')], { stdio: 'ignore' });
  } else {
    throw new Error('Cannot read PDF plans: install poppler (pdftoppm), or upload a PNG/JPG instead.');
  }
  const png = readdirSync(dir).find((f) => f.endsWith('.png'));
  if (!png) throw new Error('PDF conversion produced no image');
  return join(dir, png);
}

/** parsePlan for the PipelineAdapter, using a Gemini client (live, record or replay). */
export function argonPlanParser(model: PlanModel) {
  return async ({ unitId, filePath }: { unitId: string; filePath: string }): Promise<FloorPlan> => parsePlan(planImagePath(filePath), model, { unitId });
}

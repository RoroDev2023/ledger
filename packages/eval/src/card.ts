// pnpm --filter @ledger/eval card <pairId> [--split test|dev] [--new <surfaceId>:<issue>]... [--old <surfaceId>:<issue>]...
//                                   [--moved <object>[:<fromSurfaceId>[:<toSurfaceId>]]]... [--clean]
// Types a filled-in judge card into data/labels/<pairId>.json (the format `pnpm eval` reads), without opening label.html.
// Example: card test-03 --new room-1.wall-n:scuff --moved bag:room-1.wall-e
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IssueTypeSchema, type IssueType } from '@ledger/shared';
import type { PairLabel } from './metrics.js';
import { pairPlan } from './plan-source.js';

const ALIASES: Record<string, IssueType> = { scratch: 'scuff', scuff: 'scuff', mark: 'scuff', tape: 'other', sticker: 'stain', missing: 'missing-fixture' };

export function parseIssue(s: string): IssueType {
  const k = s.trim().toLowerCase();
  const hit = ALIASES[k] ?? IssueTypeSchema.safeParse(k).data;
  if (!hit) throw new Error(`unknown issue type "${s}" (use ${IssueTypeSchema.options.join(', ')}; scratch = scuff)`);
  return hit;
}

export function parseCard(pairId: string, argv: string[]): PairLabel {
  const label: PairLabel = { pairId, split: 'test', newDamage: [], preExisting: [], moved: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = (): string => {
      const x = argv[++i];
      if (!x) throw new Error(`${a} needs a value`);
      return x;
    };
    const surf = (x: string) => {
      const j = x.lastIndexOf(':');
      if (j < 1) throw new Error(`expected <surfaceId>:<issue>, got "${x}"`);
      return { surfaceId: x.slice(0, j), issueType: parseIssue(x.slice(j + 1)) };
    };
    if (a === '--split') {
      const s = v();
      if (s !== 'test' && s !== 'dev') throw new Error('--split must be test or dev');
      label.split = s;
    } else if (a === '--new') label.newDamage.push(surf(v()));
    else if (a === '--old') label.preExisting.push(surf(v()));
    else if (a === '--moved') {
      const [object, fromSurfaceId, toSurfaceId] = v().split(':');
      label.moved.push({ object: object!, ...(fromSurfaceId ? { fromSurfaceId } : {}), ...(toSurfaceId ? { toSurfaceId } : {}) });
    } else if (a === '--clean') label.cleanReshoot = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (label.cleanReshoot && (label.newDamage.length || label.moved.length)) throw new Error('--clean means nothing changed; drop --new/--moved');
  if (!label.cleanReshoot && !label.newDamage.length && !label.moved.length) throw new Error('card is empty: add --new / --moved, or --clean');
  return label;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const [pairId, ...rest] = process.argv.slice(2);
  if (!pairId) {
    console.log('usage: card <pairId> [--split test|dev] [--new <surfaceId>:<issue>]... [--moved <object>[:<from>[:<to>]]]... [--clean]');
    process.exit(1);
  }
  const root = resolve(import.meta.dirname, '..', '..', '..');
  try {
    const label = parseCard(pairId, rest);
    const plan = pairPlan(join(root, 'data', 'pairs', pairId), pairId);
    if (plan) {
      const ids = new Set(plan.surfaces.map((s) => s.id));
      const bad = [...label.newDamage, ...label.preExisting].map((x) => x.surfaceId).concat(label.moved.flatMap((m) => [m.fromSurfaceId, m.toSurfaceId].filter((x): x is string => !!x))).filter((id) => !ids.has(id));
      if (bad.length) throw new Error(`not in this pair's plan: ${bad.join(', ')} (walls: ${[...ids].join(', ')})`);
    } else console.warn(`warning: no plan in data/pairs/${pairId}/, surface ids not checked`);
    const dir = join(root, 'data', 'labels');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${pairId}.json`);
    if (existsSync(path)) console.warn(`overwriting ${path}`);
    writeFileSync(path, `${JSON.stringify(label, null, 2)}\n`);
    console.log(`wrote ${path}`);
  } catch (e) {
    console.error(`card: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

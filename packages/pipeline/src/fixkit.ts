// [Rahim] Tenant "fix kit" (Shopify bonus). For each proven new-damage DiffItem:
//   a. deterministic rules (fixkit-rules.json): issue type -> repair needs, quantity from area
//   b. Hydrogen looks at the damage frame + need -> one precise search query (+ color / finish hint)
//   c. Shop MCP search_catalog (US, USD, price cap per need, limit 10, buyable items only)
//   d. Decisions API `choice` over the real candidates -> pick + confidence (< 0.5: keep the top 2)
//   e. group picks by seller -> one create_checkout per seller -> continue_url. Never complete_checkout.
//   f. FixKit with DIY total vs deduction total. Every dollar here is integer-cent code math.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { decide, generate, modelId, type Content, type ImageContent } from '@ledger/gemini';
import { shopClient, type SearchDoc, type ShopClient } from '@ledger/shop';
import { IssueTypeSchema, type DiffItem, type FloorPlan, type Frame, type IssueType, type Surface } from '@ledger/shared';
import { surfaceAreaM2 } from './price.js';
import { isCharged } from './statement.js';

// ---------------------------------------------------------------------------------------------
// a. Rules

export const FIXKIT_RULES_PATH = join(import.meta.dirname, '..', 'fixkit-rules.json');

export const NeedRuleSchema = z
  .object({
    label: z.string().min(1),
    /** Used when Hydrogen fails or its query finds nothing. */
    defaultQuery: z.string().min(3),
    /** Per-unit cap passed to search_catalog (filters.price.max, USD) and re-checked in code. */
    maxPriceUsd: z.number().positive(),
    /** Units = ceil(areaM2 / coverage), clamped to [1, maxUnits]. */
    coverageM2PerUnit: z.number().positive().optional(),
    maxUnits: z.number().int().positive().optional(),
    /** Or a fixed count (tools, one bottle of cleaner). */
    fixedQuantity: z.number().int().positive().optional(),
    /** Hydrogen's color/finish hint matters for this need (paint, surface cleaners). */
    usesHint: z.boolean().default(false),
  })
  .refine((n) => (n.coverageM2PerUnit === undefined) !== (n.fixedQuantity === undefined), {
    message: 'a need has exactly one of coverageM2PerUnit or fixedQuantity',
  });
export type NeedRule = z.infer<typeof NeedRuleSchema>;

const NeedListSchema = z.array(z.string().min(1));

export const FixKitRulesSchema = z
  .object({
    _note: z.string().optional(),
    context: z.object({ country: z.string().regex(/^[A-Z]{2}$/), currency: z.literal('USD') }),
    searchLimit: z.number().int().min(1).max(50).default(10),
    /** Below this Decisions confidence the kit keeps the top 2 for the tenant to choose. */
    lowConfidence: z.number().min(0).max(1).default(0.5),
    needs: z.record(z.string(), NeedRuleSchema),
    issues: z.object(Object.fromEntries(IssueTypeSchema.options.map((t) => [t, NeedListSchema])) as Record<IssueType, typeof NeedListSchema>),
    kindOverrides: z.record(z.string(), z.record(z.string(), NeedListSchema)).default({}),
  })
  .superRefine((r, ctx) => {
    const check = (where: string, keys: string[]) => {
      for (const k of keys) if (!(k in r.needs)) ctx.addIssue({ code: 'custom', message: `${where}: unknown need "${k}"` });
    };
    for (const [t, keys] of Object.entries(r.issues)) check(`issues.${t}`, keys);
    for (const [kind, m] of Object.entries(r.kindOverrides)) {
      for (const [t, keys] of Object.entries(m)) {
        if (!IssueTypeSchema.safeParse(t).success) ctx.addIssue({ code: 'custom', message: `kindOverrides.${kind}: unknown issue type "${t}"` });
        check(`kindOverrides.${kind}.${t}`, keys);
      }
    }
  });
export type FixKitRules = z.infer<typeof FixKitRulesSchema>;

let defaultRules: FixKitRules | undefined;
export function loadFixKitRules(path?: string): FixKitRules {
  if (!path && defaultRules) return defaultRules;
  const r = FixKitRulesSchema.parse(JSON.parse(readFileSync(path ?? FIXKIT_RULES_PATH, 'utf8')));
  if (!path) defaultRules = r;
  return r;
}

export function needQuantity(need: NeedRule, areaM2: number | undefined): { quantity: number; warning?: string } {
  if (need.fixedQuantity !== undefined) return { quantity: need.fixedQuantity };
  if (areaM2 === undefined || !(areaM2 > 0)) return { quantity: 1, warning: `${need.label}: area unknown, quantity 1` };
  const raw = Math.ceil(areaM2 / need.coverageM2PerUnit! - 1e-9);
  return { quantity: Math.min(Math.max(1, raw), need.maxUnits ?? Number.MAX_SAFE_INTEGER) };
}

/** One repair need for one DiffItem. */
export interface PlannedNeed {
  /** "<surfaceId>:<issueType>:<needKey>", unique within a kit. */
  key: string;
  needKey: string;
  need: NeedRule;
  quantity: number;
  diffItem: DiffItem;
  surface?: Surface;
  areaM2?: number;
}

export interface Uncovered {
  surfaceId: string;
  issueType?: IssueType;
  reason: string;
}

/** Deterministic mapping: new-damage DiffItems -> needs. Every other verdict is ignored. */
export function planNeeds(diffItems: DiffItem[], plan: FloorPlan, rules: FixKitRules): { needs: PlannedNeed[]; uncovered: Uncovered[]; warnings: string[] } {
  const needs: PlannedNeed[] = [];
  const uncovered: Uncovered[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const d of diffItems) {
    if (d.verdict !== 'new-damage') continue;
    if (!d.issueType) {
      uncovered.push({ surfaceId: d.surfaceId, reason: 'no issue type on this item' });
      continue;
    }
    const surface = plan.surfaces.find((s) => s.id === d.surfaceId);
    let keys = (surface && rules.kindOverrides[surface.kind]?.[d.issueType]) ?? rules.issues[d.issueType] ?? [];
    if (!keys.length) {
      // Generic fallback: an issue type without its own rule uses the "other" needs, so a charged item never gets an empty kit.
      const generic = d.issueType === 'other' ? [] : rules.issues.other;
      if (!generic.length) {
        uncovered.push({ surfaceId: d.surfaceId, issueType: d.issueType, reason: `no DIY repair rule for "${d.issueType}"` });
        continue;
      }
      warnings.push(`${d.surfaceId}: no DIY repair rule for "${d.issueType}", used the generic "other" kit`);
      keys = generic;
    }
    const areaM2 = d.areaM2 ?? surfaceAreaM2(plan, d.surfaceId);
    for (const needKey of keys) {
      const need = rules.needs[needKey]!;
      const q = needQuantity(need, areaM2);
      if (q.warning) warnings.push(`${d.surfaceId}: ${q.warning}`);
      let key = `${d.surfaceId}:${d.issueType}:${needKey}`;
      for (let i = 2; seen.has(key); i++) key = `${d.surfaceId}:${d.issueType}:${needKey}#${i}`;
      seen.add(key);
      needs.push({ key, needKey, need, quantity: q.quantity, diffItem: d, ...(surface ? { surface } : {}), ...(areaM2 !== undefined ? { areaM2 } : {}) });
    }
  }
  return { needs, uncovered, warnings };
}

// ---------------------------------------------------------------------------------------------
// b. Query (Hydrogen)

export const FINISHES = ['flat', 'matte', 'eggshell', 'satin', 'semi-gloss', 'gloss', 'unknown'] as const;

export const FixQuerySchema = z.object({
  query: z.string().trim().min(3).max(100),
  colorHint: z.string().trim().max(40).optional(),
  finish: z.enum(FINISHES).optional(),
});
export type FixQuery = z.infer<typeof FixQuerySchema>;

export interface NeedContext extends PlannedNeed {
  /** The move-out damage frame, when we have its pixels. */
  image?: ImageContent;
}

export type QueryWriter = (ctx: NeedContext) => Promise<FixQuery>;

const ISSUE_WORDS: Record<IssueType, string> = {
  crack: 'a crack',
  stain: 'a stain',
  hole: 'a hole',
  scuff: 'scuff marks',
  'missing-fixture': 'a missing fixture',
  other: 'damage',
};

function where(ctx: PlannedNeed): string {
  const s = ctx.surface;
  if (!s) return `surface ${ctx.diffItem.surfaceId}`;
  const lm = s.landmarks?.length ? ` (near: ${s.landmarks.join(', ')})` : '';
  return `${s.label || s.id} (${s.kind})${lm}`;
}

export function queryPrompt(ctx: NeedContext): string {
  const issue = ISSUE_WORDS[ctx.diffItem.issueType ?? 'other'];
  return [
    'A tenant wants to repair damage in their apartment themselves before moving out.',
    `${ctx.image ? 'The photo shows' : 'The move-out inspection found'} ${issue} on the ${where(ctx)}.`,
    `They need: ${ctx.need.label} (quantity ${ctx.quantity}). A generic example search is "${ctx.need.defaultQuery}".`,
    ctx.diffItem.issueType === 'missing-fixture' ? 'Look at the photo to tell what kind of fixture is missing (e.g. cabinet knob, outlet cover, towel bar) and search for that.' : '',
    'Write ONE precise product search query for an online catalog: 3 to 8 plain shopper words, no prices, no store names, no brand unless one is clearly visible.',
    ctx.need.usesHint
      ? 'Also set colorHint to the visible wall or floor color in plain words (e.g. "warm white", "light gray") and finish to the visible sheen, or "unknown".'
      : 'Leave colorHint and finish out.',
    'Return JSON {"query": "...", "colorHint": "...", "finish": "..."}.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Hydrogen (MODEL_FAST) writes the query. Tag `fixkit.query.<needKey>` (mock fixtures per need). */
export function hydrogenQueryWriter(opts: { env?: NodeJS.ProcessEnv } = {}): QueryWriter {
  return async (ctx) => {
    const env = opts.env ?? process.env;
    const parts: Content[] = [{ type: 'text', text: queryPrompt(ctx) }];
    if (ctx.image) parts.push(ctx.image);
    return generate({ model: modelId('fast', env), parts, schema: FixQuerySchema, tag: `fixkit.query.${ctx.needKey}`, env });
  };
}

// ---------------------------------------------------------------------------------------------
// c. Candidates from search_catalog

export interface Candidate {
  productId: string;
  title: string;
  variantId: string;
  /** e.g. ["Size: Quart", "Color: White"] */
  variantOptions: string[];
  priceCents: number;
  seller: { name: string; domain: string };
  /** Variant URL exactly as returned (query string included). */
  url: string;
}

/**
 * Buyable USD variants at or under the cap, deduped by variant ID. Code re-checks what the filters asked
 * for: shop-search.md warns a price cap may be applied on a converted basis.
 */
export function candidatesFrom(doc: SearchDoc, capCents: number, currency: string): Candidate[] {
  const out: Candidate[] = [];
  const ids = new Set<string>();
  for (const p of doc.products) {
    for (const v of p.variants) {
      if (ids.has(v.id) || v.availability?.available !== true) continue;
      if (v.price.currency !== currency || v.price.amount > capCents || v.price.amount <= 0) continue;
      if (!v.seller?.domain || !v.url) continue;
      ids.add(v.id);
      out.push({
        productId: p.id,
        title: p.title,
        variantId: v.id,
        variantOptions: (v.options ?? []).filter((o) => !(o.name === 'Title' && o.label === 'Default Title')).map((o) => `${o.name}: ${o.label}`),
        priceCents: v.price.amount,
        seller: { name: v.seller.name, domain: v.seller.domain },
        url: v.url,
      });
    }
  }
  return out;
}

export const usdFromCents = (c: number) => Math.round(c) / 100;
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Option text for the Decisions choice: title + price + seller + key options. */
export function candidateOptionText(c: Candidate): string {
  const opts = c.variantOptions.length ? ` · ${c.variantOptions.slice(0, 3).join(', ')}` : '';
  return `"${c.title}" · ${fmt(c.priceCents)} · sold by ${c.seller.name}${opts}`.slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// d. Pick (Decisions API)

export interface PickResult {
  /** Index into the candidates. */
  index: number;
  confidence: number;
  /** Probability per candidate index. */
  probabilities: number[];
}
export type ProductPicker = (ctx: NeedContext & { query: FixQuery; candidates: Candidate[] }) => Promise<PickResult>;

export function decisionsProductPicker(opts: { env?: NodeJS.ProcessEnv; decideFn?: typeof decide } = {}): ProductPicker {
  const decideFn = opts.decideFn ?? decide;
  return async (ctx) => {
    const keys = ctx.candidates.map((_, i) => `c${i}`);
    const hint = [ctx.query.colorHint && `color ${ctx.query.colorHint}`, ctx.query.finish && ctx.query.finish !== 'unknown' && `${ctx.query.finish} finish`].filter(Boolean).join(', ');
    const input: Content[] = [
      {
        type: 'text',
        text: `Repair job: ${ISSUE_WORDS[ctx.diffItem.issueType ?? 'other']} on the ${where(ctx)}. Needed item: ${ctx.need.label}, quantity ${ctx.quantity}${hint ? ` (${hint})` : ''}.`,
      },
    ];
    if (ctx.image) input.push({ type: 'text', text: 'Photo of the damage:' }, ctx.image);
    const { answers } = await decideFn({
      input,
      questions: {
        pick: {
          type: 'choice',
          instructions: `Which product is the best fit for a tenant to buy for this repair: "${ctx.need.label}"? Choose the item that is exactly this kind of product and suits the damage shown${hint ? ` (${hint})` : ''}. Price matters less than fit.`,
          criteria: Object.fromEntries(keys.map((k, i) => [k, candidateOptionText(ctx.candidates[i]!)])),
        },
      },
      tag: 'fixkit.pick',
      ...(opts.env ? { env: opts.env } : {}),
    });
    const a = answers.pick;
    const probabilities = keys.map((k) => a.probabilities[k] ?? 0);
    return { index: keys.indexOf(a.choice), confidence: a.confidence, probabilities };
  };
}

// ---------------------------------------------------------------------------------------------
// f. Output

const PickedProductSchema = z.object({
  product: z.object({ id: z.string(), title: z.string() }),
  variant: z.object({ id: z.string(), options: z.array(z.string()) }),
  /** Unit price, USD. */
  price: z.number().nonnegative(),
  seller: z.object({ name: z.string(), domain: z.string() }),
  url: z.string(),
});

export const FixKitItemSchema = PickedProductSchema.extend({
  key: z.string(),
  need: z.string(),
  needLabel: z.string(),
  quantity: z.number().int().positive(),
  /** price × quantity, USD (cent math). */
  lineTotal: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  pickedBy: z.enum(['decisions', 'only-candidate', 'search-rank', 'user']),
  /** Decisions was unsure (< lowConfidence): the tenant should choose between this and `alternatives`. */
  needsChoice: z.boolean(),
  alternatives: z.array(PickedProductSchema.extend({ probability: z.number().min(0).max(1) })),
  query: z.string(),
  colorHint: z.string().optional(),
  finish: z.enum(FINISHES).optional(),
  /** get_product re-read the picked variant and it is still buyable at this price. */
  confirmed: z.boolean(),
  forDiffItem: z.object({ surfaceId: z.string(), issueType: IssueTypeSchema, deductionUsd: z.number().nonnegative() }),
});
export type FixKitItem = z.infer<typeof FixKitItemSchema>;

export const FixKitCheckoutSchema = z.object({
  seller: z.string(),
  shop: z.string(),
  /** Merchant page where the tenant reviews and pays. Sensitive (carries an access key): never logged. */
  continue_url: z.string().optional(),
  status: z.string().optional(),
  /** Our code's subtotal of these lines (USD), before the merchant adds tax and delivery. */
  subtotal: z.number().nonnegative(),
  lines: z.array(z.object({ key: z.string(), variantId: z.string(), title: z.string(), quantity: z.number().int().positive(), lineTotal: z.number().nonnegative() })),
  messages: z.array(z.string()),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
});
export type FixKitCheckout = z.infer<typeof FixKitCheckoutSchema>;

export const FixKitSchema = z.object({
  unitId: z.string().optional(),
  createdAt: z.string(),
  items: z.array(FixKitItemSchema),
  checkouts: z.array(FixKitCheckoutSchema),
  /** Needs with no buyable product under the cap. */
  missing: z.array(z.object({ key: z.string(), need: z.string(), needLabel: z.string(), surfaceId: z.string(), issueType: IssueTypeSchema, reason: z.string() })),
  /** New-damage items with no DIY rule (e.g. "other"). */
  uncovered: z.array(z.object({ surfaceId: z.string(), issueType: IssueTypeSchema.optional(), reason: z.string() })),
  warnings: z.array(z.string()),
  /** Σ lineTotal, USD. */
  diyTotal: z.number().nonnegative(),
  /** Σ charged items on the statement, USD (same total as the statement). */
  deductionTotal: z.number().nonnegative(),
  /** deductionTotal − diyTotal (negative when DIY costs more). */
  savings: z.number(),
  /** Every need found a product and every new-damage item had a rule. */
  complete: z.boolean(),
});
export type FixKit = z.infer<typeof FixKitSchema>;

// ---------------------------------------------------------------------------------------------
// Progress events (apps/api streams them over SSE)

export type FixKitEvent = { done: number; total: number } & (
  | { step: 'rules'; diffItems: number; needs: number; uncovered: number }
  | { step: 'query'; key: string; need: string; query: string; colorHint?: string; finish?: string; fallback: boolean }
  | { step: 'searching'; key: string; need: string; query: string }
  | { step: 'picked'; key: string; need: string; product: string; seller: string; price: number; confidence: number; needsChoice: boolean; candidates: number }
  | { step: 'missing'; key: string; need: string; reason: string }
  | { step: 'checkout'; seller: string; shop: string; lines: number }
  | { step: 'checkout-ready'; seller: string; shop: string; ok: boolean; subtotal: number; status?: string; error?: string }
  | { step: 'done'; diyTotal: number; deductionTotal: number; savings: number; complete: boolean }
);
export type OnFixKitEvent = (e: FixKitEvent) => void;

/** One-line text for a live feed, e.g. "picked “Touch Up Paint” from Paint Co · $12.99 (82%)". */
export function describeFixKitEvent(e: FixKitEvent): string {
  switch (e.step) {
    case 'rules':
      return `rules: ${e.needs} repair need(s) for ${e.diffItems} new-damage item(s)${e.uncovered ? `, ${e.uncovered} without a DIY rule` : ''}`;
    case 'query':
      return `query written for ${e.need}: “${e.query}”${e.colorHint ? ` (${e.colorHint}${e.finish && e.finish !== 'unknown' ? `, ${e.finish}` : ''})` : ''}${e.fallback ? ' [default]' : ''}`;
    case 'searching':
      return `searching Shop for “${e.query}”`;
    case 'picked':
      return `picked “${e.product}” from ${e.seller} · $${e.price.toFixed(2)} (${Math.round(e.confidence * 100)}%)${e.needsChoice ? ' · unsure, top 2 kept' : ''}`;
    case 'missing':
      return `no product for ${e.need}: ${e.reason}`;
    case 'checkout':
      return `building checkout for ${e.seller} (${e.lines} item${e.lines === 1 ? '' : 's'})`;
    case 'checkout-ready':
      return e.ok ? `checkout ready at ${e.seller} · $${e.subtotal.toFixed(2)}` : `checkout failed at ${e.seller}: ${e.error ?? 'unknown error'}`;
    case 'done':
      return `fix kit: $${e.diyTotal.toFixed(2)} DIY vs $${e.deductionTotal.toFixed(2)} deduction`;
  }
}

// ---------------------------------------------------------------------------------------------
// e. Checkouts

type Emit = (e: FixKitEvent) => void;
/** Distributes Omit over the event union so callers can leave out the counters. */
type EventBody = FixKitEvent extends infer E ? (E extends FixKitEvent ? Omit<E, 'done' | 'total'> : never) : never;

/** Group by seller.domain, merge identical variants, create one checkout per seller. Never completes one. */
export async function createCheckouts(items: FixKitItem[], shop: ShopClient, country: string, emit: (e: EventBody) => void = () => {}): Promise<FixKitCheckout[]> {
  const bySeller = new Map<string, { seller: string; lines: Map<string, FixKitCheckout['lines'][number] & { cents: number }> }>();
  for (const it of items) {
    let g = bySeller.get(it.seller.domain);
    if (!g) bySeller.set(it.seller.domain, (g = { seller: it.seller.name, lines: new Map() }));
    const cents = Math.round(it.price * 100) * it.quantity;
    const line = g.lines.get(it.variant.id);
    if (line) {
      line.quantity += it.quantity;
      line.cents += cents;
      line.key += `,${it.key}`;
    } else {
      g.lines.set(it.variant.id, { key: it.key, variantId: it.variant.id, title: it.product.title, quantity: it.quantity, lineTotal: 0, cents });
    }
  }
  const out: FixKitCheckout[] = [];
  for (const [domain, g] of [...bySeller].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = [...g.lines.values()].map(({ cents, ...l }) => ({ ...l, lineTotal: usdFromCents(cents) }));
    const subtotalCents = [...g.lines.values()].reduce((s, l) => s + l.cents, 0);
    emit({ step: 'checkout', seller: g.seller, shop: domain, lines: lines.length });
    const base = { seller: g.seller, shop: domain, subtotal: usdFromCents(subtotalCents), lines };
    try {
      const doc = await shop.createCheckout({ shop: domain, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), country });
      const messages = doc.messages.filter((m) => m.type === 'warning' || m.type === 'error').map((m) => m.content ?? m.code ?? m.type);
      const co: FixKitCheckout = {
        ...base,
        status: doc.status,
        messages,
        ...(doc.continue_url ? { continue_url: doc.continue_url } : { error: 'merchant returned no continue_url' }),
        ...(doc.expires_at ? { expiresAt: doc.expires_at } : {}),
      };
      out.push(co);
      emit({ step: 'checkout-ready', seller: g.seller, shop: domain, ok: !co.error, subtotal: co.subtotal, status: doc.status, ...(co.error ? { error: co.error } : {}) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      out.push({ ...base, messages: [], error });
      emit({ step: 'checkout-ready', seller: g.seller, shop: domain, ok: false, subtotal: base.subtotal, error });
    }
  }
  return out;
}

/** Σ charged items in integer cents: the same rule and rounding as the statement total (statement.ts). */
export function chargedDeductionCents(diffItems: DiffItem[]): number {
  return diffItems.filter(isCharged).reduce((s, d) => s + Math.round((d.costUsd ?? 0) * 100), 0);
}

/**
 * Totals in integer cents. Deduction = the statement's charged total when given (so the comparison matches the
 * statement even when some items found no product); otherwise the charged cost of each DiffItem the kit has a product for.
 */
export function kitTotals(items: FixKitItem[], deductionCents?: number): { diyTotal: number; deductionTotal: number; savings: number } {
  const diy = items.reduce((s, it) => s + Math.round(it.price * 100) * it.quantity, 0);
  const ded = new Map<string, number>();
  for (const it of items) ded.set(`${it.forDiffItem.surfaceId}|${it.forDiffItem.issueType}`, Math.round(it.forDiffItem.deductionUsd * 100));
  const deduction = deductionCents ?? [...ded.values()].reduce((s, c) => s + c, 0);
  return { diyTotal: usdFromCents(diy), deductionTotal: usdFromCents(deduction), savings: usdFromCents(deduction - diy) };
}

// ---------------------------------------------------------------------------------------------
// buildFixKit

export interface FixKitDeps {
  writeQuery?: QueryWriter;
  pickProduct?: ProductPicker;
  shop?: ShopClient;
}

export interface FixKitOptions {
  unitId?: string;
  deps?: FixKitDeps;
  rules?: FixKitRules;
  /** Default true. false = search and pick only (no create_checkout). */
  checkout?: boolean;
  onEvent?: OnFixKitEvent;
  env?: NodeJS.ProcessEnv;
  /** Needs processed in parallel (model + shop calls). Default 3. */
  concurrency?: number;
}

async function loadImage(frames: Map<string, Frame>, frameId: string | undefined): Promise<ImageContent | undefined> {
  const f = frameId ? frames.get(frameId) : undefined;
  if (!f) return undefined;
  try {
    const data = await readFile(f.path);
    const ext = extname(f.path).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { type: 'image', mime_type: mime, data: data.toString('base64') };
  } catch {
    return undefined;
  }
}

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, worker));
  return out;
}

const picked = (c: Candidate) => ({
  product: { id: c.productId, title: c.title },
  variant: { id: c.variantId, options: c.variantOptions },
  price: usdFromCents(c.priceCents),
  seller: c.seller,
  url: c.url,
});

/**
 * Build the tenant's DIY kit from the unit's diff. Only `new-damage` items are used (not-provable items are
 * `not-visible` and never reach here). Models write the query and pick among real products; mapping,
 * quantities, grouping and every dollar are code. Creates one checkout per seller, never completes one.
 */
export async function buildFixKit(diffItems: DiffItem[], plan: FloorPlan, frames: Frame[], opts: FixKitOptions = {}): Promise<FixKit> {
  const env = opts.env ?? process.env;
  const rules = opts.rules ?? loadFixKitRules();
  const writeQuery = opts.deps?.writeQuery ?? hydrogenQueryWriter({ env });
  const pickProduct = opts.deps?.pickProduct ?? decisionsProductPicker({ env });
  const shop = opts.deps?.shop ?? shopClient({ env });
  const { country, currency } = rules.context;

  const planned = planNeeds(diffItems, plan, rules);
  const warnings = [...planned.warnings];
  const newDamage = diffItems.filter((d) => d.verdict === 'new-damage').length;
  let done = 0;
  let total = planned.needs.length + (opts.checkout === false ? 0 : 1);
  const emit: Emit = (e) => opts.onEvent?.(e);
  const send = (e: EventBody) => emit({ ...e, done, total } as FixKitEvent);
  send({ step: 'rules', diffItems: newDamage, needs: planned.needs.length, uncovered: planned.uncovered.length });

  const frameMap = new Map(frames.map((f) => [f.id, f]));
  const images = new Map<string, Promise<ImageContent | undefined>>();
  const imageFor = (id: string | undefined) => {
    const k = id ?? '';
    let p = images.get(k);
    if (!p) images.set(k, (p = loadImage(frameMap, id)));
    return p;
  };

  type Outcome = { item: FixKitItem } | { missing: FixKit['missing'][number] };
  const outcomes = await mapLimit(planned.needs, opts.concurrency ?? 3, async (n): Promise<Outcome> => {
    const image = await imageFor(n.diffItem.afterFrameId);
    const ctx: NeedContext = { ...n, ...(image ? { image } : {}) };
    const issueType = n.diffItem.issueType!;
    const miss = (reason: string): Outcome => {
      done++;
      send({ step: 'missing', key: n.key, need: n.need.label, reason });
      return { missing: { key: n.key, need: n.needKey, needLabel: n.need.label, surfaceId: n.diffItem.surfaceId, issueType, reason } };
    };

    // b. query
    let q: FixQuery;
    let fallback = false;
    try {
      q = FixQuerySchema.parse(await writeQuery(ctx));
    } catch (e) {
      fallback = true;
      q = { query: n.need.defaultQuery };
      warnings.push(`${n.key}: query writer failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)}), used the default query`);
    }
    if (!n.need.usesHint) q = { query: q.query };
    send({ step: 'query', key: n.key, need: n.need.label, query: q.query, ...(q.colorHint ? { colorHint: q.colorHint } : {}), ...(q.finish ? { finish: q.finish } : {}), fallback });

    // c. search (one retry with the default query when the model's query finds nothing)
    const capCents = Math.round(n.need.maxPriceUsd * 100);
    const search = async (query: string) => {
      send({ step: 'searching', key: n.key, need: n.need.label, query });
      const doc = await shop.searchCatalog({ query, country, currency, maxPriceMinor: capCents, limit: rules.searchLimit });
      for (const m of doc.messages) if (m.type === 'warning') warnings.push(`${n.key}: Shop: ${m.content ?? m.code}`);
      return candidatesFrom(doc, capCents, currency);
    };
    let candidates: Candidate[];
    try {
      candidates = await search(q.query);
      if (!candidates.length && q.query !== n.need.defaultQuery) {
        candidates = await search(n.need.defaultQuery);
        if (candidates.length) q = { ...q, query: n.need.defaultQuery };
      }
    } catch (e) {
      return miss(`search failed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
    if (!candidates.length) return miss(`no buyable product under $${n.need.maxPriceUsd.toFixed(2)}`);

    // d. pick
    let pick: PickResult;
    let pickedBy: FixKitItem['pickedBy'] = 'decisions';
    if (candidates.length === 1) {
      pick = { index: 0, confidence: 1, probabilities: [1] };
      pickedBy = 'only-candidate';
    } else {
      try {
        pick = await pickProduct({ ...ctx, query: q, candidates });
        if (!(pick.index >= 0 && pick.index < candidates.length)) throw new Error(`pick index ${pick.index} out of range`);
      } catch (e) {
        warnings.push(`${n.key}: Decisions pick failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)}), kept the top 2 by search rank`);
        pick = { index: 0, confidence: 0, probabilities: candidates.map((_, i) => (i < 2 ? 0.5 : 0)) };
        pickedBy = 'search-rank';
      }
    }
    const needsChoice = pick.confidence < rules.lowConfidence;
    const ranked = candidates.map((c, i) => ({ c, p: pick.probabilities[i] ?? 0, i })).sort((a, b) => b.p - a.p || a.i - b.i);
    let best = candidates[pick.index]!;
    const alternatives = needsChoice ? ranked.filter((r) => r.c !== best).slice(0, 1).map((r) => ({ ...picked(r.c), probability: r.p })) : [];

    // Re-read the picked product before handing it to checkout (shop-search.md). Not fatal if it fails.
    let confirmed = false;
    try {
      const fresh = await shop.getProduct({ id: best.productId, country, currency });
      const v = fresh.product.variants.find((x) => x.id === best.variantId);
      if (v) {
        if (v.availability?.available === false) warnings.push(`${n.key}: “${best.title}” is no longer available`);
        else if (v.price.currency === currency && v.price.amount > 0) {
          if (v.price.amount !== best.priceCents) warnings.push(`${n.key}: price changed ${fmt(best.priceCents)} → ${fmt(v.price.amount)}`);
          best = { ...best, priceCents: v.price.amount };
          confirmed = true;
        }
      }
    } catch {
      // keep the search data; confirmed stays false
    }

    const item: FixKitItem = {
      key: n.key,
      need: n.needKey,
      needLabel: n.need.label,
      quantity: n.quantity,
      ...picked(best),
      lineTotal: usdFromCents(best.priceCents * n.quantity),
      confidence: Math.max(0, Math.min(1, pick.confidence)),
      pickedBy,
      needsChoice,
      alternatives,
      query: q.query,
      ...(q.colorHint ? { colorHint: q.colorHint } : {}),
      ...(q.finish ? { finish: q.finish } : {}),
      confirmed,
      forDiffItem: { surfaceId: n.diffItem.surfaceId, issueType, deductionUsd: isCharged(n.diffItem) ? usdFromCents(Math.round((n.diffItem.costUsd ?? 0) * 100)) : 0 },
    };
    done++;
    send({ step: 'picked', key: n.key, need: n.need.label, product: best.title, seller: best.seller.name, price: item.price, confidence: item.confidence, needsChoice, candidates: candidates.length });
    return { item };
  });

  const items = outcomes.flatMap((o) => ('item' in o ? [o.item] : []));
  const missing = outcomes.flatMap((o) => ('missing' in o ? [o.missing] : []));
  return finish({ unitId: opts.unitId, items, missing, uncovered: planned.uncovered, warnings, deductionCents: chargedDeductionCents(diffItems) }, shop, country, opts.checkout !== false, send, () => {
    done = total;
  }, (n) => {
    total = done + n;
  });
}

async function finish(
  k: Pick<FixKit, 'items' | 'missing' | 'uncovered' | 'warnings'> & { unitId: string | undefined; deductionCents: number },
  shop: ShopClient,
  country: string,
  checkout: boolean,
  send: (e: EventBody) => void,
  markDone: () => void,
  setRemaining: (n: number) => void,
): Promise<FixKit> {
  const sellers = new Set(k.items.map((i) => i.seller.domain)).size;
  if (checkout) setRemaining(sellers);
  const checkouts = checkout && k.items.length ? await createCheckouts(k.items, shop, country, send) : [];
  markDone();
  const totals = kitTotals(k.items, k.deductionCents);
  const kit = FixKitSchema.parse({
    ...(k.unitId ? { unitId: k.unitId } : {}),
    createdAt: new Date().toISOString(),
    items: k.items,
    checkouts,
    missing: k.missing,
    uncovered: k.uncovered,
    warnings: k.warnings,
    ...totals,
    complete: k.missing.length === 0 && k.uncovered.length === 0,
  });
  send({ step: 'done', diyTotal: kit.diyTotal, deductionTotal: kit.deductionTotal, savings: kit.savings, complete: kit.complete });
  return kit;
}

/**
 * The tenant chose between the top 2 of an unsure pick: swap in the chosen alternative (by variant ID) and
 * rebuild the checkouts. No new search or model call. Unknown choices are ignored with a warning.
 */
export async function applyChoices(
  kit: FixKit,
  choices: Record<string, string>,
  opts: { shop?: ShopClient; rules?: FixKitRules; checkout?: boolean; onEvent?: OnFixKitEvent; env?: NodeJS.ProcessEnv } = {},
): Promise<FixKit> {
  const rules = opts.rules ?? loadFixKitRules();
  const shop = opts.shop ?? shopClient({ env: opts.env ?? process.env });
  const warnings = [...kit.warnings];
  const items = kit.items.map((it): FixKitItem => {
    const want = choices[it.key];
    if (!want || want === it.variant.id) return want ? { ...it, pickedBy: 'user', needsChoice: false } : it;
    const alt = it.alternatives.find((a) => a.variant.id === want);
    if (!alt) {
      warnings.push(`${it.key}: choice ${want} is not one of the kept options`);
      return it;
    }
    const { probability, ...chosen } = alt;
    const prev = { product: it.product, variant: it.variant, price: it.price, seller: it.seller, url: it.url, probability: it.confidence };
    return {
      ...it,
      ...chosen,
      lineTotal: usdFromCents(Math.round(chosen.price * 100) * it.quantity),
      confidence: probability,
      pickedBy: 'user',
      needsChoice: false,
      alternatives: [prev],
      confirmed: false,
    };
  });
  let done = 0;
  let total = 1;
  const send = (e: EventBody) => opts.onEvent?.({ ...e, done, total } as FixKitEvent);
  return finish({ unitId: kit.unitId, items, missing: kit.missing, uncovered: kit.uncovered, warnings, deductionCents: Math.round(kit.deductionTotal * 100) }, shop, rules.context.country, opts.checkout !== false, send, () => {
    done = total;
  }, (n) => {
    total = done + n;
  });
}

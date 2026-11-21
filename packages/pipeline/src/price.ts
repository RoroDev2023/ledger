// [Rahim] R5: deterministic pricing from pricing.json. Rate × area (wall length × ceiling height − openings)
// plus a flat fee, for a proven new-damage item; $0 for every other verdict. Depreciation is behind a
// flag (default OFF). No model output ever becomes a number here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IssueTypeSchema, type FloorPlan, type IssueType, type SurfaceKind } from '@ledger/shared';

/** Default pricing file: packages/pipeline/pricing.json (placeholder rates, one file). */
export const PRICING_PATH = join(import.meta.dirname, '..', 'pricing.json');

/** Opening heights, same fixed assumptions as packages/plan/src/surfaces.ts (door 2.0 m, window 1.2 m). */
export const OPENING_HEIGHT_M = { door: 2.0, window: 1.2 } as const;

const RuleSchema = z.object({
  /** Key into `rates` for a flat fee. */
  flat: z.string().min(1).optional(),
  /** Key into `rates` for a $/m² rate, times the surface area. */
  perM2: z.string().min(1).optional(),
  /** Key into `usefulLifeYears` (used only when depreciation is on). */
  life: z.string().min(1),
});
export type PricingRule = z.infer<typeof RuleSchema>;

const IssueRulesSchema = z.object(
  Object.fromEntries(IssueTypeSchema.options.map((t) => [t, RuleSchema])) as Record<IssueType, typeof RuleSchema>,
);

export const PricingSchema = z
  .object({
    _note: z.string().optional(),
    currency: z.literal('USD'),
    rates: z.record(z.string(), z.number().finite().nonnegative()),
    issues: IssueRulesSchema,
    kindOverrides: z.record(z.string(), z.record(z.string(), RuleSchema)).default({}),
    usefulLifeYears: z.record(z.string(), z.number().finite().positive()),
  })
  .superRefine((p, ctx) => {
    const check = (where: string, r: PricingRule) => {
      if (!r.flat && !r.perM2) ctx.addIssue({ code: 'custom', message: `${where}: needs "flat" or "perM2"` });
      for (const k of [r.flat, r.perM2]) {
        if (k && !(k in p.rates)) ctx.addIssue({ code: 'custom', message: `${where}: unknown rate "${k}"` });
      }
      if (!(r.life in p.usefulLifeYears)) ctx.addIssue({ code: 'custom', message: `${where}: unknown useful life "${r.life}"` });
    };
    for (const [t, r] of Object.entries(p.issues)) check(`issues.${t}`, r);
    for (const [kind, rules] of Object.entries(p.kindOverrides)) {
      for (const [t, r] of Object.entries(rules)) {
        if (!IssueTypeSchema.safeParse(t).success) ctx.addIssue({ code: 'custom', message: `kindOverrides.${kind}: unknown issue type "${t}"` });
        check(`kindOverrides.${kind}.${t}`, r);
      }
    }
  });
export type Pricing = z.infer<typeof PricingSchema>;

let defaultPricing: Pricing | undefined;

/** Load and validate a pricing file (default: pricing.json next to this package). */
export function loadPricing(path?: string): Pricing {
  if (!path && defaultPricing) return defaultPricing;
  const p = PricingSchema.parse(JSON.parse(readFileSync(path ?? PRICING_PATH, 'utf8')));
  if (!path) defaultPricing = p;
  return p;
}

export interface DepreciationOptions {
  /** Default false: depreciation is cut unless we're ahead (AGENTS.md scope tiers). */
  enabled: boolean;
  /** Age of the finish being repaired, in years. */
  ageYears: number;
}

/**
 * Chargeable area of a surface in m². Walls: segment length × ceiling height − openings on that wall
 * (door 2.0 m, window 1.2 m high). Other kinds: the plan's `areaM2`. Undefined when unknown.
 */
export function surfaceAreaM2(plan: FloorPlan, surfaceId: string): number | undefined {
  const s = plan.surfaces.find((x) => x.id === surfaceId);
  if (!s) return undefined;
  if (s.kind === 'wall' && s.segment) {
    const [[x1, y1], [x2, y2]] = s.segment;
    const gross = Math.hypot(x2 - x1, y2 - y1) * plan.ceilingHeightM;
    const openings = plan.openings
      .filter((o) => o.wallId === s.id)
      .reduce((sum, o) => sum + o.widthM * OPENING_HEIGHT_M[o.kind], 0);
    return round2(Math.max(0, gross - openings));
  }
  return s.areaM2 !== undefined ? round2(s.areaM2) : undefined;
}

export interface PriceBreakdown {
  issueType: IssueType;
  surfaceKind: SurfaceKind;
  rule: PricingRule;
  /** Area the per-m² rate applies to (undefined when the rule has no per-m² part or the area is unknown). */
  areaM2?: number;
  ratePerM2Usd: number;
  flatUsd: number;
  /** Per-m² part before depreciation. */
  areaUsd: number;
  /** 1 when depreciation is off. */
  depreciationFactor: number;
  /** Final charge, rounded to cents. */
  costUsd: number;
  /** The rule needs an area but the plan has none for this surface (area part charged as $0). */
  areaMissing: boolean;
}

/** Price one proven new-damage item. Deterministic code only. */
export function priceDamage(args: {
  plan: FloorPlan;
  surfaceId: string;
  issueType: IssueType;
  pricing?: Pricing;
  depreciation?: DepreciationOptions;
}): PriceBreakdown {
  const pricing = args.pricing ?? loadPricing();
  const surface = args.plan.surfaces.find((s) => s.id === args.surfaceId);
  if (!surface) throw new Error(`priceDamage: surface ${args.surfaceId} is not in the plan`);
  const rule = pricing.kindOverrides[surface.kind]?.[args.issueType] ?? pricing.issues[args.issueType];
  const flatUsd = rule.flat ? pricing.rates[rule.flat]! : 0;
  const ratePerM2Usd = rule.perM2 ? pricing.rates[rule.perM2]! : 0;
  const area = rule.perM2 ? surfaceAreaM2(args.plan, surface.id) : undefined;
  const areaUsd = area !== undefined ? ratePerM2Usd * area : 0;
  const dep = args.depreciation;
  const depreciationFactor = dep?.enabled ? Math.max(0, 1 - dep.ageYears / pricing.usefulLifeYears[rule.life]!) : 1;
  return {
    issueType: args.issueType,
    surfaceKind: surface.kind,
    rule,
    ...(area !== undefined ? { areaM2: area } : {}),
    ratePerM2Usd,
    flatUsd,
    areaUsd: round2(areaUsd),
    depreciationFactor,
    costUsd: round2((flatUsd + areaUsd) * depreciationFactor),
    areaMissing: Boolean(rule.perM2) && area === undefined,
  };
}

/** "$12.00" */
export function usd(x: number): string {
  return `$${x.toFixed(2)}`;
}

/** Human-readable math, e.g. "repaint 5.70 m² at $12.00/m² + $85.00 flat = $153.40". */
export function describePrice(p: PriceBreakdown): string {
  const parts: string[] = [];
  if (p.rule.perM2) {
    parts.push(p.areaM2 !== undefined ? `${p.areaM2.toFixed(2)} m² at ${usd(p.ratePerM2Usd)}/m²` : 'area unknown (area part $0)');
  }
  if (p.rule.flat) parts.push(`${usd(p.flatUsd)} flat`);
  const dep = p.depreciationFactor < 1 ? ` × ${p.depreciationFactor.toFixed(2)} depreciation` : '';
  return `${parts.join(' + ')}${dep} = ${usd(p.costUsd)}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

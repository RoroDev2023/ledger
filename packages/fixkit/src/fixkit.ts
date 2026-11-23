// [Elmir] Fix kit: for each charged line of the statement, find the repair supplies on Shopify (Shop MCP
// search_catalog), pick one product per need, and build one checkout link per store (create_checkout).
// The tenant opens the link and decides; LEDGER never pays. Shopping needs per damage type are a fixed,
// reviewed table, not model output, so nothing odd gets put in a cart.
import type { DiffItem, IssueType } from '@ledger/shared';
import type { ShopCheckout, ShopClient, ShopProduct, ShopVariant } from './shop.js';

export interface Need { need: string; query: string; maxUsd: number }

/** What a tenant needs to fix each kind of damage before move-out. Reviewed by hand; keep it small. */
export const REPAIR_NEEDS: Record<IssueType, Need[]> = {
  scuff: [
    { need: 'Eraser sponge for scuffs', query: 'melamine magic eraser sponge', maxUsd: 15 },
    { need: 'White wall touch-up paint', query: 'white wall touch up paint pen', maxUsd: 25 },
  ],
  hole: [{ need: 'Spackle repair kit', query: 'wall spackle repair kit', maxUsd: 30 }],
  crack: [{ need: 'Drywall crack filler', query: 'drywall crack repair spackle', maxUsd: 30 }],
  stain: [{ need: 'Stain-blocking primer', query: 'stain blocking primer white', maxUsd: 30 }],
  'missing-fixture': [],
  other: [],
};

export interface KitProduct {
  title: string;
  priceUsd: number;
  imageUrl?: string;
  productUrl?: string;
  seller: string;
  sellerName?: string;
  variantId: string;
}
export interface KitLine {
  surfaceId: string;
  issueType: IssueType;
  chargeUsd: number;
  needs: { need: string; product?: KitProduct; note?: string }[];
}
export interface KitCheckout { seller: string; sellerName?: string; continueUrl: string; totalUsd: number; expiresAt?: string }
export interface FixKit {
  unitId?: string;
  createdAt: string;
  lines: KitLine[];
  checkouts: KitCheckout[];
  kitTotalUsd: number;
  chargedUsd: number;
  /** Charged amount minus the kit's price; only meaningful if the tenant actually does the repair. */
  potentialSavingsUsd: number;
  warnings: string[];
}

const NOT_PROVABLE = 'not provable:';
export const isChargedLine = (d: DiffItem) => d.verdict === 'new-damage' && !d.reason.trimStart().toLowerCase().startsWith(NOT_PROVABLE) && (d.costUsd ?? 0) > 0;

const cents = (m?: { amount: number }) => (m ? m.amount / 100 : Number.NaN);
const round2 = (x: number) => Math.round(x * 100) / 100;
const ratingOf = (p: ShopProduct) => (typeof p.rating === 'number' ? p.rating : (p.rating?.value ?? 0));

/** Pick the product to buy for one need: available, USD, under the cap; best rated, then cheapest. */
export function pickProduct(products: ShopProduct[], maxUsd: number): KitProduct | undefined {
  const options = products
    .map((p) => ({ p, v: (p.variants ?? [])[0] as ShopVariant | undefined }))
    .filter((x): x is { p: ShopProduct; v: ShopVariant } => !!x.v && x.v.availability?.available !== false && x.v.price?.currency === 'USD' && !!x.v.seller?.domain)
    .filter((x) => cents(x.v.price) > 0 && cents(x.v.price) <= maxUsd);
  options.sort((a, b) => ratingOf(b.p) - ratingOf(a.p) || cents(a.v.price) - cents(b.v.price));
  const best = options[0];
  if (!best) return undefined;
  return {
    title: best.p.title,
    priceUsd: cents(best.v.price),
    imageUrl: best.p.media?.find((m) => m.type === 'image' && m.url)?.url,
    productUrl: best.v.url,
    seller: best.v.seller!.domain!,
    sellerName: best.v.seller?.name,
    variantId: best.v.id,
  };
}

export async function buildFixKit(items: DiffItem[], shop: ShopClient, opts: { unitId?: string; country?: string; checkout?: boolean } = {}): Promise<FixKit> {
  const country = opts.country ?? 'US';
  const warnings: string[] = [];
  const charged = items.filter(isChargedLine);
  const byQuery = new Map<string, Promise<ShopProduct[]>>();
  const search = (n: Need) => {
    if (!byQuery.has(n.query))
      byQuery.set(
        n.query,
        shop
          .call<{ products?: ShopProduct[] }>('search_catalog', {
            catalog: { query: n.query, context: { address_country: country, currency: 'USD' }, filters: { price: { max: Math.round(n.maxUsd * 100) } }, pagination: { limit: 10 } },
          })
          .then((r) => r.products ?? []),
      );
    return byQuery.get(n.query)!;
  };

  const lines: KitLine[] = await Promise.all(
    charged.map(async (d) => {
      const issueType = d.issueType ?? 'other';
      const needs = REPAIR_NEEDS[issueType];
      if (!needs.length) return { surfaceId: d.surfaceId, issueType, chargeUsd: d.costUsd ?? 0, needs: [{ need: 'Repair', note: 'No standard DIY kit for this; a professional repair is needed.' }] };
      return {
        surfaceId: d.surfaceId,
        issueType,
        chargeUsd: d.costUsd ?? 0,
        needs: await Promise.all(
          needs.map(async (n) => {
            try {
              const product = pickProduct(await search(n), n.maxUsd);
              return product ? { need: n.need, product } : { need: n.need, note: `Nothing available under $${n.maxUsd}.` };
            } catch (e) {
              warnings.push(`search "${n.query}" failed: ${e instanceof Error ? e.message : String(e)}`);
              return { need: n.need, note: 'Search failed.' };
            }
          }),
        ),
      };
    }),
  );

  // One product per variant, even if two charged walls need the same thing (one tube of spackle is enough).
  const picked = new Map<string, KitProduct>();
  for (const l of lines) for (const n of l.needs) if (n.product) picked.set(n.product.variantId, n.product);
  const bySeller = new Map<string, KitProduct[]>();
  for (const p of picked.values()) bySeller.set(p.seller, [...(bySeller.get(p.seller) ?? []), p]);

  const checkouts: KitCheckout[] = [];
  if (opts.checkout !== false) {
    await Promise.all(
      [...bySeller.entries()].map(async ([seller, products]) => {
        try {
          const c = await shop.call<ShopCheckout>('create_checkout', {
            shop: seller,
            checkout: { line_items: products.map((p) => ({ item: { id: p.variantId }, quantity: 1 })), context: { address_country: country } },
          });
          if (!c.continue_url) throw new Error('no continue_url');
          const total = c.totals?.find((t) => t.type === 'total') ?? c.totals?.find((t) => t.type === 'subtotal');
          checkouts.push({ seller, sellerName: products[0]?.sellerName, continueUrl: c.continue_url, totalUsd: total ? total.amount / 100 : round2(products.reduce((s, p) => s + p.priceUsd, 0)), expiresAt: c.expires_at });
        } catch (e) {
          warnings.push(`checkout at ${seller} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  }

  const kitTotalUsd = round2([...picked.values()].reduce((s, p) => s + p.priceUsd, 0));
  const chargedUsd = round2(charged.reduce((s, d) => s + (d.costUsd ?? 0), 0));
  return {
    unitId: opts.unitId,
    createdAt: new Date().toISOString(),
    lines,
    checkouts: checkouts.sort((a, b) => a.seller.localeCompare(b.seller)),
    kitTotalUsd,
    chargedUsd,
    potentialSavingsUsd: round2(Math.max(0, chargedUsd - kitTotalUsd)),
    warnings,
  };
}

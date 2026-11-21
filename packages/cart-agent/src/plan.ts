// [Rahim] FixKit -> one run per seller: the variants to put in that seller's cart.
import type { FixKit } from '@ledger/pipeline';
import { numericVariantId } from './variant.js';

export interface CartLine {
  key: string;
  title: string;
  /** Variant URL exactly as search returned it (query string unchanged). */
  url: string;
  variantGid: string;
  /** Null when neither the URL nor the GID has a numeric ID: the line is reported as failed. */
  variantId: string | null;
  quantity: number;
}

export interface SellerRun {
  seller: string;
  /** seller.domain from the catalog (often <x>.myshopify.com). */
  domain: string;
  /** Storefront origin from the variant URL (the host the shopper sees; the cart cookie lives here). */
  storefront: string;
  lines: CartLine[];
  /** Shop MCP continue_url for this seller: the fallback link when the browser run fails. */
  continueUrl?: string;
}

const originOf = (url: string, domain: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return `https://${domain}`;
  }
};

const host = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Groups kit items by seller.domain and merges identical variants (sums quantities), like createCheckouts. */
export function sellerRuns(kit: FixKit, opts: { sellers?: string[]; maxSellers?: number } = {}): SellerRun[] {
  const by = new Map<string, SellerRun>();
  for (const it of kit.items) {
    let run = by.get(it.seller.domain);
    if (!run) {
      const co = kit.checkouts.find((c) => c.shop === it.seller.domain);
      run = {
        seller: it.seller.name,
        domain: it.seller.domain,
        storefront: originOf(it.url, it.seller.domain),
        lines: [],
        ...(co?.continue_url ? { continueUrl: co.continue_url } : {}),
      };
      by.set(it.seller.domain, run);
    }
    const same = run.lines.find((l) => l.variantGid === it.variant.id);
    if (same) same.quantity += it.quantity;
    else run.lines.push({ key: it.key, title: it.product.title, url: it.url, variantGid: it.variant.id, variantId: numericVariantId(it.url, it.variant.id), quantity: it.quantity });
  }
  let runs = [...by.values()];
  if (opts.sellers?.length) {
    const want = opts.sellers.map((s) => s.trim().toLowerCase().replace(/^www\./, ''));
    runs = runs.filter((r) => want.some((w) => r.domain.toLowerCase() === w || r.seller.toLowerCase() === w || host(r.storefront) === w));
  }
  return opts.maxSellers !== undefined ? runs.slice(0, Math.max(0, opts.maxSellers)) : runs;
}

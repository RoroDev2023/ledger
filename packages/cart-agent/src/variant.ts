// [Rahim] Numeric Shopify variant IDs, for /cart/add.js and /cart.js (both use the integer ID, not the GID).

/**
 * The numeric variant ID: the `?variant=` query param of the variant URL (as search returned it), else the
 * trailing number of `gid://shopify/ProductVariant/<n>`. Null when neither is a plain integer.
 */
export function numericVariantId(url?: string, gid?: string): string | null {
  if (url) {
    try {
      const v = new URL(url).searchParams.get('variant');
      if (v && /^\d{1,20}$/.test(v)) return v;
    } catch {
      // not a URL: fall through to the GID
    }
  }
  const g = gid?.trim();
  if (g) {
    const m = /^gid:\/\/shopify\/ProductVariant\/(\d{1,20})(?:\?.*)?$/.exec(g);
    if (m?.[1]) return m[1];
    if (/^\d{1,20}$/.test(g)) return g;
  }
  return null;
}

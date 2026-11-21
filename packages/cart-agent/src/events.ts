// [Rahim] Cart agent progress events (like FixKitEvent: a step + done/total, plus a ready-made feed line).

export type AddVia = 'button' | 'cart-api' | 'button+cart-api';

export type CartEventBody =
  | { step: 'start'; sellers: number; items: number }
  | { step: 'opening'; seller: string; shop: string; url: string }
  | { step: 'product'; seller: string; title: string; url: string; screenshot?: string }
  | { step: 'popup'; seller: string; dismissed: number }
  | { step: 'added'; seller: string; title: string; quantity: number; via: AddVia }
  | { step: 'add-failed'; seller: string; title: string; error: string }
  | { step: 'cart'; seller: string; cartUrl: string }
  | {
      step: 'cart-verified';
      seller: string;
      cartUrl: string;
      verified: boolean;
      itemCount: number;
      subtotal: number;
      currency: string;
      /** Titles of wanted lines that are not (fully) in the cart. */
      missing: string[];
      screenshot?: string;
    }
  | { step: 'seller-failed'; seller: string; error: string; fallbackUrl?: string }
  | { step: 'done'; carts: number; verified: number };

/** `done` = sellers finished, `total` = sellers in this run. */
export type CartEvent = { done: number; total: number } & CartEventBody;
export type OnCartEvent = (e: CartEvent) => void;

const VIA: Record<AddVia, string> = { button: 'store button', 'cart-api': '/cart/add.js', 'button+cart-api': 'store button + /cart/add.js' };

/** Feed line for the web's live panel. */
export function describeCartEvent(e: CartEvent): string {
  switch (e.step) {
    case 'start':
      return `filling ${e.sellers} cart${e.sellers === 1 ? '' : 's'} (${e.items} item${e.items === 1 ? '' : 's'}), no checkout`;
    case 'opening':
      return `opening ${e.seller}`;
    case 'product':
      return `product page: ${e.title}`;
    case 'popup':
      return `closed ${e.dismissed} popup${e.dismissed === 1 ? '' : 's'} at ${e.seller}`;
    case 'added':
      return `added ${e.title} ×${e.quantity} (${VIA[e.via]})`;
    case 'add-failed':
      return `could not add ${e.title}: ${e.error}`;
    case 'cart':
      return `opening the cart at ${e.seller}`;
    case 'cart-verified':
      return e.verified
        ? `cart verified at ${e.seller}, ${e.itemCount} item${e.itemCount === 1 ? '' : 's'}, $${e.subtotal.toFixed(2)}`
        : `cart at ${e.seller} is missing ${e.missing.join(', ') || 'items'} (${e.itemCount} in cart, $${e.subtotal.toFixed(2)})`;
    case 'seller-failed':
      return `${e.seller} failed: ${e.error}${e.fallbackUrl ? ' · use the Shop checkout link instead' : ''}`;
    case 'done':
      return `done: ${e.verified} of ${e.carts} cart${e.carts === 1 ? '' : 's'} verified. Nothing was bought.`;
  }
}

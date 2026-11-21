import { describe, expect, it } from 'vitest';
import type { DiffItem } from '@ledger/shared';
import { buildFixKit, isChargedLine, pickProduct } from '../src/fixkit.js';
import { ALLOWED_TOOLS, parseRpc, shopClient, type ShopClient, type ShopProduct } from '../src/shop.js';

const prod = (title: string, cents: number, domain: string, extra: Partial<ShopProduct> = {}): ShopProduct => ({
  id: `p-${title}`,
  title,
  media: [{ type: 'image', url: `https://cdn.example/${title}.jpg` }],
  variants: [{ id: `v-${title}`, price: { amount: cents, currency: 'USD' }, availability: { available: true }, seller: { domain, name: domain } }],
  ...extra,
});

const item = (surfaceId: string, verdict: DiffItem['verdict'], costUsd: number, issueType: DiffItem['issueType'], reason = 'new mark'): DiffItem => ({ surfaceId, verdict, costUsd, issueType, reason, confidence: 0.9 });

describe('pickProduct', () => {
  it('skips unavailable and over-cap items, prefers rating then price', () => {
    const list = [
      prod('pricey', 4000, 'a.myshopify.com'),
      prod('gone', 500, 'a.myshopify.com', { variants: [{ id: 'v', price: { amount: 500, currency: 'USD' }, availability: { available: false }, seller: { domain: 'a.myshopify.com' } }] }),
      prod('cheap', 900, 'b.myshopify.com'),
      prod('rated', 1200, 'c.myshopify.com', { rating: { value: 4.8 } }),
    ];
    expect(pickProduct(list, 30)?.title).toBe('rated');
    expect(pickProduct(list.slice(0, 3), 30)?.title).toBe('cheap');
    expect(pickProduct([list[0]!], 30)).toBeUndefined();
  });
});

describe('isChargedLine', () => {
  it('only charged new damage', () => {
    expect(isChargedLine(item('w', 'new-damage', 85, 'scuff'))).toBe(true);
    expect(isChargedLine(item('w', 'new-damage', 85, 'scuff', 'Not provable: one pair only'))).toBe(false);
    expect(isChargedLine(item('w', 'moved', 0, undefined))).toBe(false);
  });
});

describe('buildFixKit', () => {
  it('builds one checkout per store and never asks to pay', async () => {
    const calls: string[] = [];
    const shop: ShopClient = {
      async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
        calls.push(tool);
        if (tool === 'search_catalog') {
          const q = (args.catalog as { query: string }).query;
          return { products: [prod(q, q.includes('eraser') ? 799 : 1599, q.includes('eraser') ? 'x.myshopify.com' : 'y.myshopify.com')] } as T;
        }
        return { continue_url: `https://shop.app/checkouts/${String(args.shop)}`, totals: [{ type: 'total', amount: 1234 }] } as T;
      },
    };
    const kit = await buildFixKit([item('room-1.wall-n', 'new-damage', 85, 'scuff'), item('room-1.wall-e', 'moved', 0, undefined)], shop, { unitId: 'u1' });
    expect(kit.lines).toHaveLength(1);
    expect(kit.lines[0]!.needs.every((n) => n.product)).toBe(true);
    expect(kit.checkouts.map((c) => c.seller)).toEqual(['x.myshopify.com', 'y.myshopify.com']);
    expect(kit.kitTotalUsd).toBe(23.98);
    expect(kit.chargedUsd).toBe(85);
    expect(kit.potentialSavingsUsd).toBe(61.02);
    expect(calls).not.toContain('complete_checkout');
  });
});

describe('shop client', () => {
  it('cannot call the paying tool', async () => {
    expect(ALLOWED_TOOLS).not.toContain('complete_checkout' as never);
    await expect(shopClient().call('complete_checkout' as never, {})).rejects.toThrow(/not allowed/);
  });
  it('parses JSON and SSE answers', () => {
    expect(parseRpc('{"a":1}')).toEqual({ a: 1 });
    expect(parseRpc('event: message\ndata: {"b":2}\n')).toEqual({ b: 2 });
  });
});

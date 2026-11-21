import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide, readCalls } from '@ledger/gemini';
import { shopClient, type CheckoutDoc, type CheckoutLine, type SearchArgs, type SearchDoc, type ShopClient } from '@ledger/shop';
import { loadPlanFixture, type DiffItem } from '@ledger/shared';
import {
  FixKitSchema,
  FixQuerySchema,
  applyChoices,
  buildFixKit,
  candidatesFrom,
  decisionsProductPicker,
  describeFixKitEvent,
  hydrogenQueryWriter,
  loadFixKitRules,
  needQuantity,
  planNeeds,
  type Candidate,
  type FixKitEvent,
  type ProductPicker,
  type QueryWriter,
} from '../src/fixkit.js';
import { buildStatement } from '../src/statement.js';

const plan = loadPlanFixture('demo-table');
const rules = loadFixKitRules();

function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GEMINI_MODE: 'mock',
    SHOP_MODE: 'mock',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'ledger-fixkit-')),
    SHOP_FIXTURES_DIR: mkdtempSync(join(tmpdir(), 'ledger-fixkit-shop-')),
    MODEL_FAST: 'gemini-4-hydrogen',
    MODEL_DECIDE: 'gemini-decision-1',
    ...extra,
  };
}

const item = (surfaceId: string, verdict: DiffItem['verdict'], issueType?: DiffItem['issueType'], costUsd = 0, extra: Partial<DiffItem> = {}): DiffItem => ({
  surfaceId,
  verdict,
  ...(issueType ? { issueType } : {}),
  reason: verdict === 'new-damage' ? `New ${issueType}.` : 'n/a',
  costUsd,
  confidence: 0.9,
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// A scripted ShopClient: products per query keyword, every call recorded.

interface P {
  title: string;
  cents: number;
  seller: string;
  vid: string;
  available?: boolean;
  currency?: string;
}
const SELLERS: Record<string, string> = { paint: 'paint.myshopify.com', tools: 'tools.myshopify.com' };

function searchDoc(ps: P[]): SearchDoc {
  return {
    products: ps.map((p) => ({
      id: `gid://shopify/p/${p.vid}`,
      title: p.title,
      variants: [
        {
          id: `gid://shopify/ProductVariant/${p.vid}`,
          options: [{ name: 'Size', label: 'Quart' }],
          price: { amount: p.cents, currency: p.currency ?? 'USD' },
          availability: { available: p.available ?? true },
          url: `https://${p.seller}.example/products/${p.vid}?variant=1&_gsid=x`,
          seller: { name: p.seller === 'paint' ? 'Paint Co' : 'Tool Shed', domain: SELLERS[p.seller]! },
        },
      ],
    })),
    messages: [],
  } as SearchDoc;
}

function scriptedShop(byQuery: (q: string) => P[]) {
  const searches: SearchArgs[] = [];
  const checkouts: { shop: string; lines: CheckoutLine[]; country: string }[] = [];
  const products: string[] = [];
  const shop: ShopClient = {
    async searchCatalog(a) {
      searches.push(a);
      return searchDoc(byQuery(a.query));
    },
    async getProduct(a) {
      products.push(a.id);
      const all = searches.flatMap((s) => searchDoc(byQuery(s.query)).products);
      return { product: all.find((p) => p.id === a.id)!, messages: [] } as never;
    },
    async createCheckout(a) {
      checkouts.push(a);
      return { id: `co-${a.shop}`, status: 'incomplete', messages: [], continue_url: `https://${a.shop}/checkouts/abc?key=secret` } as CheckoutDoc;
    },
  };
  return { shop, searches, checkouts, products };
}

const CATALOG = (q: string): P[] =>
  /paint/.test(q)
    ? [
        { title: 'Wall Touch Up Paint Quart', cents: 1299, seller: 'paint', vid: 'paint-1' },
        { title: 'Ceiling Paint Gallon', cents: 3499, seller: 'paint', vid: 'paint-2' },
        { title: 'Too Expensive Paint', cents: 9999, seller: 'paint', vid: 'paint-3' },
        { title: 'Sold Out Paint', cents: 999, seller: 'paint', vid: 'paint-4', available: false },
        { title: 'CAD Paint', cents: 999, seller: 'paint', vid: 'paint-5', currency: 'CAD' },
      ]
    : /sanding/.test(q)
      ? [
          { title: 'Fine Sanding Sponge', cents: 549, seller: 'tools', vid: 'sponge-1' },
          { title: 'Coarse Sanding Block', cents: 449, seller: 'tools', vid: 'sponge-2' },
        ]
      : /putty/.test(q)
        ? [{ title: 'Flexible Putty Knife', cents: 799, seller: 'tools', vid: 'knife-1' }]
        : [];

const fixedQuery: QueryWriter = async (ctx) => ({ query: ctx.need.defaultQuery, colorHint: 'warm white', finish: 'eggshell' });
const firstPick: ProductPicker = async (ctx) => ({ index: 0, confidence: 0.9, probabilities: ctx.candidates.map((_, i) => (i === 0 ? 0.9 : 0.1 / (ctx.candidates.length - 1))) });

// ---------------------------------------------------------------------------------------------

describe('a. deterministic rules (fixkit-rules.json)', () => {
  it('maps issue types to repair needs, with the floor override; ignores every other verdict', () => {
    const diff = [
      item('living-room.wall-n', 'new-damage', 'scuff', 72.72),
      item('living-room.wall-s', 'new-damage', 'hole', 153.4),
      item('bedroom.wall-e', 'new-damage', 'stain', 60.6),
      item('bedroom.wall-n', 'new-damage', 'missing-fixture', 120),
      item('living-room.floor', 'new-damage', 'stain', 60),
      item('bedroom.wall-w', 'new-damage', 'other', 85),
      item('bedroom.wall-s', 'pre-existing', 'hole'),
      item('living-room.wall-e', 'not-visible', 'scuff', 0, { reason: 'Not provable: only 1 of the 2 …' }),
      item('living-room.wall-w', 'moved'),
      item('bedroom.floor', 'wear', 'scuff'),
    ];
    const { needs, uncovered } = planNeeds(diff, plan, rules);
    const by = (s: string) => needs.filter((n) => n.diffItem.surfaceId === s).map((n) => n.needKey);
    expect(by('living-room.wall-n')).toEqual(['touch-up-paint', 'sanding-sponge']);
    expect(by('living-room.wall-s')).toEqual(['spackle', 'putty-knife', 'touch-up-paint']);
    expect(by('bedroom.wall-e')).toEqual(['stain-cleaner']);
    expect(by('bedroom.wall-n')).toEqual(['replacement-fixture']);
    expect(by('living-room.floor')).toEqual(['floor-cleaner']);
    expect(by('bedroom.wall-w')).toEqual(['adhesive-remover', 'touch-up-paint', 'sanding-sponge']);
    expect(uncovered).toEqual([]);
    expect(needs.some((n) => ['bedroom.wall-s', 'living-room.wall-e', 'living-room.wall-w', 'bedroom.floor'].includes(n.diffItem.surfaceId))).toBe(false);
    expect(new Set(needs.map((n) => n.key)).size).toBe(needs.length);
  });

  it('an issue type without a rule falls back to the "other" needs and says so; uncovered only when "other" is empty too', () => {
    const noStain = { ...rules, issues: { ...rules.issues, stain: [] } };
    const r = planNeeds([item('bedroom.wall-e', 'new-damage', 'stain', 60.6)], plan, noStain);
    expect(r.needs.map((n) => n.needKey)).toEqual(['adhesive-remover', 'touch-up-paint', 'sanding-sponge']);
    expect(r.uncovered).toEqual([]);
    expect(r.warnings).toContain('bedroom.wall-e: no DIY repair rule for "stain", used the generic "other" kit');
    const none = planNeeds([item('bedroom.wall-e', 'new-damage', 'stain', 60.6)], plan, { ...noStain, issues: { ...noStain.issues, other: [] } });
    expect(none.needs).toEqual([]);
    expect(none.uncovered).toEqual([{ surfaceId: 'bedroom.wall-e', issueType: 'stain', reason: 'no DIY repair rule for "stain"' }]);
  });

  it('quantities from areaM2 and coverage, clamped; fixed counts for tools', () => {
    const paint = rules.needs['touch-up-paint']!; // 10 m² per unit, max 4
    expect(needQuantity(paint, 6.06).quantity).toBe(1);
    expect(needQuantity(paint, 10).quantity).toBe(1);
    expect(needQuantity(paint, 25).quantity).toBe(3);
    expect(needQuantity(paint, 400).quantity).toBe(4);
    expect(needQuantity(paint, undefined)).toEqual({ quantity: 1, warning: 'Touch-up paint: area unknown, quantity 1' });
    expect(needQuantity(rules.needs['putty-knife']!, 400).quantity).toBe(1);
    // DiffItem.areaM2 wins over the plan's area
    const { needs } = planNeeds([item('living-room.wall-n', 'new-damage', 'scuff', 1, { areaM2: 31 })], plan, rules);
    expect(needs.find((n) => n.needKey === 'touch-up-paint')!.quantity).toBe(4);
  });
});

describe('b. query generation (Hydrogen, zod-validated)', () => {
  it('Hydrogen writer returns a schema-valid query from the per-need mock fixture', async () => {
    const env = testEnv();
    const { needs } = planNeeds([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, rules);
    const q = await hydrogenQueryWriter({ env })(needs[0]!);
    expect(FixQuerySchema.parse(q)).toEqual({ query: 'interior wall touch up paint', colorHint: 'warm white', finish: 'eggshell' });
    const call = readCalls(env).at(-1)!;
    expect(call).toMatchObject({ model: 'gemini-4-hydrogen', tag: 'fixkit.query.touch-up-paint', ok: true });
  });

  it('rejects bad queries; a failed writer falls back to the rule default query', async () => {
    expect(FixQuerySchema.safeParse({ query: 'x' }).success).toBe(false);
    expect(FixQuerySchema.safeParse({ query: 'touch up paint', finish: 'shiny' }).success).toBe(false);
    const s = scriptedShop(CATALOG);
    const kit = await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, [], {
      env: testEnv(),
      checkout: false,
      deps: { shop: s.shop, writeQuery: async () => ({ query: '' }) as never, pickProduct: firstPick },
    });
    expect(s.searches.map((a) => a.query)).toEqual(['interior wall touch up paint', 'fine grit sanding sponge']);
    expect(kit.warnings.filter((w) => w.includes('query writer failed'))).toHaveLength(2);
  });

  it('search uses US, USD, the per-need cap in cents and limit 10; code drops unavailable, over-cap and non-USD variants', async () => {
    const s = scriptedShop(CATALOG);
    await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, [], { env: testEnv(), checkout: false, deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: firstPick } });
    expect(s.searches[0]).toEqual({ query: 'interior wall touch up paint', country: 'US', currency: 'USD', maxPriceMinor: 4000, limit: 10 });
    const c = candidatesFrom(searchDoc(CATALOG('paint')), 4000, 'USD');
    expect(c.map((x) => x.title)).toEqual(['Wall Touch Up Paint Quart', 'Ceiling Paint Gallon']);
  });
});

describe('d. Decisions pick', () => {
  const cands: Candidate[] = candidatesFrom(searchDoc([...CATALOG('paint'), ...CATALOG('sanding')]), 4000, 'USD');

  it('one choice question; option text = title + price + seller + options; the fixture rule picks c2', async () => {
    const env = testEnv();
    const fx = join(env.DATA_DIR!, 'fx');
    mkdirSync(join(fx, 'decide'), { recursive: true });
    writeFileSync(join(fx, 'decide', 'fixkit.pick.json'), JSON.stringify({ rules: [{ match: 'best fit', choice: 'c2' }] }));
    env.GEMINI_FIXTURES_DIR = fx;
    const seen: Parameters<typeof decide>[0][] = [];
    const picker = decisionsProductPicker({ env, decideFn: (async (a: Parameters<typeof decide>[0]) => (seen.push(a), decide(a))) as typeof decide });
    const { needs } = planNeeds([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, rules);
    const r = await picker({ ...needs[0]!, query: { query: 'touch up paint', colorHint: 'warm white' }, candidates: cands });
    expect(r.index).toBe(2);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.probabilities).toHaveLength(cands.length);
    const q = seen[0]!.questions.pick!;
    expect(q.type).toBe('choice');
    expect(Object.keys(q.criteria as Record<string, string>)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect((q.criteria as Record<string, string>).c0).toBe('"Wall Touch Up Paint Quart" · $12.99 · sold by Paint Co · Size: Quart');
    expect(readCalls(env).filter((c) => c.tag === 'fixkit.pick')).toMatchObject([{ questions: 1, endpoint: 'decisions' }]);
  });

  it('confidence < 0.5 keeps the top 2 for the tenant; applyChoices swaps and rebuilds checkouts', async () => {
    const unsure: ProductPicker = async (ctx) => {
      const p = ctx.candidates.map((_, i) => [0.3, 0.45, 0.25][i] ?? 0);
      return { index: 1, confidence: 0.45, probabilities: p };
    };
    const s = scriptedShop(CATALOG);
    const kit = await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, [], { env: testEnv(), deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: unsure } });
    const paint = kit.items.find((i) => i.need === 'touch-up-paint')!;
    expect(paint.product.title).toBe('Ceiling Paint Gallon'); // top pick still in the totals
    expect(paint.needsChoice).toBe(true);
    expect(paint.alternatives.map((a) => [a.product.title, a.probability])).toEqual([['Wall Touch Up Paint Quart', 0.3]]);
    const sponge = kit.items.find((i) => i.need === 'sanding-sponge')!;
    expect(sponge.needsChoice).toBe(true);

    const before = s.checkouts.length;
    const chosen = await applyChoices(kit, { [paint.key]: paint.alternatives[0]!.variant.id }, { shop: s.shop });
    const p2 = chosen.items.find((i) => i.key === paint.key)!;
    expect(p2).toMatchObject({ pickedBy: 'user', needsChoice: false, price: 12.99, lineTotal: 12.99 });
    expect(p2.alternatives[0]!.product.title).toBe('Ceiling Paint Gallon');
    expect(chosen.diyTotal).toBe(17.48);
    expect(s.checkouts.length - before).toBe(2); // rebuilt, one per seller
    const unknown = await applyChoices(kit, { [paint.key]: 'gid://shopify/ProductVariant/nope' }, { shop: s.shop, checkout: false });
    expect(unknown.warnings.at(-1)).toContain('is not one of the kept options');
  });

  it('a single candidate needs no Decisions call; no candidate goes to missing and the kit is incomplete', async () => {
    let asked = 0;
    const s = scriptedShop(CATALOG);
    const kit = await buildFixKit([item('living-room.wall-s', 'new-damage', 'hole', 153.4)], plan, [], {
      env: testEnv(),
      checkout: false,
      deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: async (c) => (asked++, firstPick(c)) },
    });
    expect(kit.items.find((i) => i.need === 'putty-knife')).toMatchObject({ pickedBy: 'only-candidate', confidence: 1 });
    expect(kit.missing.map((m) => m.need)).toEqual(['spackle']);
    expect(kit.complete).toBe(false);
    expect(asked).toBe(1); // paint only
    // the spackle miss retried once with the default query (same here), then gave up
    expect(s.searches.filter((a) => a.query.includes('spackling'))).toHaveLength(1);
  });
});

describe('e/f. checkouts per seller, money math', () => {
  it('groups by seller, merges identical variants, one create_checkout per seller; totals in cents', async () => {
    const s = scriptedShop(CATALOG);
    const events: FixKitEvent[] = [];
    const diff = [item('living-room.wall-n', 'new-damage', 'scuff', 72.72), item('bedroom.wall-e', 'new-damage', 'scuff', 60.6), item('living-room.wall-s', 'moved')];
    const kit = await buildFixKit(diff, plan, [], { unitId: 'demo', env: testEnv(), deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: firstPick }, onEvent: (e) => events.push(e) });
    expect(FixKitSchema.parse(kit)).toEqual(kit);
    expect(kit.items).toHaveLength(4);
    expect(s.checkouts).toEqual([
      { shop: 'paint.myshopify.com', lines: [{ variantId: 'gid://shopify/ProductVariant/paint-1', quantity: 2 }], country: 'US' },
      { shop: 'tools.myshopify.com', lines: [{ variantId: 'gid://shopify/ProductVariant/sponge-1', quantity: 2 }], country: 'US' },
    ]);
    expect(kit.checkouts.map((c) => [c.seller, c.subtotal, c.lines[0]!.quantity])).toEqual([
      ['Paint Co', 25.98, 2],
      ['Tool Shed', 10.98, 2],
    ]);
    expect(kit.checkouts.every((c) => c.continue_url?.startsWith('https://'))).toBe(true);
    // 2 × 12.99 + 2 × 5.49 = 36.96 DIY vs 72.72 + 60.60 = 133.32 deduction
    expect(kit.diyTotal).toBe(36.96);
    expect(kit.deductionTotal).toBe(133.32);
    expect(kit.savings).toBe(96.36);
    expect(kit.complete).toBe(true);
    expect(s.products).toHaveLength(4); // every pick re-read with get_product
    expect(kit.items.every((i) => i.confirmed)).toBe(true);

    // progress events: rules → query → searching → picked → checkout per seller → done
    expect(events[0]).toMatchObject({ step: 'rules', diffItems: 2, needs: 4, done: 0 });
    expect(events.filter((e) => e.step === 'query')).toHaveLength(4);
    expect(events.filter((e) => e.step === 'searching')).toHaveLength(4);
    const pickedE = events.find((e) => e.step === 'picked')!;
    expect(describeFixKitEvent(pickedE)).toMatch(/^picked “.+” from .+ · \$\d+\.\d\d \(90%\)$/);
    expect(events.filter((e) => e.step === 'checkout').map((e) => describeFixKitEvent(e))).toEqual(['building checkout for Paint Co (1 item)', 'building checkout for Tool Shed (1 item)']);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ step: 'done', diyTotal: 36.96, deductionTotal: 133.32, savings: 96.36 });
    expect(last.done).toBe(last.total);
    expect(events.every((e, i) => i === 0 || e.done >= events[i - 1]!.done)).toBe(true);
  });

  it('live-run regression: 1 charged new-damage "other" at $85 → deduction = statement total (8500 cents), kit non-empty', async () => {
    const diff = [item('bedroom.wall-w', 'new-damage', 'other', 85), item('living-room.wall-e', 'not-visible', 'scuff', 40, { reason: 'Not provable: 1 pair' })];
    const statement = buildStatement('demo', '2026-11-21', diff);
    expect(statement.totalUsd).toBe(85);
    // Scripted shop: no adhesive remover in the catalog, paint + sponge found. Deduction still counts the whole charged item.
    const s = scriptedShop(CATALOG);
    const kit = await buildFixKit(statement.items, plan, [], { env: testEnv(), checkout: false, deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: firstPick } });
    expect(Math.round(kit.deductionTotal * 100)).toBe(8500);
    expect(kit.deductionTotal).toBe(statement.totalUsd);
    expect(kit.items.map((i) => i.need)).toEqual(['touch-up-paint', 'sanding-sponge']);
    expect(kit.uncovered).toEqual([]);
    expect(kit.missing.map((m) => m.need)).toEqual(['adhesive-remover']);
    // Full mock mode (Hydrogen + Decisions + Shop mocks): all three needs, same deduction.
    const full = await buildFixKit(statement.items, plan, [], { env: testEnv(), checkout: false });
    expect(full.items.length).toBeGreaterThan(0);
    expect(Math.round(full.deductionTotal * 100)).toBe(8500);
    // applyChoices keeps the statement deduction.
    expect((await applyChoices(kit, {}, { env: testEnv(), checkout: false })).deductionTotal).toBe(85);
  });

  it('not-provable and uncharged items add $0 deduction; a failing seller does not sink the kit', async () => {
    const s = scriptedShop(CATALOG);
    s.shop.createCheckout = async (a) => {
      if (a.shop.startsWith('tools')) throw new Error('Shop MCP create_checkout: upstream_error');
      return { id: 'x', status: 'incomplete', messages: [{ type: 'warning', content: 'Ships in 5 days' }], continue_url: 'https://paint/c' } as CheckoutDoc;
    };
    const kit = await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 0)], plan, [], { env: testEnv(), deps: { shop: s.shop, writeQuery: fixedQuery, pickProduct: firstPick } });
    expect(kit.deductionTotal).toBe(0);
    expect(kit.savings).toBe(-18.48);
    expect(kit.checkouts.find((c) => c.shop.startsWith('paint'))).toMatchObject({ messages: ['Ships in 5 days'] });
    expect(kit.checkouts.find((c) => c.shop.startsWith('tools'))!.error).toContain('upstream_error');
  });
});

describe('never completes a checkout', () => {
  it('a full build over the real Shop client sends only search_catalog, get_product and create_checkout', async () => {
    const tools: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number; params: { name: string; arguments: { catalog?: { query: string } } } };
      const name = body.params.name;
      tools.push((init.headers as Record<string, string>)['Mcp-Name']!);
      const doc =
        name === 'search_catalog'
          ? searchDoc(CATALOG(body.params.arguments.catalog!.query))
          : name === 'get_product'
            ? { product: searchDoc(CATALOG('paint')).products[0] }
            : { id: 'co', status: 'ready_for_complete', messages: [], continue_url: 'https://m.example/c' };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { isError: false, structuredContent: doc } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const env = testEnv({ SHOP_MODE: 'live' });
    const kit = await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 72.72), item('living-room.wall-s', 'new-damage', 'hole', 153.4)], plan, [], {
      env,
      deps: { shop: shopClient({ env, fetchImpl }), writeQuery: fixedQuery, pickProduct: firstPick },
    });
    expect(kit.checkouts.length).toBeGreaterThan(0);
    expect(new Set(tools)).toEqual(new Set(['search_catalog', 'get_product', 'create_checkout']));
    expect(tools).not.toContain('complete_checkout');
    // a ready_for_complete checkout is still only handed over as continue_url
    expect(kit.checkouts.every((c) => c.status === 'ready_for_complete' && c.continue_url)).toBe(true);
    expect(readCalls(env).filter((c) => c.tag.startsWith('shop.')).every((c) => !JSON.stringify(c).includes('m.example'))).toBe(true);
  });

  it('runs end to end in full mock mode (Hydrogen + Decisions + Shop mocks)', async () => {
    const env = testEnv();
    const kit = await buildFixKit([item('living-room.wall-n', 'new-damage', 'scuff', 72.72)], plan, [], { env });
    expect(kit.items.map((i) => i.query)).toEqual(['interior wall touch up paint', 'fine grit sanding sponge']);
    expect(kit.checkouts.every((c) => c.continue_url?.startsWith('https://checkout.mock.invalid/'))).toBe(true);
    const tags = readCalls(env).map((c) => c.tag);
    expect(tags.filter((t) => t === 'shop.create_checkout').length).toBe(kit.checkouts.length);
    expect(tags.some((t) => t.includes('complete'))).toBe(false);
  });
});

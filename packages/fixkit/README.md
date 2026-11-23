# @ledger/fixkit: Shopify fix kit (bonus track)

For every **charged** line of a statement, LEDGER finds the supplies a tenant needs to fix it before move-out, on Shopify, and builds an **unpaid** checkout link per store. The tenant opens the link and decides. LEDGER never pays: `complete_checkout` is not callable from `shop.ts` (allow-list + test).

- API: Shop MCP `https://mcp.shop.com/` (https://shop.dev/docs), no key for search or checkout creation. Tools used: `search_catalog`, `create_checkout`.
- What to buy per damage type is a fixed table, `REPAIR_NEEDS` in `src/fixkit.ts` (scuff: eraser sponge + touch-up paint; hole: spackle kit; crack: crack filler; stain: stain-blocking primer; missing fixture / other: "needs a professional"). Not model output, so nothing odd lands in a cart.
- Pick rule: available, USD, under the need's price cap, best rated then cheapest. One checkout per store (a checkout belongs to one merchant).

```
pnpm --filter @ledger/fixkit fixkit .data/units/<unitId>      # reads diff.json, writes fixkit.json next to it
import { buildFixKit, shopClient } from '@ledger/fixkit'       # for the API / web app
```

Measured live (Nov 21, 13:58): a sample statement with a scuff ($85) and a hole ($120) gave 3 products and 3 checkout links in 1.7 s; kit $36.35 at list prices.

Honest limits: prices and stock come from live merchants and change; a store's checkout total can differ from the listed price (one came back $5.58 vs $5.99 listed); the "potential savings" assume the tenant does the repair well, and the landlord can still judge the result. Not legal advice.

> Source: https://shop.dev/docs/quickstart (fetched 2026-11-21 from https://shop.dev/docs/quickstart.md). Saved verbatim; links are relative to https://shop.dev/docs/.

# Quickstart

Send your first search to Shop MCP over HTTP and read what comes back. It takes no account or API key.

This page sends one `search_catalog` call to Shop MCP and walks through the result. You need `curl`, or Node.js 18 or later for the JavaScript version.

## Send a search

A tool call is a JSON-RPC `tools/call` request, POSTed to `https://mcp.shop.com/`. This one looks for rain jackets that cost at most 80 CAD, for a shopper in Canada:

```sh
curl -s https://mcp.shop.com/ \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: search_catalog' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_catalog",
      "arguments": {
        "catalog": {
          "query": "rain jacket",
          "context": { "address_country": "CA", "currency": "CAD" },
          "filters": { "price": { "max": 8000 } },
          "pagination": { "limit": 5 }
        }
      },
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "my-app", "version": "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

The same request in JavaScript, which prints each result's featured price and seller. Save it as `search.mjs` and run `node search.mjs`:

```js
const response = await fetch('https://mcp.shop.com/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': 'tools/call',
    'Mcp-Name': 'search_catalog',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        catalog: {
          query: 'rain jacket',
          context: { address_country: 'CA', currency: 'CAD' },
          filters: { price: { max: 8000 } },
          pagination: { limit: 5 },
        },
      },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'my-app', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }),
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { result, error } = await response.json();
if (error) throw new Error(error.message);
if (result?.isError) {
  const text = result.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  throw new Error(text || 'Search failed');
}
const document = result?.structuredContent;
if (!Array.isArray(document?.products)) throw new Error('Search returned no products document');
for (const message of document.messages ?? []) {
  if (message.type === 'warning') console.warn(message.content);
}

// Prices are integers in the currency's minor units: 6400 in CAD is 64.00.
const money = ({ amount, currency }) => {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency });
  return format.format(amount / 10 ** format.resolvedOptions().maximumFractionDigits);
};

for (const product of document.products) {
  const [variant] = product.variants;
  console.log(`${product.title}: ${money(variant.price)} from ${variant.seller.name}`);
}
```

```text
Craven Mens Waterproof Packaway Jacket - Black: CA$64.00 from TOG24
Men's Waterproof Rain Jacket V2 | Full Zip: CA$74.00 from Combat Iron Apparel Co.
Craven Mens Waterproof Packaway Jacket - Dark Orange: CA$64.00 from TOG24
Burradon Womens Waterproof Jacket - Magenta Pink: CA$75.00 from TOG24
Watertight II Rain Jacket - Men’s: CA$71.99 from SAIL plein air
```

Your results will differ as merchants change their stock and prices.

### What each part does

The server keeps no session, so there's no `initialize` call before this one. Instead, every request names the protocol version and your client in `params._meta`. Set `clientInfo` to your app's own name and version.

The `Mcp-Method` and `Mcp-Name` headers repeat the method and tool name from the body. Send both with every call, and match them to the body.

`Accept` lists both JSON and an event stream, as MCP requires of clients. Shop answers with plain JSON.

## Read the result

Here is the response, cut down to the third product and with most of its fields left out:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "complete",
    "isError": false,
    "content": [{ "type": "text", "text": "{\"ucp\":{\"version\":\"2026-08-25\"},\"products\":[…]}" }],
    "structuredContent": {
      "ucp": { "version": "2026-08-25" },
      "products": [
        {
          "id": "gid://shopify/p/21LZl7P8DjyKRD7lJqv40C",
          "title": "Craven Mens Waterproof Packaway Jacket - Dark Orange",
          "rating": { "value": 4.8, "scale_min": 1, "scale_max": 5, "count": 850 },
          "options": [
            { "name": "Size", "values": [{ "label": "S" }, { "label": "M" }, { "label": "L" }, { "label": "XL" }] }
          ],
          "price_range": {
            "min": { "amount": 6400, "currency": "CAD" },
            "max": { "amount": 6400, "currency": "CAD" }
          },
          "variants": [
            {
              "id": "gid://shopify/ProductVariant/40439010361434",
              "options": [{ "name": "Size", "label": "S" }],
              "price": { "amount": 6400, "currency": "CAD" },
              "availability": { "available": true },
              "url": "https://www.tog24.com/products/craven-mens-milatex-5-5-jacket-dark-orange?variant=40439010361434&_gsid=mzWAwFn2Twg1&utm_source=shopify&utm_medium=catalog",
              "seller": {
                "id": "gid://shopify/Shop/4439113818",
                "name": "TOG24",
                "url": "https://www.tog24.com",
                "domain": "tog24.myshopify.com"
              }
            }
          ]
        }
      ],
      "messages": [
        {
          "type": "info",
          "code": "price_filter_applied",
          "path": "$.filters.price",
          "content": "Price filtering was applied on a USD basis; returned prices are contextualized to the buyer's market and may differ."
        }
      ],
      "pagination": {
        "has_next_page": true,
        "total_count": 371,
        "cursor": "eyJvZmZzZXQiOjUsInRvdGFsX2NvdW50IjozNzEsInJldHVybmVkIjo1fQ"
      },
      "next": [
        "Show every warning; it may change price, availability, terms or required disclosures. …"
      ]
    }
  }
}
```

`structuredContent` is the result as JSON. `content[0].text` carries the same document as a string, for clients that only read text.

Each product lists all of its options, but `variants` holds one featured variant: a single size and color that Shop picked for this search. Its `id`, `price`, `availability` and `seller` are what you show the shopper and later pass to checkout. Keep the variant's `url` exactly as returned, query string included. To show another size, call `get_product` as described in [Find products](search.md#choose-a-size-or-color).

Prices are integers in the currency's minor units, so `6400` CAD is 64.00 CAD.

`messages` reports how Shop handled the request. Here it says the 80 CAD cap was converted to USD before filtering, so the CAD prices that come back may not line up with the cap exactly. Show the shopper every message of type `warning`.

To get the next page, send the same query, context and filters again with `pagination.cursor` set to the returned cursor.

`next` is a list of suggestions from Shop for an agent working with this result, such as how to show warnings and when `get_product` is worth a call. Pass them to your model along with the result. An app with no model in the loop can ignore them.

## When a request fails

A request the server can't accept gets an HTTP error and a JSON-RPC `error`. Asking for 51 results, one over the limit, returns HTTP 400:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"$.catalog.pagination.limit: maximum constraint failed"}}
```

A tool that runs but fails still returns a `result`, with `isError` set to `true` and an error code in `result._meta`. [Errors and retries](errors.md) lists both kinds and which ones are safe to retry.

## The same search from the CLI

The `shop` CLI builds this request from flags:

```sh
shop search 'rain jacket' --country CA --currency CAD --price-max 8000 --limit 5
```

Add `--dry-run --as curl` to print the request as a `curl` command instead of sending it. The [CLI reference](cli.md) covers installing it.

## From a prototype to your app

The CLI includes a public client for trying Sign in with Shop and personalized results. Before distributing your own app, use its own registered application client so shoppers recognize your app and its production access can be managed separately. [Application clients](authentication.md#application-clients) explains the distinction; [Connect a Shop account](sign-in.md#in-your-own-code) covers the OAuth integration.

The `clientInfo` in this example names your software; changing it does not register an OAuth client or raise your rate limits. The anonymous search above needs no shopper token.

## Next steps

- [Find products](search.md) covers filters, image search and choosing a variant.
- [Find physical stores](locations.md) searches a selected merchant's directory without promising stock or pickup.
- [Carts and checkout](checkout.md) takes a variant from search to an order.
- [Connect an agent](connect.md) adds Shop to Claude, ChatGPT or another MCP client.

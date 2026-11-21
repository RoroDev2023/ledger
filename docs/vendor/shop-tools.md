> Source: https://shop.dev/docs/tools (fetched 2026-11-21 from https://shop.dev/docs/tools.md). Saved verbatim; links are relative to https://shop.dev/docs/.

# Tool reference

Shop MCP tools, what each one needs, how they're annotated, and the arguments they have in common.

`tools/list` returns the available Shop MCP tools with their descriptions, input schemas and annotations. The guides linked below show how to use them, and the input schema is the exact reference for each argument.

| Tool | What it does | Sign-in | CLI |
| --- | --- | --- | --- |
| `search_catalog` | Searches for products by text, a similar product or a photo | Optional | `shop search` |
| `lookup_catalog` | Finds products from IDs, GTINs or URLs you already have | Optional | `shop catalog lookup` |
| `get_product` | Gets one product's details and options, and resolves a variant | Optional | `shop catalog get` |
| `search_locations` | Searches one merchant's physical-store directory | Optional | `shop location search` |
| `lookup_locations` | Retrieves that merchant's stores by returned location IDs | Optional | `shop location lookup` |
| `create_cart` | Saves items in a cart at one merchant | Optional | `shop cart create` |
| `get_cart` | Reads a cart | Optional | `shop cart get` |
| `update_cart` | Replaces a cart's contents | Optional | `shop cart update` |
| `create_checkout` | Starts a checkout at one merchant | Optional | `shop checkout create` |
| `get_checkout` | Reads a checkout | Optional | `shop checkout get` |
| `update_checkout` | Replaces a checkout's details, such as items or delivery | Optional | `shop checkout update` |
| `complete_checkout` | Pays for a checkout and places the order | Optional | `shop checkout complete` |
| `search_orders` | Searches the shopper's Shop-tracked history; in-progress orders by default | Required | `shop order search` |
| `get_account` | Reads the shopper's profile, addresses and payment options | Required | `shop account` |
| `create_spend_request` | Asks the shopper to approve a purchase outside Shopify | Required | `shop spend-request create` |
| `get_spend_request` | Reads status and terms; explicit `include: "card"` requests the card after approval | Required | `shop spend-request get` |
| `update_spend_request` | Changes a spend request's limit, items, totals or address | Required | `shop spend-request update` |
| `cancel_spend_request` | Cancels a spend request | Required | `shop spend-request cancel` |
| `complete_spend_request` | Records how the purchase went | Required | `shop spend-request complete` |

With a token, the tools that don't require sign-in run as the signed-in shopper. [Authentication](authentication.md) covers tokens, and these guides cover the tools:

- [Search the catalog](search.md): `search_catalog`, `lookup_catalog` and `get_product`.
- [Find physical stores](locations.md): `search_locations` and `lookup_locations`.
- [Check out](checkout.md): the cart and checkout tools.
- [Track orders](orders.md): `search_orders`.
- [Connect a Shop account](sign-in.md#check-the-connection): `get_account`.
- [Spend requests](spend-requests.md): the spend request tools.

There are no tools to cancel a cart or a checkout, or to read a single order by its ID.

## Annotations

| Tools | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| --- | --- | --- | --- |
| `search_catalog`, `lookup_catalog`, `get_product`, `search_locations`, `lookup_locations`, `get_cart`, `get_checkout`, `search_orders`, `get_account` | `true` | `false` | `true` |
| Every other tool | `false` | `true` | `false` |

`get_spend_request` remains potentially mutating: scalar `include: "card"` requests issuance or replay after approval. Without `include`, it only reads status and terms. Every tool has `openWorldHint: true`, because each call reaches the catalog, a merchant or Shop.

## Arguments

| Tool | Arguments | Required |
| --- | --- | --- |
| `search_catalog` | `catalog`: `query`, `like`, `context`, `filters`, `pagination`, `catalog_id`, `signals` | `catalog`, with `query` or `like` |
| `lookup_catalog` | `catalog`: `ids`, `context`, `filters`, `signals` | `catalog.ids`, 1 to 50 |
| `get_product` | `catalog`: `id`, `selected`, `preferences`, `context`, `filters`, `signals` | `catalog.id` |
| `search_locations` | `shop`, `location`: `query`, `distance`, `filters`, `serves`, `context`, `pagination`, `signals` | `shop`, `location` |
| `lookup_locations` | `shop`, `location`: `ids`, `distance`, `filters`, `serves`, `context`, `signals` | `shop`, `location.ids`, 1 to 10 |
| `create_cart` | `shop`, `cart`, `meta` | `shop`, `cart.line_items` |
| `get_cart`, `get_checkout` | `shop`, `id` | Both |
| `update_cart` | `shop`, `id`, `cart`, `meta` | `shop`, `id`, `cart.line_items` |
| `create_checkout` | `shop`, `checkout`, `meta` | `shop`, `checkout.line_items` |
| `update_checkout` | `shop`, `id`, `checkout`, `meta` | `shop`, `id`, `checkout.line_items` |
| `complete_checkout` | `shop`, `id`, `checkout`: `payment`, `signals`, and `meta` | `shop`, `id`, `checkout.payment` |
| `search_orders` | `orders`: `query`, `filters.status`, `filters.date`, `pagination` | `orders` |
| `get_account` | None | None |
| `create_spend_request` | `spend_request`, `meta` | `spend_request` |
| `get_spend_request` | `id`, optional scalar `include: "card"` | `id` |
| `cancel_spend_request` | `id`, `meta` | `id` |
| `update_spend_request` | `id`, `spend_request`, `meta` | `id`, `spend_request` |
| `complete_spend_request` | `id`, `result` | Both |

### `shop`

The merchant for a cart, checkout or location directory. Pass the `seller.domain` of the product's offer exactly, as a hostname with no scheme or path, such as `tog24.myshopify.com`. Each cart or checkout belongs to one merchant, and every later call on it takes the same `shop`.

### `id`

The ID that a create returned. Cart and checkout IDs are opaque, so pass them back exactly as you got them. Spend request IDs are UUIDs.

### `meta.idempotency-key`

A UUID that marks repeated sends of one write as the same operation. Reuse it when you repeat a request, and make a new one for each new operation. `complete_checkout` makes one from the request when you leave it out, but never send a completion twice. [Retries](errors.md#retries) explains when it's safe to repeat a write.

`meta` takes nothing else. Shop MCP adds its own agent profile when it calls the catalog and merchants.

### `signals`

The catalog, cart and checkout tools accept `signals`, with facts your platform observed about the shopper's request:

| Signal | Value |
| --- | --- |
| `dev.ucp.buyer_ip` | The shopper's IP address |
| `dev.ucp.user_agent` | The user agent of the shopper's browser or app |

Shop MCP passes them on to the catalog or merchant. Send them only when your platform observed them, as a server acting for a shopper's browser can. Without them, Shop MCP uses what it sees of the request itself: its IP address, or the leftmost `X-Forwarded-For` address, and its `User-Agent` or the MCP client name.

When you update a cart or checkout, remove the `signals` that came back in the copy you read before you send it.

## Results

A result has the tool's document in `structuredContent`, and the same document as a JSON string in `content[0].text`, for clients that only read text. The tools don't publish an output schema.

Documents can carry `messages`, with warnings and errors to show the shopper or act on, and `next`, with Shop MCP's suggestions for an agent working with the result. A failed call has `isError: true`, and some failures have only text. [Errors and retries](errors.md) covers each kind.

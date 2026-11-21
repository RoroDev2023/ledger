> Source: https://shop.dev/docs/checkout (fetched 2026-11-21 from https://shop.dev/docs/checkout.md). Saved verbatim; links are relative to https://shop.dev/docs/.

# Carts and checkout

Open a checkout with a merchant, add delivery details and discount codes, then complete the purchase or hand it to the shopper to pay.

Carts and checkouts are created with the merchant that sells the items, through Shop MCP. Each one belongs to a single merchant, so items from three stores take three checkouts.

| Tool | What it does |
| --- | --- |
| `create_cart` | Saves items with one merchant. It places no order. |
| `get_cart`, `update_cart` | Read a cart, or replace it with an edited copy |
| `create_checkout` | Opens a checkout from items or from a cart. It places no order. |
| `get_checkout`, `update_checkout` | Read a checkout, or replace it with an edited copy |
| `complete_checkout` | Pays with a chosen payment method and places the order |

The cart and checkout tools work without sign-in. When the shopper is signed in, their saved addresses can fill in delivery, and the merchant can offer Shop Pay for payment.

## When to create one

Create a cart or checkout only when the shopper asks for one. Interest in a product doesn't count as asking. Use a cart when they want to collect items before deciding, and a checkout when they want to see the full price with delivery and tax, or to buy. To answer "what would it cost with two?", estimate from the prices you have before you edit anything.

## Create a checkout

```json
{
  "shop": "tog24.myshopify.com",
  "checkout": {
    "line_items": [
      { "item": { "id": "gid://shopify/ProductVariant/40439010394202" }, "quantity": 1 }
    ],
    "context": { "address_country": "CA" }
  }
}
```

Set `shop` to the variant's `seller.domain`, and `item.id` to the variant's `id`, both exactly as search returned them. Never rebuild or shorten an ID.

To check out a cart, pass its ID instead of items:

```json
{ "shop": "tog24.myshopify.com", "checkout": { "cart_id": "<cart id>", "line_items": [] } }
```

From the CLI, `--variant` also takes the number at the end of a variant ID:

```sh
shop checkout create --shop tog24.myshopify.com --variant 40439010394202 --country CA
shop checkout create --shop tog24.myshopify.com --cart '<cart id>'
```

Carts take the same arguments, with `cart` in place of `checkout`.

### What comes back

The result's `structuredContent` is the checkout document:

| Field | What it holds |
| --- | --- |
| `id` | The checkout's ID. Pass it back exactly to read, update or complete the checkout. |
| `status` | Where the checkout stands. See the next section. |
| `line_items` | Each line's own `id`, its `item` (variant ID, title, unit price and image), `quantity` and line `totals` |
| `currency` | The currency the merchant picked for this checkout, which can differ from the one you asked for |
| `totals` | Entries such as `subtotal`, `discount`, `fulfillment`, `tax` and `total`, each with a `display_text` label |
| `fulfillment` | Delivery methods, their destinations, and `groups` of delivery options to choose from |
| `discounts` | The discount codes on the checkout |
| `payment.instruments` | The payment methods the merchant offers for this checkout |
| `messages` | Errors, warnings and notes about the checkout |
| `links` | The merchant's terms of service, privacy policy and other legal pages |
| `continue_url` | The merchant's page where the shopper can review and pay |
| `expires_at` | When the checkout expires, 6 hours after creation by default |
| `order` | The placed order, once the checkout is completed |

Show the shopper every warning, every link in `links`, and the totals with their labels. Warnings marked as disclosures belong next to the item or field they refer to, and must stay visible.

The checkout `id` and `continue_url` each include a key that gives access to the checkout. Keep them out of logs and analytics, and share `continue_url` only with the shopper.

## Checkout status

| `status` | Meaning | What to do |
| --- | --- | --- |
| `incomplete` | Something is missing, such as a delivery address | Read `messages`, then fix it with `update_checkout` |
| `requires_escalation` | The shopper has to finish a step on the merchant's page | Give them `continue_url` |
| `ready_for_complete` | The checkout can be paid | Confirm with the shopper, then call `complete_checkout` |
| `complete_in_progress` | Payment is processing | Read it again with `get_checkout` |
| `completed` | The order was placed, and `order` describes it | Show the order to the shopper |
| `canceled` | The checkout was canceled | Create a new one only if the shopper asks |

Error messages carry a `severity` that says who can fix the problem:

| `severity` | Who acts |
| --- | --- |
| `recoverable` | You can, by changing the checkout and sending it again |
| `requires_buyer_input` | The shopper, who has to give the merchant something its API can't collect |
| `requires_buyer_review` | The shopper, who has to approve the purchase on the merchant's page |
| `unrecoverable` | Nobody. Start again with a new checkout or different items. |

Errors that need the shopper set the status to `requires_escalation`.

## Edit a cart or checkout

`update_cart` and `update_checkout` replace the whole document with the one you send. Fields you leave out are removed, and so are lines: an update without a line deletes it. To edit safely:

1. Read the current document with `get_cart` or `get_checkout`.
2. Copy it from `structuredContent`, then remove the root `next`, `signals` and `attribution` fields.
3. Find the line to change by its own `id`, not by `item.id`, which identifies the variant.
4. Change only what the shopper asked for. Keep every other field as it was, including empty arrays such as `payment.instruments` and fields you don't recognize. Don't recalculate totals.
5. Send `update_checkout` with `shop`, `id` and the edited document under `checkout`.
6. Check the items, quantities, prices, messages and status that come back.

The CLI does the read, the copy and the update for you. Give it a JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) to apply to the fresh copy. Each change to a line has to follow a `test` of that line's `id`, so the edit fails instead of landing on the wrong line if the order has changed:

```sh
shop checkout update '<checkout id>' --shop tog24.myshopify.com --patch '[
  { "op": "test", "path": "/line_items/0/id", "value": "<line id>" },
  { "op": "replace", "path": "/line_items/0/quantity", "value": 2 }
]'
```

Adding a line at the end needs no test:

```sh
shop checkout update '<checkout id>' --shop tog24.myshopify.com --patch '[
  { "op": "add", "path": "/line_items/-", "value": { "item": { "id": "gid://shopify/ProductVariant/40439010361434" }, "quantity": 1 } }
]'
```

`--patch` also reads a file with `--patch @patch.json`, or standard input with `--patch -`. The same flags work for `shop cart update`.

### Add a delivery address

When a checkout is `incomplete` for lack of an address and the shopper is signed in, call `get_account`. Copy one entry of its `addresses` unchanged into `fulfillment.methods[].destinations`, and set that method's `selected_destination_id` to the entry's `id`. Use the entry named by `preferred_address_id` unless the shopper picks another. Never type in or change address fields yourself.

```json
[
  {
    "op": "add",
    "path": "/fulfillment/methods/0/destinations/-",
    "value": {
      "id": "<address id>",
      "first_name": "Sam",
      "last_name": "Lee",
      "street_address": "1 Example Way",
      "address_locality": "Ottawa",
      "address_region": "ON",
      "postal_code": "K1A 0B1",
      "address_country": "CA"
    }
  },
  { "op": "add", "path": "/fulfillment/methods/0/selected_destination_id", "value": "<address id>" }
]
```

`buyer.email` from `get_account` is for display. Don't copy it into a checkout.

Once there's a destination, the merchant lists delivery options in `fulfillment.methods[].groups[].options`. To choose one, set the group's `selected_option_id` to the option's `id`.

### Apply a discount code

Set `discounts.codes` to the full list of codes the checkout should have. The list replaces the codes already there, and an empty list removes them all.

```sh
shop checkout update '<checkout id>' --shop tog24.myshopify.com --patch '[
  { "op": "add", "path": "/discounts/codes", "value": ["WELCOME10"] }
]'
```

The merchant decides whether a code applies. Check `totals` and `messages` in the result.

## Hand off to the shopper

`continue_url` opens the checkout on the merchant's site, where the shopper can review it and pay. Share it unchanged, with every query parameter, alongside the items it covers. Give it even when you could complete the checkout yourself, and give it for every merchant when an order spans several.

For `requires_escalation`, the link is the only way forward: the shopper finishes the step on the merchant's page.

## Complete a checkout

`complete_checkout` pays and places the order. Use it only after the shopper has approved the purchase:

1. Start from the latest checkout. If it might be out of date, read it again with `get_checkout`.
2. Go on only if `status` is `ready_for_complete`. If `payment.instruments` is empty, give the shopper `continue_url` instead.
3. Show the shopper the merchant, the items and quantities, the current total and the offered payment methods, and have them choose one. Never pick a default for them.
4. Send `complete_checkout` once, with the chosen instrument copied exactly as returned and `selected` set to `true`.

```json
{
  "shop": "tog24.myshopify.com",
  "id": "<checkout id>",
  "checkout": {
    "payment": {
      "instruments": [
        {
          "id": "saved-1",
          "handler_id": "shop_pay",
          "type": "shop_pay",
          "credential": { "type": "shop_token" },
          "selected": true
        }
      ]
    }
  }
}
```

Real instruments carry more fields, which can include a credential. Copy every field, and don't print the instrument or write it to logs. With the CLI, put the instrument object in a file, or pipe it on standard input, so it stays out of your shell history. The CLI adds `selected: true` itself:

```sh
shop checkout complete '<checkout id>' --shop tog24.myshopify.com --instrument @instrument.json
```

Only a result with status `completed` and an `order` confirms the purchase. Show every message that comes back with it.

### If the outcome is unclear

Don't send `complete_checkout` again, even with the same idempotency key, and don't start a replacement checkout. Call `get_checkout` instead. If it shows `completed` with an `order`, the purchase went through. Any other state, or a failed read, means the purchase isn't confirmed: tell the shopper, give them `continue_url`, and stop there.

## Retry other writes

Create and update calls accept an idempotency key, a UUID in `meta`:

```json
{
  "shop": "tog24.myshopify.com",
  "checkout": { "line_items": [{ "item": { "id": "gid://shopify/ProductVariant/40439010394202" }, "quantity": 1 }] },
  "meta": { "idempotency-key": "0f8e2b9c-4f5d-4a51-9b1e-6c3d2a7f8e10" }
}
```

After a timeout, read the resource first if you have its ID. To retry, repeat the exact same request with the same key, and use a new key for each new operation. If a create without a key fails before returning an ID, you can't tell whether it ran, so tell the shopper and don't create another. `complete_checkout` makes its own key when you leave one out. [Errors and retries](errors.md) lists the error codes.

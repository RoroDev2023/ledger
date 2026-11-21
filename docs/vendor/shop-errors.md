> Source: https://shop.dev/docs/errors (fetched 2026-11-21 from https://shop.dev/docs/errors.md). Saved verbatim; links are relative to https://shop.dev/docs/.

# Errors and retries

How Shop MCP reports a failed request, what each tool error code means, and when it's safe to send a request again.

A call to Shop MCP can fail in three places, and each one looks different:

| Where it failed | What you get | Did anything run? |
| --- | --- | --- |
| Before the request was read | An HTTP error status | No |
| In the request itself | HTTP 400 with a JSON-RPC `error` | No |
| In the tool | HTTP 200 with a `result` whose `isError` is `true` | Depends on the error |

## HTTP errors

| Status | Cause |
| --- | --- |
| 401, 403, and some 400s | Authentication. [Authentication errors](authentication.md#authentication-errors) lists them. |
| 404 | The wrong path. Shop MCP is only at the root, `https://mcp.shop.com/`. |
| 413 | The request is over 4 MiB, or its JSON has more than 16,384 values or nests deeper than 64 levels. Send less, such as a smaller image. |

## Request errors

A request the server can't accept gets HTTP 400 and a JSON-RPC `error`, and no tool runs. Fix the request before you send it again. For example:

| `code` | `message` |
| --- | --- |
| `-32602` | `$.catalog.pagination.limit: maximum constraint failed` |
| `-32602` | `Unknown tool: tool is not available in the hosted profile` |
| `-32602` | `Invalid params: request _meta is missing or has malformed required fields: …` |
| `-32020` | `` Mcp-Name header `get_product` does not match body value `search_catalog` `` |
| `-32600` | `Invalid Request: MCP-Protocol-Version header (2026-07-28) does not match initialize params.protocolVersion (2025-06-18)` |

The `-32602` messages for arguments point to the field with a JSONPath, such as `$.catalog.pagination.limit`.

## Tool errors

A tool that runs and fails still returns a `result`, with `isError: true`. There are two kinds.

### The service answered with an error

The catalog, the merchant or Shop answered, and the error is in the document. `structuredContent` has `ucp.status: "error"` and `messages` that say what went wrong. Asking `get_product` for a product that doesn't exist returns:

```json
{
  "ucp": { "version": "2026-08-25", "status": "error" },
  "messages": [
    {
      "type": "error",
      "code": "not_found",
      "content": "Product not found: gid://shopify/p/doesnotexist000",
      "severity": "unrecoverable"
    }
  ]
}
```

Show the messages to the shopper, or act on them as [Checkout status](checkout.md#checkout-status) describes for carts and checkouts.

A checkout that needs the shopper to finish on the merchant's page isn't an error: its `status` is `requires_escalation`, and `isError` is `false`.

### Shop MCP couldn't get an answer

When the service didn't send a usable answer, the result has no `structuredContent`. Its text says what happened, and `_meta` carries a code:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "isError": true,
    "content": [{ "type": "text", "text": "Shopify Catalog rate-limited search_catalog (HTTP 429). Retry after 30 s." }],
    "_meta": {
      "com.shopify/error": { "code": "rate_limited", "retry_after": 30 },
      "com.shopify/upstream_status": 429
    }
  }
}
```

| `_meta` field | What it holds |
| --- | --- |
| `com.shopify/error.code` | The error code, from the table below |
| `com.shopify/error.retry_after` | Seconds to wait before acting again, from 1 to 3600, when the service gave one |
| `com.shopify/error.upstream_code` | The JSON-RPC error code the service returned |
| `com.shopify/error.continue_url` | A page where the shopper can carry on, when the merchant gave one |
| `com.shopify/upstream_status` | The HTTP status the service returned, when it wasn't a success |
| `com.shopify/shop` | The merchant, on cart, checkout and location calls |

| `code` | Meaning | What to do |
| --- | --- | --- |
| `rate_limited` | The service is limiting requests. Nothing ran. | Wait for `retry_after`, if given, before acting again |
| `upstream_error` | The service rejected the call. Nothing ran. | Read the text. Offer `continue_url` if there is one. |
| `upstream_rejected` | The service refused the call with an HTTP error or a redirect. Nothing ran. | Check `shop` and the IDs you sent |
| `upstream_unavailable` | A read failed with a server error | Try again, after `retry_after` if given |
| `upstream_input_required` | The merchant asked for more input than a tool call can give. Nothing ran. | Tell the shopper. If you have the checkout's `continue_url`, give it to them. |
| `upstream_response_too_complex` | A read returned more than Shop MCP accepts | Ask for less, such as a lower `limit` |
| `upstream_response_rejected` | Shop MCP couldn't accept the service's response | Tell the shopper the request failed |
| `ambiguous_outcome` | A write may or may not have happened | Read before you repeat anything. See below. |
| `discovery_failed` | Shop MCP couldn't find the merchant's checkout service. Nothing reached the merchant. | Check that `shop` is the variant's `seller.domain` |
| `delegation_denied`, `identity_unavailable`, `identity_overloaded` | Shop couldn't get access for a signed-in call | See [Authentication errors](authentication.md#authentication-errors) |
| `sign_in_required` | The tool needs a signed-in shopper | Offer [sign-in](sign-in.md) |

The spend request tools return their own error documents, and `com.shopify/error.code` repeats the document's first message code, such as `invalid_instrument`.

## Retries

Shop MCP never retries a call for you. Whether you can repeat one depends on what it does.

### Reads

`search_catalog`, `lookup_catalog`, `get_product`, `search_locations`, `lookup_locations`, `get_cart`, `get_checkout`, `search_orders` and `get_account` change nothing, so you can repeat them unless the result tells you not to. After `rate_limited`, wait for `retry_after` first. For `search_orders`, don't keep retrying a throttled search.

Without `include`, `get_spend_request` passively reads status and terms in every state; it never issues or replays a card. Scalar `include: "card"` explicitly requests issuance or replay and keeps the tool potentially mutating. `--wait` alone only polls status. Never issue concurrently or automatically retry issuance after an error; follow the returned guidance. `consumed` alone proves neither card delivery nor payment.

### Creates and updates

Send a UUID as `meta.idempotency-key` with each create and update. It helps correlate attempts but doesn't guarantee deduplication. After a timeout or an `ambiguous_outcome`:

1. If you have the resource's ID, read it with `get_cart`, `get_checkout` or a plain `get_spend_request` without `include`. When that shows the result, you're done.
2. If the read can't confirm the result, treat it as unknown and stop. Don't retry unless that operation's guide says it's safe.

A create without a key that failed before returning an ID can't be repeated safely, because it may have worked. Tell the shopper and stop. Use a new key for each new operation.

### Completing a checkout

Never send `complete_checkout` twice, even with the same key. After an uncertain result, call `get_checkout`: only `completed` with an `order` confirms the purchase. Anything else, or a failed read, means it isn't confirmed. Tell the shopper, give them `continue_url`, and stop.

### Spend request outcomes

Don't automatically retry a payment or `complete_spend_request` report after a failure. A failed report doesn't prove the purchase failed; an unknown charge remains unknown. Recording an outcome doesn't pay, prove payment, close the request or revoke the card.

### From the CLI

The CLI reports a failure in its `error` envelope. `retryable` is `true` only when no response came back and repeating can't cause a second effect: always for a read, for another write only when the request wasn't sent, and never for `checkout complete` or a spend request write. The [CLI reference](cli.md#output) covers the envelope and exit codes.

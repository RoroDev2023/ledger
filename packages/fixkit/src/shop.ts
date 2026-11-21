// [Elmir] Minimal client for Shopify's Shop MCP (https://shop.dev/docs): one JSON-RPC POST per tool call,
// no key needed for search and for creating a checkout. complete_checkout (the only step that pays) is
// deliberately NOT callable from this client: LEDGER builds the cart, a person pays on Shopify's page.
export const SHOP_MCP_URL = 'https://mcp.shop.com/';
const PROTOCOL = '2026-07-28';

/** Tools this app may call. Paying (complete_checkout) and spend requests are excluded on purpose. */
export const ALLOWED_TOOLS = ['search_catalog', 'get_product', 'create_checkout', 'get_checkout'] as const;
export type ShopTool = (typeof ALLOWED_TOOLS)[number];

export interface Money { amount: number; currency: string } // amount in minor units (cents)

export interface ShopVariant {
  id: string;
  title?: string;
  price?: Money;
  availability?: { available?: boolean };
  url?: string;
  seller?: { id?: string; name?: string; url?: string; domain?: string };
}
export interface ShopProduct {
  id: string;
  title: string;
  rating?: { value?: number; count?: number } | number;
  media?: { type?: string; url?: string; alt_text?: string }[];
  variants?: ShopVariant[];
}
export interface ShopCheckout {
  id?: string;
  status?: string;
  currency?: string;
  totals?: { type: string; amount: number }[];
  continue_url?: string;
  expires_at?: string;
  messages?: { type?: string; code?: string; content?: string }[];
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class ShopError extends Error {}

/** Parse a JSON-RPC answer that may arrive as plain JSON or as one SSE `data:` line. */
export function parseRpc(text: string): unknown {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const line = t.split('\n').reverse().find((l) => l.startsWith('data:'));
  if (!line) throw new ShopError(`unexpected Shop MCP answer: ${t.slice(0, 120)}`);
  return JSON.parse(line.slice(5).trim());
}

export interface ShopClient {
  call<T>(tool: ShopTool, args: Record<string, unknown>): Promise<T>;
}

export function shopClient(opts: { fetcher?: Fetcher; url?: string; timeoutMs?: number; clientName?: string } = {}): ShopClient {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  let id = 0;
  return {
    async call<T>(tool: ShopTool, args: Record<string, unknown>): Promise<T> {
      if (!(ALLOWED_TOOLS as readonly string[]).includes(tool)) throw new ShopError(`tool ${tool} is not allowed`);
      const body = {
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: {
          name: tool,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL,
            'io.modelcontextprotocol/clientInfo': { name: opts.clientName ?? 'ledger-hackathon', version: '0.1.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
      try {
        const res = await fetcher(opts.url ?? SHOP_MCP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': PROTOCOL,
            'Mcp-Method': 'tools/call',
            'Mcp-Name': tool,
          },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        const text = await res.text();
        if (!res.ok) throw new ShopError(`Shop MCP ${tool} HTTP ${res.status}: ${text.slice(0, 160)}`);
        const rpc = parseRpc(text) as { error?: { message?: string }; result?: { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] } };
        if (rpc.error) throw new ShopError(`Shop MCP ${tool}: ${rpc.error.message ?? 'error'}`);
        const r = rpc.result ?? {};
        if (r.isError) throw new ShopError(`Shop MCP ${tool}: ${r.content?.[0]?.text?.slice(0, 160) ?? 'tool error'}`);
        return (r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}')) as T;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

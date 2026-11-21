import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fresh env with its own DATA_DIR, so tests never touch the repo's .data/. */
export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GEMINI_MODE: 'mock',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'ledger-gemini-')),
    GEMINI_BACKOFF_MS: '1',
    MODEL_DECIDE: 'gemini-decision-1',
    MODEL_FAST: 'gemini-4-hydrogen',
    ...extra,
  };
}

export interface Seen {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

/** Local stand-in for the Gemini REST API. `handle` returns [status, json]. */
export async function fakeApi(handle: (req: Seen, n: number) => [number, unknown]): Promise<{ base: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const s: Seen = { path: req.url ?? '', headers: req.headers, body: JSON.parse(data || '{}') as Record<string, unknown> };
      seen.push(s);
      const [status, json] = handle(s, seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/v1beta`, seen, close: () => new Promise((r) => server.close(() => r())) };
}

/** A well-formed Decisions response answering every question in the request. */
export function answerAll(body: Record<string, unknown>, noul = 0.8): unknown {
  const qs = body.questions as Record<string, { type: string; criteria?: unknown }>;
  const answers: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(qs)) {
    if (q.type === 'noul') answers[k] = { type: 'noul', noul, confidence: Math.max(noul, 1 - noul) };
    else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria as Record<string, string>).sort();
      answers[k] = { type: 'choice', choice: keys[0], probabilities: Object.fromEntries(keys.map((o, i) => [o, i === 0 ? 0.9 : 0.1 / (keys.length - 1)])), confidence: 0.9 };
    } else {
      const levels = q.criteria as string[];
      answers[k] = {
        type: 'score',
        score: 1,
        probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === 1 ? 1 : 0])),
        legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
        confidence: 1,
      };
    }
  }
  return {
    answers,
    usage: { total_input_tokens: 100, input_tokens_by_modality: [{ modality: 'text', tokens: 60 }, { modality: 'image', tokens: 40 }], total_output_tokens: 0, total_tokens: 100 },
  };
}

export function interaction(text: string): unknown {
  return {
    id: 'v1_test',
    status: 'completed',
    steps: [{ type: 'thought', signature: 'x' }, { type: 'model_output', content: [{ type: 'text', text }] }],
    usage: { total_input_tokens: 12, total_output_tokens: 34, total_tokens: 46 },
    object: 'interaction',
  };
}

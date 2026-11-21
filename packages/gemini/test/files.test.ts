import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeminiHttpError, ReplayMissError, readCalls, uploadFile } from '../src/index.js';
import { testEnv } from './helpers.js';

function tempVideo(bytes = 'fake mp4 bytes for the test'): string {
  const p = join(mkdtempSync(join(tmpdir(), 'ledger-vid-')), 'walkthrough.mp4');
  writeFileSync(p, bytes);
  return p;
}

interface Req {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Fake Files API following docs/vendor/files-api.md; `startFailures` 503s before the start succeeds. */
async function fakeFiles(opts: { startFailures?: number; processingPolls?: number; finalState?: string } = {}) {
  const seen: Req[] = [];
  let startFails = opts.startFailures ?? 0;
  let polls = opts.processingPolls ?? 1;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const { port } = server.address() as AddressInfo;
      const json = (status: number, v: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(v));
      };
      const file = (state: string) => ({ name: 'files/abc123', uri: `http://127.0.0.1:${port}/v1beta/files/abc123`, mimeType: 'video/mp4', state });
      if (req.url === '/upload/v1beta/files') {
        if (startFails-- > 0) return json(503, { error: { message: 'busy' } });
        return json(200, {}, { 'x-goog-upload-url': `http://127.0.0.1:${port}/upload/v1beta/files?upload_id=xyz` });
      }
      if (req.url?.startsWith('/upload/v1beta/files?upload_id=')) return json(200, { file: file('PROCESSING') });
      if (req.url === '/v1beta/files/abc123') return json(200, file(polls-- > 1 ? 'PROCESSING' : (opts.finalState ?? 'ACTIVE')));
      json(404, { error: { message: 'not found' } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/v1beta`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('uploadFile (mock)', () => {
  it('returns a deterministic fake URI in content-block shape and logs tag "upload"', async () => {
    const env = testEnv();
    const p = tempVideo();
    const a = await uploadFile(p, 'video/mp4', { env });
    expect(a.mime_type).toBe('video/mp4');
    expect(a.uri).toMatch(/\/files\/mock-[0-9a-f]{16}$/);
    expect(await uploadFile(p, 'video/mp4', { env })).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(['mime_type', 'uri']); // safe to spread into { type: 'video', ...a }
    expect(readCalls(env).map((r) => [r.tag, r.source, r.endpoint, r.questions])).toEqual([
      ['upload', 'mock', 'files', 0],
      ['upload', 'mock', 'files', 0],
    ]);
  });

  it('rejects a missing file or a generic MIME type', async () => {
    const env = testEnv();
    await expect(uploadFile('/nope/missing.mp4', 'video/mp4', { env })).rejects.toThrow(/ENOENT/);
    await expect(uploadFile(tempVideo(), 'application/octet-stream', { env })).rejects.toThrow(/real MIME type/);
  });
});

describe('uploadFile (live against a local fake Files API)', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('runs the documented resumable upload, waits for ACTIVE, then reuses the upload', async () => {
    const api = await fakeFiles({ processingPolls: 2 });
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base });
    const p = tempVideo('0123456789');
    const f = await uploadFile(p, 'video/mp4', { env, pollMs: 1, displayName: 'move-in' });
    expect(f).toEqual({ uri: `${api.base}/files/abc123`, mime_type: 'video/mp4' });

    const [start, bytes, ...gets] = api.seen;
    expect(start!.headers).toMatchObject({
      'x-goog-api-key': 'k',
      'x-goog-upload-protocol': 'resumable',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': '10',
      'x-goog-upload-header-content-type': 'video/mp4',
    });
    expect(JSON.parse(start!.body)).toEqual({ file: { display_name: 'move-in' } });
    expect(bytes!.headers).toMatchObject({ 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize', 'content-length': '10' });
    expect(bytes!.body).toBe('0123456789');
    expect(gets.map((g) => g.url)).toEqual(['/v1beta/files/abc123', '/v1beta/files/abc123']);

    await uploadFile(p, 'video/mp4', { env });
    expect(api.seen).toHaveLength(4); // second upload of the same bytes served from the cache
    expect(readCalls(env).map((r) => r.source)).toEqual(['live', 'cache']);
  });

  it('retries a 503 on start and fails on a FAILED file', async () => {
    const api = await fakeFiles({ startFailures: 1 });
    close = api.close;
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base, GEMINI_CACHE: '0' });
    await uploadFile(tempVideo(), 'video/mp4', { env, pollMs: 1 });
    expect(api.seen.filter((s) => s.url === '/upload/v1beta/files')).toHaveLength(2);

    const bad = await fakeFiles({ finalState: 'FAILED' });
    await expect(uploadFile(tempVideo(), 'video/mp4', { env: { ...env, GEMINI_API_BASE: bad.base }, pollMs: 1 })).rejects.toThrow(/FAILED/);
    expect(readCalls(env).at(-1)).toMatchObject({ tag: 'upload', ok: false });
    await bad.close();
  });

  it('does not retry a 4xx, and replay serves only recorded uploads', async () => {
    const env = testEnv({ GEMINI_MODE: 'live', GEMINI_API_KEY: 'k', GEMINI_API_BASE: 'http://127.0.0.1:9/v1beta' });
    const forbidden = createServer((_q, s) => { s.writeHead(403); s.end('{"error":{"message":"no"}}'); });
    await new Promise<void>((r) => forbidden.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(forbidden.address() as AddressInfo).port}/v1beta`;
    await expect(uploadFile(tempVideo(), 'video/mp4', { env: { ...env, GEMINI_API_BASE: base } })).rejects.toBeInstanceOf(GeminiHttpError);
    await new Promise<void>((r) => forbidden.close(() => r()));

    const api = await fakeFiles();
    close = api.close;
    const rec = mkdtempSync(join(tmpdir(), 'ledger-rec-'));
    const p = tempVideo('recorded');
    const recorded = await uploadFile(p, 'video/mp4', { env: testEnv({ GEMINI_MODE: 'record', GEMINI_API_KEY: 'k', GEMINI_API_BASE: api.base, GEMINI_RECORDINGS_DIR: rec }), pollMs: 1 });
    const replayEnv = testEnv({ GEMINI_MODE: 'replay', GEMINI_RECORDINGS_DIR: rec });
    expect(await uploadFile(p, 'video/mp4', { env: replayEnv })).toEqual(recorded);
    await expect(uploadFile(tempVideo('other'), 'video/mp4', { env: replayEnv })).rejects.toBeInstanceOf(ReplayMissError);
  });
});

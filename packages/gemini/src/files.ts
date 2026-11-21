// [Rahim] uploadFile(): Files API resumable upload for inputs over the 100 MB inline cap (full walkthrough videos).
// Protocol: docs/vendor/files-api.md ("Upload a file", REST tab, and "get metadata"):
//   1. POST {base}/upload/v1beta/files  X-Goog-Upload-Protocol: resumable, -Command: start,
//      -Header-Content-Length, -Header-Content-Type, body { file: { display_name } }
//      -> upload URL in the x-goog-upload-url response header
//   2. POST <upload url>  X-Goog-Upload-Offset: 0, X-Goog-Upload-Command: upload, finalize, raw bytes
//      -> { file: { name, uri, mimeType, state, ... } }
//   3. GET {base}/v1beta/<name> until state is ACTIVE. Observed live on 2026-11-21: a video comes back
//      "PROCESSING" and turns "ACTIVE" about 1.5 s later; it can't be used as input before that.
// Files last 48 hours, so an upload of the same bytes + MIME type is reused for 47 hours.
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { GeminiHttpError, MAX_TRIES, limit, readStore, writeStore } from './cache.js';
import { logCall, type CallSource } from './callLog.js';
import { apiBase, apiKey, geminiMode } from './env.js';
import { ReplayMissError } from './modes.js';

/** Spread into a content block: `{ type: 'video', ...file }` works in both Interactions and Decisions input. */
export interface UploadedFile {
  uri: string;
  mime_type: string;
}

export interface UploadOptions {
  displayName?: string;
  env?: NodeJS.ProcessEnv;
  /** How long to wait for PROCESSING -> ACTIVE (default 10 min; long videos take a while). */
  activeTimeoutMs?: number;
  /** Poll interval while PROCESSING (default 2 s). */
  pollMs?: number;
}

/** The model field used for uploads in calls.jsonl (they cost nothing and use no tokens). */
export const FILES_MODEL = 'files-api';
const REUSE_MS = 47 * 3600 * 1000;

const FileSchema = z
  .object({ name: z.string().min(1), uri: z.string().min(1), mimeType: z.string().optional(), state: z.string().optional() })
  .passthrough();
type FileInfo = z.infer<typeof FileSchema>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (s: number) => s === 429 || s >= 500;

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** {base}/v1beta -> {base}/upload/v1beta, as in the docs' curl. */
function uploadBase(env: NodeJS.ProcessEnv): string {
  const base = apiBase(env);
  return base.replace(/\/(v1beta|v1)$/, '/upload/$1');
}

async function check(res: Response, endpoint: string): Promise<string> {
  const text = await res.text();
  if (!res.ok) throw new GeminiHttpError(res.status, text, endpoint);
  return text;
}

async function uploadOnce(path: string, mimeType: string, size: number, displayName: string, env: NodeJS.ProcessEnv): Promise<FileInfo> {
  const key = apiKey(env);
  const start = await fetch(`${uploadBase(env)}/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  await check(start, 'files.start');
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error('Files API: no x-goog-upload-url header in the start response');

  const done = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: Readable.toWeb(createReadStream(path)) as ReadableStream,
    duplex: 'half', // streamed body; a 500 MB video never sits in memory
  } as RequestInit);
  const text = await check(done, 'files.upload');
  return FileSchema.parse((JSON.parse(text) as { file?: unknown }).file);
}

async function waitActive(file: FileInfo, env: NodeJS.ProcessEnv, timeoutMs: number, pollMs: number): Promise<FileInfo> {
  const deadline = Date.now() + timeoutMs;
  let f = file;
  while (f.state === 'PROCESSING') {
    if (Date.now() > deadline) throw new Error(`Files API: ${f.name} still PROCESSING after ${timeoutMs} ms`);
    await sleep(pollMs);
    const res = await fetch(`${apiBase(env)}/${f.name}`, { headers: { 'x-goog-api-key': apiKey(env) } });
    if (res.status === 429 || res.status >= 500) continue;
    f = FileSchema.parse(JSON.parse(await check(res, 'files.get')));
  }
  if (f.state && f.state !== 'ACTIVE') throw new Error(`Files API: ${f.name} ended in state ${f.state}`);
  return f;
}

/**
 * Upload a local file (e.g. a walkthrough video) and return `{ uri, mime_type }` once it is ACTIVE.
 * live/record: real upload (3 tries with backoff on 429/5xx), reused for 47 h for identical bytes.
 * mock: no network, a deterministic fake URI. replay: the recorded URI, or ReplayMissError.
 * Every upload is logged to calls.jsonl with tag "upload".
 */
export async function uploadFile(path: string, mimeType: string, opts: UploadOptions = {}): Promise<UploadedFile> {
  const env = opts.env ?? process.env;
  if (!mimeType || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType) || mimeType === 'application/octet-stream') {
    throw new Error(`uploadFile: give the real MIME type (e.g. video/mp4), got "${mimeType}"`);
  }
  const size = statSync(path).size; // throws for a missing file in every mode
  const mode = geminiMode(env);
  const digest = await sha256File(path);
  const key = createHash('sha256').update(`${FILES_MODEL}\n${mimeType}\n${digest}`).digest('hex');
  const t0 = performance.now();
  let source: CallSource = mode === 'mock' ? 'mock' : mode === 'replay' ? 'replay' : 'live';
  const log = (ok: boolean, error?: string) =>
    logCall(
      { model: FILES_MODEL, tag: 'upload', latencyMs: performance.now() - t0, inTokens: 0, outTokens: 0, questions: 0, source, endpoint: 'files', ok, ...(error ? { error } : {}) },
      env,
    );
  const save = (store: 'cache' | 'recordings', out: UploadedFile) =>
    writeStore(store, { key, model: FILES_MODEL, tag: 'upload', endpoint: 'files', savedAt: new Date().toISOString(), response: out }, env);

  try {
    let out: UploadedFile;
    if (mode === 'mock') {
      out = { uri: `${apiBase(env)}/files/mock-${digest.slice(0, 16)}`, mime_type: mimeType };
    } else if (mode === 'replay') {
      const rec = readStore('recordings', key, env);
      if (!rec) throw new ReplayMissError('upload', key);
      out = rec.response as UploadedFile;
    } else {
      const hit = readStore('cache', key, env);
      if (hit && Date.now() - new Date(hit.savedAt).getTime() < REUSE_MS) {
        source = 'cache';
        out = hit.response as UploadedFile;
      } else {
        const file = await limit(async () => {
          let lastErr: unknown;
          for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
            try {
              return await uploadOnce(path, mimeType, size, opts.displayName ?? basename(path), env);
            } catch (e) {
              if (e instanceof GeminiHttpError && !retryable(e.status)) throw e;
              lastErr = e;
            }
            if (attempt < MAX_TRIES) await sleep(Number(env.GEMINI_BACKOFF_MS ?? 1000) * 2 ** (attempt - 1));
          }
          throw lastErr;
        });
        const active = await waitActive(file, env, opts.activeTimeoutMs ?? 600_000, opts.pollMs ?? 2000);
        out = { uri: active.uri, mime_type: mimeType };
        save('cache', out);
      }
      if (mode === 'record') save('recordings', out);
    }
    log(true);
    return out;
  } catch (e) {
    log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

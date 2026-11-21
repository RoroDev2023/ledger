// [Rahim] R2: ffmpeg at 2 fps, Laplacian sharpness filter (drop < p30), dHash dedupe (Hamming <= 5).

import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { FrameSchema, type Frame } from '@ledger/shared';

const execFileAsync = promisify(execFile);

export const FRAME_FPS = 2;
export const FRAME_WIDTH = 1280;
/** Frames with sharpness below this percentile of their own video are dropped. */
export const SHARPNESS_PERCENTILE = 0.3;
/** A frame within this Hamming distance of the last kept frame is a duplicate. */
export const DEDUPE_MAX_HAMMING = 5;

export interface ExtractFramesOptions {
  /** Walkthrough directory; frames go to `<workDir>/frames/`. Wins over `unitId`. */
  workDir?: string;
  /** With no `workDir`: `<DATA_DIR>/units/<unitId>/walkthroughs/<walkthroughId>/frames/`. */
  unitId?: string;
  /** Default `process.env.DATA_DIR ?? '.data'`. */
  dataDir?: string;
  /** Keep rejected frames on disk (default false: `frames/` holds only keyframes). */
  keepRejected?: boolean;
  /** Called after each frame is analyzed, for the `frames` SSE stage. */
  onProgress?: (done: number, total: number) => void;
}

/** One decoded frame before filtering. */
export interface RawFrame {
  index: number;
  tMs: number;
  path: string;
  sharpness: number;
  phash: string;
}

export type RejectReason = 'blurry' | 'duplicate';

export interface FrameExtraction {
  /** Kept keyframes, in time order. */
  frames: Frame[];
  /** Every frame ffmpeg produced, with the reason it was rejected, if any. */
  raw: (RawFrame & { rejected?: RejectReason })[];
  sharpnessThreshold: number;
  framesDir: string;
}

/** Extract keyframes from a walkthrough video: `Frame[]` in time order. */
export async function extractFrames(
  videoPath: string,
  walkthroughId: string,
  opts: ExtractFramesOptions = {},
): Promise<Frame[]> {
  return (await extractKeyframes(videoPath, walkthroughId, opts)).frames;
}

/** Same as `extractFrames`, plus the raw frames and the threshold (for eval and tests). */
export async function extractKeyframes(
  videoPath: string,
  walkthroughId: string,
  opts: ExtractFramesOptions = {},
): Promise<FrameExtraction> {
  const framesDir = resolveFramesDir(walkthroughId, opts);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', resolve(videoPath),
    '-vf', `fps=${FRAME_FPS},scale=${FRAME_WIDTH}:-2`,
    '-q:v', '2',
    join(framesDir, '%05d.jpg'),
  ]);

  const files = (await readdir(framesDir)).filter((f) => /^\d{5}\.jpg$/.test(f)).sort();
  if (files.length === 0) throw new Error(`ffmpeg produced no frames from ${videoPath}`);

  const raw: RawFrame[] = [];
  for (const [i, file] of files.entries()) {
    const path = join(framesDir, file);
    const index = Number(file.slice(0, 5));
    const [sharpness, phash] = await Promise.all([frameSharpness(path), dHashOf(path)]);
    raw.push({ index, tMs: Math.round(((index - 1) * 1000) / FRAME_FPS), path, sharpness, phash });
    opts.onProgress?.(i + 1, files.length);
  }

  const { kept, rejected, threshold } = selectKeyframes(raw);
  if (!opts.keepRejected) {
    await Promise.all([...rejected.keys()].map((i) => rm(raw[i]!.path, { force: true })));
  }

  const frames = kept.map((i) => {
    const r = raw[i]!;
    return FrameSchema.parse({
      id: frameId(walkthroughId, r.index),
      walkthroughId,
      tMs: r.tMs,
      path: r.path,
      sharpness: r.sharpness,
      phash: r.phash,
    });
  });

  return {
    frames,
    raw: raw.map((r, i) => (rejected.has(i) ? { ...r, rejected: rejected.get(i)! } : r)),
    sharpnessThreshold: threshold,
    framesDir,
  };
}

/** Stable, globally unique frame ID, e.g. `wt-123.f00042`. */
export function frameId(walkthroughId: string, index: number): string {
  return `${walkthroughId}.f${String(index).padStart(5, '0')}`;
}

/**
 * Pure selection step. Drop frames below the video's 30th-percentile sharpness, then walk the
 * survivors in time order and drop any within Hamming distance 5 of the last kept frame.
 */
export function selectKeyframes(
  raw: Pick<RawFrame, 'sharpness' | 'phash'>[],
  opts: { percentile?: number; maxHamming?: number } = {},
): { kept: number[]; rejected: Map<number, RejectReason>; threshold: number } {
  const threshold = percentile(raw.map((r) => r.sharpness), opts.percentile ?? SHARPNESS_PERCENTILE);
  const maxHamming = opts.maxHamming ?? DEDUPE_MAX_HAMMING;
  const kept: number[] = [];
  const rejected = new Map<number, RejectReason>();
  let last: string | undefined;
  raw.forEach((r, i) => {
    if (r.sharpness < threshold) {
      rejected.set(i, 'blurry');
    } else if (last !== undefined && hammingHex(r.phash, last) <= maxHamming) {
      rejected.set(i, 'duplicate');
    } else {
      kept.push(i);
      last = r.phash;
    }
  });
  return { kept, rejected, threshold };
}

/** Linear-interpolated percentile (p in [0, 1]) of a non-empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Variance of the 4-neighbour Laplacian over a single-channel image (interior pixels). */
export function laplacianVariance(gray: Uint8Array | Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** 64-bit difference hash of a 9×8 grayscale thumbnail, as 16 hex chars. */
export function dHashFromThumb(gray: Uint8Array | Buffer): string {
  if (gray.length !== 72) throw new Error(`dHash expects a 9x8 thumbnail, got ${gray.length} px`);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** Hamming distance between two 64-bit hashes in hex. */
export function hammingHex(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Laplacian-variance sharpness of a JPEG on disk (same measure extractFrames stores in Frame.sharpness). */
export async function frameSharpness(path: string): Promise<number> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  return laplacianVariance(data, info.width, info.height);
}

async function dHashOf(path: string): Promise<string> {
  const data = await sharp(path).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  return dHashFromThumb(data);
}

function resolveFramesDir(walkthroughId: string, opts: ExtractFramesOptions): string {
  if (opts.workDir) return resolve(opts.workDir, 'frames');
  if (!/^[A-Za-z0-9._-]+$/.test(walkthroughId) || walkthroughId.includes('..')) {
    throw new Error(`unsafe walkthroughId for a path: ${walkthroughId}`);
  }
  const dataDir = resolve(opts.dataDir ?? process.env.DATA_DIR ?? '.data');
  if (opts.unitId) {
    if (!/^[A-Za-z0-9._-]+$/.test(opts.unitId) || opts.unitId.includes('..')) {
      throw new Error(`unsafe unitId for a path: ${opts.unitId}`);
    }
    return join(dataDir, 'units', opts.unitId, 'walkthroughs', walkthroughId, 'frames');
  }
  return join(dataDir, 'walkthroughs', walkthroughId, 'frames');
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('ffmpeg not found on PATH (set FFMPEG_PATH)');
    throw new Error(`ffmpeg failed: ${e.stderr?.trim() || e.message}`);
  }
}

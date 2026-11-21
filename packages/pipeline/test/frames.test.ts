import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dHashFromThumb,
  extractFrames,
  extractKeyframes,
  frameId,
  hammingHex,
  laplacianVariance,
  percentile,
  selectKeyframes,
} from '../src/frames.js';

const hasFfmpeg = (() => {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('pure helpers', () => {
  it('laplacian variance is 0 on a flat image and high on a checkerboard', () => {
    const w = 16;
    const flat = new Uint8Array(w * w).fill(128);
    const checker = new Uint8Array(w * w).map((_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
    expect(laplacianVariance(flat, w, w)).toBe(0);
    expect(laplacianVariance(checker, w, w)).toBeGreaterThan(100_000);
  });

  it('percentile interpolates linearly', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.3)).toBeCloseTo(3.7);
    expect(percentile([5], 0.3)).toBe(5);
    expect(() => percentile([], 0.3)).toThrow();
  });

  it('dHash is 16 hex chars and hamming counts differing bits', () => {
    const rampDown = new Uint8Array(72).map((_, i) => 255 - (i % 9) * 20);
    expect(dHashFromThumb(rampDown)).toBe('ffffffffffffffff');
    expect(dHashFromThumb(new Uint8Array(72))).toBe('0000000000000000');
    expect(hammingHex('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingHex('000000000000001f', '0000000000000000')).toBe(5);
    expect(hammingHex('abc', 'abc')).toBe(0);
  });

  it('selectKeyframes drops blurry (< p30) and near-duplicate (<= 5 bits) frames', () => {
    const raw = [
      { sharpness: 1, phash: '0000000000000000' }, // blurry
      { sharpness: 2, phash: 'ffff000000000000' }, // blurry
      { sharpness: 3, phash: '00000000ffffffff' }, // blurry (p30 of 1..10 = 3.7)
      { sharpness: 10, phash: '0000000000000000' }, // kept
      { sharpness: 9, phash: '000000000000001f' }, // 5 bits from last kept -> duplicate
      { sharpness: 8, phash: '000000000000003f' }, // 6 bits from last kept -> kept
      { sharpness: 7, phash: '000000000000003f' }, // duplicate
      { sharpness: 6, phash: 'ffffffffffffffff' }, // kept
      { sharpness: 5, phash: 'fffffffffffffffe' }, // duplicate
      { sharpness: 4, phash: '0f0f0f0f0f0f0f0f' }, // kept
    ];
    const { kept, rejected, threshold } = selectKeyframes(raw);
    expect(threshold).toBeCloseTo(3.7);
    expect(kept).toEqual([3, 5, 7, 9]);
    expect([...rejected.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'blurry'], [1, 'blurry'], [2, 'blurry'],
      [4, 'duplicate'], [6, 'duplicate'], [8, 'duplicate'],
    ]);
  });

  it('frame IDs are unique per walkthrough and zero-padded', () => {
    expect(frameId('wt-1', 42)).toBe('wt-1.f00042');
  });
});

describe.skipIf(!hasFfmpeg)('extractFrames on generated video', () => {
  let dir: string;
  const lavfi = (name: string, src: string, vf?: string) => {
    const out = join(dir, name);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src,
      ...(vf ? ['-vf', vf] : []), '-pix_fmt', 'yuv420p', out,
    ]);
    return out;
  };
  let moving: string;
  let halfBlurred: string;
  let still: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-frames-'));
    // ~5 s each: moving test pattern, the same with the first 2 s heavily blurred, and a still image.
    moving = lavfi('moving.mp4', 'testsrc2=size=640x360:rate=10:duration=5');
    halfBlurred = lavfi('blur.mp4', 'testsrc2=size=640x360:rate=10:duration=5', "boxblur=20:enable='lt(t,2)'");
    still = lavfi('still.mp4', 'smptebars=size=640x360:rate=10:duration=5');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('samples 2 fps at 1280 wide, tMs from the index, and keeps only keyframes on disk', async () => {
    const workDir = join(dir, 'wt-moving');
    const out = await extractKeyframes(moving, 'wt-moving', { workDir });
    expect(out.raw).toHaveLength(10); // 5 s x 2 fps
    expect(out.raw.map((r) => r.tMs)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
    expect(out.framesDir).toBe(join(workDir, 'frames'));

    const meta = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
      out.frames[0]!.path,
    ]).toString().trim();
    expect(meta).toBe('1280,720');

    // Linear p30 of 10 values sits between the 3rd and 4th lowest, so exactly 3 are blurry.
    expect(out.raw.filter((r) => r.rejected === 'blurry')).toHaveLength(3);
    for (const f of out.frames) {
      expect(f.sharpness).toBeGreaterThanOrEqual(out.sharpnessThreshold);
      expect(f.phash).toMatch(/^[0-9a-f]{16}$/);
      expect(f.walkthroughId).toBe('wt-moving');
      expect(f.id).toMatch(/^wt-moving\.f\d{5}$/);
    }
    for (let i = 1; i < out.frames.length; i++) {
      expect(hammingHex(out.frames[i]!.phash, out.frames[i - 1]!.phash)).toBeGreaterThan(5);
    }
    expect(readdirSync(out.framesDir).sort()).toEqual(out.frames.map((f) => f.path.split('/').pop()).sort());
  });

  it('drops the blurred frames by sharpness', async () => {
    const out = await extractKeyframes(halfBlurred, 'wt-blur', { workDir: join(dir, 'wt-blur') });
    const blurry = out.raw.filter((r) => r.rejected === 'blurry');
    expect(blurry).toHaveLength(3);
    // Every rejected-as-blurry frame comes from the blurred first 2 s.
    for (const r of blurry) expect(r.tMs).toBeLessThan(2000);
    expect(out.frames.every((f) => f.tMs >= 2000 || f.sharpness >= out.sharpnessThreshold)).toBe(true);
  });

  it('dedupes a still video down to one keyframe', async () => {
    const out = await extractKeyframes(still, 'wt-still', { workDir: join(dir, 'wt-still'), keepRejected: true });
    // Identical frames tie at p30 and survive the blur filter (strictly-below drops); dedupe keeps one.
    expect(out.frames).toHaveLength(1);
    const blurry = out.raw.filter((r) => r.rejected === 'blurry').length;
    expect(blurry).toBeLessThanOrEqual(3);
    expect(out.raw.filter((r) => r.rejected === 'duplicate')).toHaveLength(9 - blurry);
    expect(readdirSync(out.framesDir)).toHaveLength(10); // keepRejected
  });

  it('defaults to the .data unit layout', async () => {
    const dataDir = join(dir, 'data');
    const frames = await extractFrames(still, 'wt-a', { dataDir, unitId: 'unit-1' });
    expect(frames[0]!.path.startsWith(join(dataDir, 'units', 'unit-1', 'walkthroughs', 'wt-a', 'frames') + '/')).toBe(true);
    expect(existsSync(frames[0]!.path)).toBe(true);
    await expect(extractFrames(still, '../evil', { dataDir })).rejects.toThrow(/unsafe/);
  });

  it('reports a clear error for a missing video', async () => {
    await expect(extractFrames(join(dir, 'nope.mp4'), 'wt-x', { workDir: join(dir, 'wt-x') })).rejects.toThrow(/ffmpeg failed/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Frame } from '@ledger/shared';
import { captionFrames, mockCaptioner, type BatchCaptioner } from '../src/landmarks.js';

const frame = (i: number): Frame => ({
  id: `wt.f${String(i).padStart(5, '0')}`,
  walkthroughId: 'wt',
  tMs: i * 500,
  path: `/tmp/${i}.jpg`,
  sharpness: 100,
  phash: (BigInt(i) * 0x9e3779b97f4a7c15n % (1n << 64n)).toString(16).padStart(16, '0'),
});

describe('captionFrames', () => {
  it('batches 8 per call and returns one caption per frame in order', async () => {
    const frames = Array.from({ length: 19 }, (_, i) => frame(i + 1));
    const captioner = vi.fn<BatchCaptioner>(mockCaptioner);
    const out = await captionFrames(frames, { captioner });
    expect(captioner).toHaveBeenCalledTimes(3);
    expect(captioner.mock.calls.map(([b]) => b.length)).toEqual([8, 8, 3]);
    expect(out.map((c) => c.frameId)).toEqual(frames.map((f) => f.id));
  });

  it('maps frameIdx back to frames, normalizes terms and fills skipped frames', async () => {
    const frames = [frame(1), frame(2), frame(3)];
    const out = await captionFrames(frames, {
      captioner: async () => ({
        frames: [
          { frameIdx: 2, landmarks: [' Window ', 'window', ''], objects: ['Chair'] },
          { frameIdx: 0, landmarks: ['door'], objects: [] },
          { frameIdx: 7, landmarks: ['ghost'], objects: [] },
        ],
      }),
    });
    expect(out).toEqual([
      { frameId: frames[0]!.id, landmarks: ['door'], objects: [] },
      { frameId: frames[1]!.id, landmarks: [], objects: [] },
      { frameId: frames[2]!.id, landmarks: ['window'], objects: ['chair'] },
    ]);
  });

  it('rejects invalid model JSON', async () => {
    await expect(
      captionFrames([frame(1)], { captioner: async () => ({ frames: [{ frameIdx: -1 }] }) as never }),
    ).rejects.toThrow();
  });

  it('mock mode is deterministic', async () => {
    const frames = [frame(1), frame(2)];
    expect(await captionFrames(frames)).toEqual(await captionFrames(frames));
  });
});

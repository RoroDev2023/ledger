import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerateValidationError, readCalls } from '@ledger/gemini';
import type { Frame } from '@ledger/shared';
import { CAPTION_TAG, captionFrames } from '../src/landmarks.js';

let root: string;
let jpg: string;

/** Mock-mode env with its own DATA_DIR and fixtures dir, so tests never touch the repo's .data/. */
function mockEnv(fixture?: unknown): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(root, 'env-'));
  const fixtures = join(dir, 'fixtures');
  mkdirSync(join(fixtures, 'generate'), { recursive: true });
  if (fixture !== undefined) writeFileSync(join(fixtures, 'generate', `${CAPTION_TAG}.json`), JSON.stringify(fixture));
  return {
    GEMINI_MODE: 'mock',
    MODEL_FAST: 'test-hydrogen',
    DATA_DIR: join(dir, 'data'),
    GEMINI_FIXTURES_DIR: fixtures,
    GEMINI_CACHE: '0',
  };
}

const frame = (i: number): Frame => ({
  id: `wt.f${String(i).padStart(5, '0')}`,
  walkthroughId: 'wt',
  tMs: (i - 1) * 500,
  path: jpg,
  sharpness: 100,
  phash: '0123456789abcdef',
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledger-captions-'));
  jpg = join(root, 'frame.jpg');
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).jpeg().toFile(jpg);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('captionFrames via @ledger/gemini (mock mode)', () => {
  it('sends 8 frames per Hydrogen call on MODEL_FAST and returns one caption per frame in order', async () => {
    const env = mockEnv();
    const frames = Array.from({ length: 19 }, (_, i) => frame(i + 1));
    const out = await captionFrames(frames, { env });
    expect(out.map((c) => c.frameId)).toEqual(frames.map((f) => f.id));
    const calls = readCalls(env).filter((c) => c.tag === CAPTION_TAG);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.model === 'test-hydrogen' && c.questions === 0)).toBe(true);
  });

  it('maps entries back by frameId, normalizes terms and fills skipped or unknown frames', async () => {
    const frames = [frame(1), frame(2), frame(3)];
    const env = mockEnv({
      frames: [
        { frameId: frames[2]!.id, landmarks: [' Window ', 'window', ''], objects: ['Chair'] },
        { frameId: frames[0]!.id, landmarks: ['door'], objects: [] },
        { frameId: 'wt.f99999', landmarks: ['ghost'], objects: [] },
      ],
    });
    expect(await captionFrames(frames, { env })).toEqual([
      { frameId: frames[0]!.id, landmarks: ['door'], objects: [] },
      { frameId: frames[1]!.id, landmarks: [], objects: [] },
      { frameId: frames[2]!.id, landmarks: ['window'], objects: ['chair'] },
    ]);
  });

  it('fails loudly when the model JSON does not match the schema', async () => {
    const env = mockEnv({ frames: [{ frameId: 'wt.f00001', landmarks: 'door' }] });
    await expect(captionFrames([frame(1)], { env })).rejects.toBeInstanceOf(GenerateValidationError);
  });

  it('is deterministic in mock mode', async () => {
    const frames = [frame(1), frame(2)];
    const env = mockEnv();
    expect(await captionFrames(frames, { env })).toEqual(await captionFrames(frames, { env }));
  });
});

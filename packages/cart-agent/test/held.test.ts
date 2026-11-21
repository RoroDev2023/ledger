import { describe, expect, it } from 'vitest';
import { closeHeldBrowser, hasHeldBrowser, holdBrowser, releaseBrowser } from '../src/held.js';

const fake = (log: string[], name: string) => ({ close: async () => void log.push(`close ${name}`) });

describe('held browser (cart tabs stay open after the run)', () => {
  it('keeps the window until the next run, then closes only the previous one', async () => {
    const log: string[] = [];
    const a = fake(log, 'a');
    await holdBrowser(a);
    expect(hasHeldBrowser()).toBe(true);
    expect(log).toEqual([]); // the run finished, nothing closed
    await holdBrowser(fake(log, 'b'));
    expect(log).toEqual(['close a']);
    expect(await closeHeldBrowser()).toBe(true);
    expect(log).toEqual(['close a', 'close b']);
    expect(hasHeldBrowser()).toBe(false);
    expect(await closeHeldBrowser()).toBe(false);
  });

  it('forgets a window closed by hand without closing it again', async () => {
    const log: string[] = [];
    const a = fake(log, 'a');
    await holdBrowser(a);
    releaseBrowser(a);
    expect(hasHeldBrowser()).toBe(false);
    expect(await closeHeldBrowser()).toBe(false);
    expect(log).toEqual([]);
  });

  it('a failing close never blocks the next launch', async () => {
    await holdBrowser({ close: async () => Promise.reject(new Error('already gone')) });
    await expect(holdBrowser(fake([], 'c'))).resolves.toBeUndefined();
    await closeHeldBrowser();
  });
});

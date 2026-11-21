// [Rahim] The agent's browser outlives its run: the cart tabs must stay on screen after the job finishes.
// One module-level reference holds the live window. It is closed only when the next run launches a new one,
// when someone calls closeHeldBrowser() (POST /units/:id/fixkit/cart/close), or when the process exits
// (Playwright's own SIGINT/SIGTERM/SIGHUP handlers kill the browser with the API).

export interface HeldBrowser {
  close: () => Promise<void>;
}

let held: HeldBrowser | null = null;

/** Keep `b` alive as the current agent window; closes the previous one first (one window at a time). */
export async function holdBrowser(b: HeldBrowser): Promise<void> {
  const prev = held;
  held = b;
  if (prev && prev !== b) await prev.close().catch(() => {});
}

/** Closes the previous run's window before a new launch (no-op when there is none). */
export async function closeHeldBrowser(): Promise<boolean> {
  const prev = held;
  held = null;
  if (!prev) return false;
  await prev.close().catch(() => {});
  return true;
}

/** Forget `b` without closing it (the window was already closed, e.g. by hand). */
export function releaseBrowser(b: HeldBrowser): void {
  if (held === b) held = null;
}

export const hasHeldBrowser = (): boolean => held !== null;

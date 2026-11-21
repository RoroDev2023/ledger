// [Rahim] Compact question keys (q17) <-> (surfaceId, purpose), bidirectional per call. Keys match ^[A-Za-z0-9_-]{1,64}$.

/** The Decisions API's rule for question keys. */
export const QUESTION_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidQuestionKey(k: string): boolean {
  return QUESTION_KEY_RE.test(k);
}

export interface KeyRef {
  surfaceId: string;
  purpose: string;
}

/**
 * Assigns each (surfaceId, purpose) pair a short key (`q0`, `q1`, ...) and keeps the reverse lookup
 * for the whole call. Long IDs, IDs with dots, and IDs that differ only by punctuation
 * ("bed-1.wall-n" vs "bed_1.wall_n") all get distinct keys and round-trip exactly.
 *
 *   const qk = new QuestionKeys();
 *   questions[qk.key('bedroom.wall-n', 'visible')] = { type: 'noul', instructions: '...' };
 *   const { surfaceId, purpose } = qk.decode('q0');
 */
export class QuestionKeys {
  private readonly toKey = new Map<string, string>();
  private readonly fromKey = new Map<string, KeyRef>();

  constructor(private readonly prefix = 'q') {
    if (!/^[A-Za-z_-][A-Za-z0-9_-]{0,40}$/.test(prefix)) throw new Error(`bad key prefix "${prefix}"`);
  }

  /** Same pair -> same key for the lifetime of this object. */
  key(surfaceId: string, purpose: string): string {
    const id = JSON.stringify([surfaceId, purpose]);
    let k = this.toKey.get(id);
    if (!k) {
      k = `${this.prefix}${this.toKey.size}`;
      this.toKey.set(id, k);
      this.fromKey.set(k, { surfaceId, purpose });
    }
    return k;
  }

  decode(key: string): KeyRef {
    const ref = this.fromKey.get(key);
    if (!ref) throw new Error(`unknown question key "${key}"`);
    return ref;
  }

  has(key: string): boolean {
    return this.fromKey.has(key);
  }

  get size(): number {
    return this.fromKey.size;
  }

  entries(): [string, KeyRef][] {
    return [...this.fromKey];
  }
}

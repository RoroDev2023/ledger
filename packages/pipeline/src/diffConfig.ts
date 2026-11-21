// [Rahim] R5: every diff tunable in one place. Tune on dev pairs only (AGENTS.md E4), never on test.

export const DIFF = {
  /** Same-region P(yes) at or above this: the pair is compared. */
  SAME_REGION_YES: 0.7,
  /** Same-region P(yes) at or below this: the pair is skipped. In between: 2×2 quadrant fallback. */
  SAME_REGION_NO: 0.3,
  /** Best quadrant's P(same region) must reach this, else the unsure pair is skipped. */
  QUADRANT_YES: 0.7,
  /** A change question (new damage / worse) at or above this supports the change. */
  CHANGE_YES: 0.7,
  /** A change question at or below this says nothing changed. */
  CHANGE_NO: 0.3,
  /** "Only an object moved" at or above this marks the pair as a move, never a charge. */
  MOVED_YES: 0.7,
  /** Independent supporting pairs needed to charge (two distinct BEFORE and two distinct AFTER frames). */
  MIN_PAIRS: 2,
  /** Candidate frames per side for one suspected change (pairs = MAX_BEFORE × MAX_AFTER at most). */
  MAX_BEFORE: 3,
  MAX_AFTER: 3,
  /** Two frames whose dHash is within this Hamming distance count as the same frame. */
  DISTINCT_HAMMING: 5,
  /** Same issue type at both walkthroughs: severity must rise by at least this to be a new-damage candidate. */
  SEVERITY_JUMP: 2,
  /** Proven scuffs and nail holes at or below this severity are wear (never charged). */
  WEAR_MAX_SEVERITY: 2,
  WEAR_TYPES: ['scuff', 'hole'] as readonly string[],
  /** Hydrogen "moved" detection: an object must be seen in at least this many frames per walkthrough. */
  OBJECT_MIN_FRAMES: 2,
  /** Media resolution for frames sent to the Decisions API. */
  IMAGE_RESOLUTION: 'medium' as const,
};

export type DiffConfig = typeof DIFF;

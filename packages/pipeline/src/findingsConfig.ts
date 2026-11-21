// [Rahim] R4: every findings tunable in one place. Tune on dev pairs only (AGENTS.md E4).

export const FINDINGS = {
  /** Evidence frames per covered surface (highest P(visible) × sharpness first). */
  FRAMES_PER_SURFACE: 3,
  /** Visibility gate: a frame whose P(clearly visible, unobstructed) is below this is discarded with its checklist. */
  GATE_MIN: 0.5,
  /** R3's coverage minimum, applied to frames that pass the gate. Fewer -> surface is not-visible. */
  MIN_ACCEPTED_FRAMES: 2,
  /** Noisy-OR P at or above this -> finding decided by the Decisions API. */
  FINDING_AT: 0.7,
  /** Noisy-OR P at or below this -> no finding. Between the two -> Carbon. */
  NONE_AT: 0.3,
  /** An accepted frame supports a finding when its own P(issue) is at least this. */
  SUPPORT_MIN: 0.5,
  /** At most this many Carbon calls per walkthrough (most uncertain first). The rest abstain. */
  MAX_CARBON_CALLS: 8,
  /** Media resolution for keyframes sent for damage checks (fine detail matters). */
  IMAGE_RESOLUTION: 'high' as const,
};

export type FindingsConfig = typeof FINDINGS;

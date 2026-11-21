// [Rahim] R3: every localization tunable in one place. Tune on dev pairs only (AGENTS.md E4).

export const LOCALIZE = {
  /** A room change needs this many consecutive frames agreeing on the new room. */
  ROOM_MIN_RUN: 3,
  /**
   * HMM transition mass per row: stay on the same surface, move to an adjacent one (plan `neighbors`,
   * floor/ceiling <-> every wall of the room, `none` <-> everything), or jump anywhere else.
   * Each class's mass is split evenly over its members; rows are renormalized when a class is empty.
   */
  TRANSITION: { self: 0.8, neighbor: 0.15, other: 0.05 },
  /** Emissions are clamped to at least this, so one confident wrong frame can be outvoted. */
  EMISSION_FLOOR: 1e-3,
  /** Choice probability multiplier for candidates whose landmarks Hydrogen also saw in the frame. */
  LANDMARK_BOOST: 1.2,
  /** HMM posterior below this sends the frame to Carbon. */
  CARBON_BELOW: 0.6,
  /** At most this many Carbon calls per walkthrough (lowest posterior first). */
  MAX_CARBON_CALLS: 12,
  /** A frame counts toward a surface's coverage when P(visible) is above this. */
  VISIBLE_ABOVE: 0.7,
  /** Fewer covering frames than this -> the surface is not-visible for this walkthrough. */
  MIN_COVERAGE: 2,
  /** Media resolution for keyframes sent to the Decisions API. */
  IMAGE_RESOLUTION: 'medium' as const,
};

export type LocalizeConfig = typeof LOCALIZE;

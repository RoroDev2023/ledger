// The LEDGER contract. Frozen at 11:15 on Nov 21 2026; after that, changes are additive
// (new optional fields) unless all three owners agree. Mirrors AGENTS.md exactly.

export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'fixture';

export interface Opening {
  id: string;
  kind: 'door' | 'window';
  wallId: string;
  offsetM: number;
  widthM: number;
}

/** Meters, plan coordinates, y = north. */
export interface Room {
  id: string;
  name: string;
  polygon: [number, number][];
}

export interface Surface {
  /** e.g. "bedroom-1.wall-n" */
  id: string;
  roomId: string;
  kind: SurfaceKind;
  label: string;
  /** walls only */
  segment?: [[number, number], [number, number]];
  areaM2?: number;
  neighbors?: string[];
  /** e.g. ["window", "radiator"] */
  landmarks?: string[];
  /** Fixtures only: where it sits (plan meters), and its outline when drawn as a shape (two opposite corners). */
  at?: [number, number];
  footprint?: [[number, number], [number, number]];
}

export interface FloorPlan {
  unitId: string;
  ceilingHeightM: number;
  metersPerPixel: number;
  scaleSource: 'labels' | 'known-measurement' | 'assumed';
  rooms: Room[];
  surfaces: Surface[];
  openings: Opening[];
  warnings: string[];
}

export type WalkthroughKind = 'baseline' | 'tenant-addendum' | 'move-out';

export interface Walkthrough {
  id: string;
  unitId: string;
  kind: WalkthroughKind;
  videoPath: string;
  capturedAt: string;
}

export interface Frame {
  id: string;
  walkthroughId: string;
  tMs: number;
  path: string;
  sharpness: number;
  phash: string;
}

export interface Localization {
  frameId: string;
  roomId: string;
  surfaceId: string | 'none';
  confidence: number;
  /** surfaceId -> P(visible) */
  visible: Record<string, number>;
}

export type IssueType = 'crack' | 'stain' | 'hole' | 'scuff' | 'missing-fixture' | 'other';

export interface Finding {
  id: string;
  walkthroughId: string;
  surfaceId: string;
  type: IssueType;
  confidence: number;
  severity: 1 | 2 | 3 | 4 | 5;
  frameIds: string[];
  /** [ymin, xmin, ymax, xmax], normalized 0-1 on frameIds[0] */
  bbox?: [number, number, number, number];
  decidedBy: 'decisions-api' | 'carbon';
  note?: string;
}

export type Verdict = 'new-damage' | 'pre-existing' | 'wear' | 'moved' | 'not-visible' | 'no-change';

export interface DiffItem {
  surfaceId: string;
  verdict: Verdict;
  issueType?: IssueType;
  reason: string;
  beforeFrameId?: string;
  afterFrameId?: string;
  areaM2?: number;
  costUsd?: number;
  leaseClause?: string;
  confidence: number;
  /** Where on the surface the damage is, so the 3D pin lands on it: height above the floor, and the plan item
   * (fixture surface id or opening id) it's next to. Additive and optional. [Alex] */
  spot?: { heightM?: number; nearId?: string };
}

export interface Statement {
  unitId: string;
  moveOutDate: string;
  /** moveOutDate + 14 days (NY GOL 7-108) */
  dueBy: string;
  items: DiffItem[];
  totalUsd: number;
  disclaimer: string;
}

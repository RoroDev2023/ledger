// Runtime validation for every model JSON and every file on disk.
// Each schema is checked at compile time to match its interface in types.ts.
import { z } from 'zod';
import type * as T from './types.js';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const prob = z.number().finite().min(0).max(1);
const isoDate = z.string().min(1);

export const SurfaceKindSchema = z.enum(['wall', 'floor', 'ceiling', 'door', 'window', 'fixture']);

export const OpeningSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['door', 'window']),
  wallId: z.string().min(1),
  offsetM: z.number().finite().nonnegative(),
  widthM: z.number().finite().positive(),
});

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  polygon: z.array(point).min(3),
});

export const SurfaceSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  kind: SurfaceKindSchema,
  label: z.string(),
  segment: z.tuple([point, point]).optional(),
  areaM2: z.number().finite().nonnegative().optional(),
  neighbors: z.array(z.string()).optional(),
  landmarks: z.array(z.string()).optional(),
  at: point.optional(),
  footprint: z.tuple([point, point]).optional(),
});

export const FloorPlanSchema = z
  .object({
    unitId: z.string().min(1),
    ceilingHeightM: z.number().finite().positive(),
    metersPerPixel: z.number().finite().positive(),
    scaleSource: z.enum(['labels', 'known-measurement', 'assumed']),
    rooms: z.array(RoomSchema).min(1),
    surfaces: z.array(SurfaceSchema),
    openings: z.array(OpeningSchema),
    warnings: z.array(z.string()),
  })
  .superRefine((plan, ctx) => {
    const rooms = new Set(plan.rooms.map((r) => r.id));
    const surfaces = new Set<string>();
    for (const s of plan.surfaces) {
      if (surfaces.has(s.id)) ctx.addIssue({ code: 'custom', message: `duplicate surface id ${s.id}` });
      surfaces.add(s.id);
      if (!rooms.has(s.roomId)) ctx.addIssue({ code: 'custom', message: `surface ${s.id} has unknown room ${s.roomId}` });
      if (s.kind === 'wall' && !s.segment) ctx.addIssue({ code: 'custom', message: `wall ${s.id} has no segment` });
    }
    for (const o of plan.openings) {
      if (!surfaces.has(o.wallId)) ctx.addIssue({ code: 'custom', message: `opening ${o.id} on unknown wall ${o.wallId}` });
    }
  });

export const WalkthroughKindSchema = z.enum(['baseline', 'tenant-addendum', 'move-out']);

export const WalkthroughSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  kind: WalkthroughKindSchema,
  videoPath: z.string().min(1),
  capturedAt: isoDate,
});

export const FrameSchema = z.object({
  id: z.string().min(1),
  walkthroughId: z.string().min(1),
  tMs: z.number().int().nonnegative(),
  path: z.string().min(1),
  sharpness: z.number().finite(),
  phash: z.string(),
});

export const LocalizationSchema = z.object({
  frameId: z.string().min(1),
  roomId: z.string().min(1),
  surfaceId: z.string().min(1),
  confidence: prob,
  visible: z.record(z.string(), prob),
});

export const IssueTypeSchema = z.enum(['crack', 'stain', 'hole', 'scuff', 'missing-fixture', 'other']);

/** Normalized [ymin, xmin, ymax, xmax] in [0, 1] with ymin < ymax and xmin < xmax. */
export const BBoxSchema = z
  .tuple([prob, prob, prob, prob])
  .refine(([ymin, xmin, ymax, xmax]) => ymin < ymax && xmin < xmax, {
    message: 'bbox must be [ymin, xmin, ymax, xmax] with ymin < ymax and xmin < xmax',
  });

export const SeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const FindingSchema = z.object({
  id: z.string().min(1),
  walkthroughId: z.string().min(1),
  surfaceId: z.string().min(1),
  type: IssueTypeSchema,
  confidence: prob,
  severity: SeveritySchema,
  frameIds: z.array(z.string().min(1)).min(1),
  bbox: BBoxSchema.optional(),
  decidedBy: z.enum(['decisions-api', 'carbon']),
  note: z.string().optional(),
});

export const VerdictSchema = z.enum(['new-damage', 'pre-existing', 'wear', 'moved', 'not-visible', 'no-change']);

export const DiffItemSchema = z.object({
  surfaceId: z.string().min(1),
  verdict: VerdictSchema,
  issueType: IssueTypeSchema.optional(),
  reason: z.string(),
  beforeFrameId: z.string().optional(),
  afterFrameId: z.string().optional(),
  areaM2: z.number().finite().nonnegative().optional(),
  costUsd: z.number().finite().nonnegative().optional(),
  leaseClause: z.string().optional(),
  confidence: prob,
});

export const StatementSchema = z.object({
  unitId: z.string().min(1),
  moveOutDate: isoDate,
  dueBy: isoDate,
  items: z.array(DiffItemSchema),
  totalUsd: z.number().finite().nonnegative(),
  disclaimer: z.string().min(1),
});

/** Score from the Decisions API (finite, in [0, 4]) -> our integer severity 1-5. */
export function scoreToSeverity(score: number): T.Finding['severity'] {
  if (!Number.isFinite(score) || score < 0 || score > 4) {
    throw new RangeError(`severity score must be a finite number in [0, 4], got ${score}`);
  }
  return (Math.round(score) + 1) as T.Finding['severity'];
}

/** moveOutDate (YYYY-MM-DD) + 14 days, as YYYY-MM-DD (NY GOL 7-108). */
export function statementDueBy(moveOutDate: string): string {
  const d = new Date(`${moveOutDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`bad moveOutDate ${moveOutDate}`);
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

// Compile-time check that every schema's output matches its interface exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<X extends true> = X;
export type _Contract = [
  Assert<Same<z.infer<typeof OpeningSchema>, T.Opening>>,
  Assert<Same<z.infer<typeof RoomSchema>, T.Room>>,
  Assert<Same<z.infer<typeof SurfaceSchema>, T.Surface>>,
  Assert<Same<z.infer<typeof FloorPlanSchema>, T.FloorPlan>>,
  Assert<Same<z.infer<typeof WalkthroughSchema>, T.Walkthrough>>,
  Assert<Same<z.infer<typeof FrameSchema>, T.Frame>>,
  Assert<Same<z.infer<typeof LocalizationSchema>, T.Localization>>,
  Assert<Same<z.infer<typeof FindingSchema>, T.Finding>>,
  Assert<Same<z.infer<typeof DiffItemSchema>, T.DiffItem>>,
  Assert<Same<z.infer<typeof StatementSchema>, T.Statement>>,
];

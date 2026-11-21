// [Alex] Fixture surfaces -> 3D furniture placements. Pure (no three.js) so it is unit-tested.
// The plan says what an item is (its name), where it is (`at`) and, when drawn as a shape, its outline
// (`footprint`). Wall items (art, lights) are hung on the nearest wall of their room, facing into the room.
import type { FloorPlan, Surface } from '@ledger/shared';
import { BUILT_WALL_THICKNESS, type PlanGeometry, type Vec2, type Vec3, type WallGeometry } from './geometry.js';

export type FurnitureKind = 'art' | 'light' | 'column' | 'table' | 'cabinet' | 'chair' | 'sofa' | 'bed' | 'fixture';

export interface FurniturePiece {
  surfaceId: string;
  kind: FurnitureKind;
  label: string;
  /** Center on the floor (y = 0), or on the wall at hanging height for art and lights. */
  position: Vec3;
  /** [width along the facing direction's x, height, depth]. */
  size: Vec3;
  rotationY: number;
  /** For wall items: the wall they hang on (hidden when that wall is cut away). */
  wallSurfaceId?: string;
}

export function furnitureKind(name: string): FurnitureKind {
  const n = name.toLowerCase();
  if (/portrait|painting|\bart\b|artwork|picture|poster|print|mirror|canvas/.test(n)) return 'art';
  if (/sconce|wall light|lamp|light/.test(n)) return 'light';
  if (/column|pillar|\bpost\b/.test(n)) return 'column';
  if (/table|desk/.test(n)) return 'table';
  if (/cabinet|credenza|dresser|sideboard|shel|bookcase|wardrobe|closet|console/.test(n)) return 'cabinet';
  if (/chair|stool/.test(n)) return 'chair';
  if (/sofa|couch|bench/.test(n)) return 'sofa';
  if (/\bbed\b/.test(n)) return 'bed';
  return 'fixture';
}

const DEFAULT_SIZE: Record<FurnitureKind, Vec3> = {
  art: [1.0, 1.25, 0.05],
  light: [0.16, 0.24, 0.12],
  column: [0.45, 0, 0.45], // height = ceiling
  table: [1.4, 0.75, 3.6],
  cabinet: [1.6, 0.9, 0.48],
  chair: [0.55, 0.85, 0.55],
  sofa: [2.0, 0.8, 0.9],
  bed: [1.6, 0.5, 2.0],
  fixture: [0.7, 0.85, 0.6],
};

/** Closest point on a wall segment and the wall's facing (into its room). */
function onWall(w: WallGeometry, seg: [Vec2, Vec2], p: Vec2): { along: Vec2; t: number; len: number } {
  const [a, b] = seg;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(len, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  void w;
  return { along: [a[0] + (dx / len) * t, a[1] + (dy / len) * t], t, len };
}

function nearestWall(plan: FloorPlan, geo: PlanGeometry, roomId: string, p: Vec2) {
  let best: { w: WallGeometry; seg: [Vec2, Vec2]; d: number } | null = null;
  for (const w of geo.walls) {
    if (w.roomId !== roomId) continue;
    const s = plan.surfaces.find((x) => x.id === w.surfaceId)?.segment as [Vec2, Vec2] | undefined;
    if (!s) continue;
    const { along } = onWall(w, s, p);
    const d = Math.hypot(along[0] - p[0], along[1] - p[1]);
    if (!best || d < best.d) best = { w, seg: s, d };
  }
  return best;
}

/** Rotation that turns an item's local +z (its front) toward the given plan direction. */
const facing = (dir: Vec2) => Math.atan2(dir[0], -dir[1]);

export function placeFurniture(plan: FloorPlan, geo: PlanGeometry): FurniturePiece[] {
  const out: FurniturePiece[] = [];
  const ceiling = plan.ceilingHeightM;
  for (const s of plan.surfaces as Surface[]) {
    if (s.kind !== 'fixture' || (!s.at && !s.footprint)) continue;
    const name = s.label.replace(new RegExp(`^${plan.rooms.find((r) => r.id === s.roomId)?.name ?? ''}\\s*`, 'i'), '') || s.label;
    const kind = furnitureKind(name);
    // Chairs drawn around a table: the table brings its own set, so a drawn chair next to one would double up.
    if (kind === 'chair' && s.at && plan.surfaces.some((t) => t !== s && t.footprint && furnitureKind(t.label) === 'table' && nearBox(s.at!, t.footprint, 0.9))) continue;
    const at: Vec2 = s.at ?? [(s.footprint![0][0] + s.footprint![1][0]) / 2, (s.footprint![0][1] + s.footprint![1][1]) / 2];
    const near = nearestWall(plan, geo, s.roomId, at);
    const inward: Vec2 | null = near ? [near.w.inward[0], -near.w.inward[1]] : null; // back to plan axes

    if ((kind === 'art' || kind === 'light') && near && inward) {
      const { along } = onWall(near.w, near.seg, at);
      const off = BUILT_WALL_THICKNESS / 2 + (kind === 'art' ? 0.03 : 0.07);
      const p: Vec2 = [along[0] + inward[0] * off, along[1] + inward[1] * off];
      const size = DEFAULT_SIZE[kind];
      const h = kind === 'art' ? Math.min(1.55, ceiling - size[1] / 2 - 0.15) : Math.min(1.9, ceiling - 0.3);
      out.push({ surfaceId: s.id, kind, label: name, position: [p[0], h, -p[1]], size, rotationY: facing(inward), wallSurfaceId: near.w.surfaceId });
      continue;
    }

    // Floor items: size from the drawn outline when there is one; long side along the outline's long side.
    let size: Vec3 = [...DEFAULT_SIZE[kind]];
    let rotationY = 0;
    let center: Vec2 = at;
    if (s.footprint) {
      const [[x0, y0], [x1, y1]] = s.footprint;
      const w = Math.abs(x1 - x0);
      const d = Math.abs(y1 - y0);
      center = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (w > 0.1 && d > 0.1) size = [w, size[1], d];
    } else if (near && inward && (kind === 'cabinet' || kind === 'sofa' || kind === 'bed') && near.d < 1.2) {
      // Undrawn item against a wall: back to the wall, facing into the room.
      const { along } = onWall(near.w, near.seg, at);
      const off = BUILT_WALL_THICKNESS / 2 + size[2] / 2 + 0.02;
      center = [along[0] + inward[0] * off, along[1] + inward[1] * off];
      rotationY = facing(inward);
    }
    if (kind === 'column') size = [size[0], ceiling, size[2]];
    out.push({ surfaceId: s.id, kind, label: name, position: [center[0], 0, -center[1]], size, rotationY });
  }
  return out;
}

/** Chairs around a table: one per ~0.75 m on each long side, facing the table. */
export function chairsAround(table: FurniturePiece): { position: Vec3; rotationY: number }[] {
  const [w, , d] = table.size;
  const longX = w >= d;
  const len = longX ? w : d;
  const n = Math.max(1, Math.floor((len - 0.3) / 0.75));
  const gap = 0.42;
  const chairs: { position: Vec3; rotationY: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = -len / 2 + (len / n) * (i + 0.5);
    for (const side of [-1, 1]) {
      // local offsets, then the table's own rotation
      const lx = longX ? k : side * (w / 2 + gap);
      const lz = longX ? side * (d / 2 + gap) : k;
      const c = Math.cos(table.rotationY);
      const sn = Math.sin(table.rotationY);
      const x = table.position[0] + lx * c + lz * sn;
      const z = table.position[2] - lx * sn + lz * c;
      const faceTable = longX ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
      chairs.push({ position: [x, 0, z], rotationY: table.rotationY + faceTable });
    }
  }
  return chairs;
}

function nearBox([x, y]: Vec2, [[x0, y0], [x1, y1]]: [Vec2, Vec2], margin: number): boolean {
  return x >= Math.min(x0, x1) - margin && x <= Math.max(x0, x1) + margin && y >= Math.min(y0, y1) - margin && y <= Math.max(y0, y1) + margin;
}

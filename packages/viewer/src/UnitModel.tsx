// [Alex] <UnitModel plan items selected onSelect view /> : the 3D evidence map.
// Walls and floors come from the plan (geometry.ts), pins from the statement/diff items (colors.ts).
// Clicking a wall, floor or pin calls onSelect(surfaceId); clicking empty space calls onSelect(null).
import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { DiffItem, FloorPlan } from '@ledger/shared';
import { pinStyle } from './colors.js';
import { blocksView, pinAnchors, planGeometry, type PlanGeometry, type Vec3, type WallGeometry } from './geometry.js';

export interface UnitModelProps {
  plan: FloorPlan;
  /** Statement or diff items to pin. */
  items?: DiffItem[];
  /** Selected surface ID (highlighted). */
  selected?: string | null;
  onSelect?: (surfaceId: string | null) => void;
  /** '3d' = rotatable dollhouse, 'top' = straight down like the paper plan. */
  view?: '3d' | 'top';
  style?: CSSProperties;
}

const WALL = '#f3efe7';
const WALL_FLAGGED = '#fcd9d9';
const FLOOR = '#e4dccd';
const SELECTED = '#fde68a';
/** Height of a cut-away wall, as a fraction of the ceiling. */
const CUT_HEIGHT = 0.12;

export function UnitModel({ plan, items = [], selected = null, onSelect, view = '3d', style }: UnitModelProps) {
  const geo = useMemo(() => planGeometry(plan), [plan]);
  const charged = useMemo(() => new Set(items.filter((i) => pinStyle(i).charged).map((i) => i.surfaceId)), [items]);
  const select = (id: string | null) => onSelect?.(id);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 360, background: 'linear-gradient(#fbfaf7, #efece6)', borderRadius: 12, ...style }}>
      <Canvas flat shadows="percentage" dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 200 }} onPointerMissed={() => select(null)}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[geo.bounds.center[0] + 6, 12, geo.bounds.center[2] + 8]} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
        <hemisphereLight args={['#ffffff', '#d9d2c3', 0.5]} />
        <CameraRig geo={geo} view={view} />
        {geo.floors.map((f) => (
          <Floor key={f.surfaceId} floor={f} selected={selected === f.surfaceId} onClick={() => select(f.surfaceId)} />
        ))}
        {geo.walls.map((w) => (
          <Wall key={w.surfaceId} wall={w} color={selected === w.surfaceId ? SELECTED : charged.has(w.surfaceId) ? WALL_FLAGGED : WALL} cutaway={view === '3d'} onClick={() => select(w.surfaceId)} />
        ))}
        <Pins geo={geo} items={items} selected={selected} onSelect={select} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[geo.bounds.center[0], -0.01, geo.bounds.center[2]]} receiveShadow>
          <planeGeometry args={[geo.bounds.size * 4, geo.bounds.size * 4]} />
          <shadowMaterial opacity={0.12} />
        </mesh>
      </Canvas>
    </div>
  );
}

function CameraRig({ geo, view }: { geo: PlanGeometry; view: '3d' | 'top' }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [cx, , cz] = geo.bounds.center;
  const d = geo.bounds.size;

  useEffect(() => {
    if (view === 'top') camera.position.set(cx, d * 2.6, cz + 0.001);
    else camera.position.set(cx + d * 0.85, d * 1.25, cz + d * 1.35);
    camera.lookAt(cx, 0, cz);
    controls.current?.target.set(cx, 0.8, cz);
    controls.current?.update();
  }, [view, camera, cx, cz, d]);

  return <OrbitControls ref={controls} makeDefault enableRotate={view === '3d'} maxPolarAngle={Math.PI / 2.05} minDistance={1.5} maxDistance={d * 6} />;
}

function Wall({ wall, color, cutaway, onClick }: { wall: WallGeometry; color: string; cutaway: boolean; onClick: () => void }) {
  const group = useRef<THREE.Group>(null);
  // Architect's cutaway: a wall between the camera and its room drops to a low stub, so you always look straight
  // into the room. Scaling the group (its origin is on the floor) shrinks every piece toward the floor together.
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const target = cutaway && blocksView(wall, camera.position.toArray() as Vec3) ? CUT_HEIGHT : 1;
    g.scale.y += (target - g.scale.y) * 0.18;
  });
  return (
    <group
      ref={group}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {wall.pieces.map((p, i) => (
        <mesh key={i} position={p.position} rotation={[0, p.rotationY, 0]} castShadow receiveShadow userData={{ surfaceId: wall.surfaceId }}>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Floor({ floor, selected, onClick }: { floor: PlanGeometry['floors'][number]; selected: boolean; onClick: () => void }) {
  const shape = useMemo(() => new THREE.Shape(floor.polygon.map(([x, y]) => new THREE.Vector2(x, y))), [floor.polygon]);
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        userData={{ surfaceId: floor.surfaceId }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={selected ? SELECTED : FLOOR} roughness={1} />
      </mesh>
      <Html position={[floor.center[0], 0.05, floor.center[2]]} center style={{ pointerEvents: 'none', font: '600 11px system-ui', color: '#8a8173', whiteSpace: 'nowrap', letterSpacing: '.06em', textTransform: 'uppercase' }}>
        {floor.label.replace(/ floor$/i, '')}
      </Html>
    </group>
  );
}

function Pins({ geo, items, selected, onSelect }: { geo: PlanGeometry; items: DiffItem[]; selected: string | null; onSelect: (id: string) => void }) {
  const placed = useMemo(() => {
    const bySurface = new Map<string, DiffItem[]>();
    for (const it of items) bySurface.set(it.surfaceId, [...(bySurface.get(it.surfaceId) ?? []), it]);
    return [...bySurface.entries()].flatMap(([surfaceId, list]) => {
      const anchors = pinAnchors(geo, surfaceId, list.length);
      return list.map((item, i) => ({ item, at: anchors[i]! }));
    });
  }, [geo, items]);

  return (
    <>
      {placed.map(({ item, at }, i) => {
        const s = pinStyle(item);
        const active = selected === item.surfaceId;
        return (
          <group key={i} position={at}>
            <mesh
              castShadow
              scale={active ? 1.35 : 1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(item.surfaceId);
              }}
            >
              <sphereGeometry args={[0.11, 24, 16]} />
              <meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={active ? 0.6 : 0.25} roughness={0.4} />
            </mesh>
            <Html position={[0, 0.24, 0]} center style={{ pointerEvents: 'none' }}>
              <div style={{ background: s.color, color: '#fff', font: '600 11px/1 system-ui', padding: '4px 7px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.18)', opacity: active ? 1 : 0.92 }}>
                {s.charged ? `$${(item.costUsd ?? 0).toFixed(2)}` : `${s.label} · $0`}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

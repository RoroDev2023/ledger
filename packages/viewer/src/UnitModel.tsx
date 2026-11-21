// [Alex] <UnitModel plan items selected onSelect view /> : the 3D evidence map.
// Walls and floors come from the plan (geometry.ts), pins from the statement/diff items (colors.ts).
// Clicking a wall, floor or pin calls onSelect(surfaceId); clicking empty space calls onSelect(null).
import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { DiffItem, FloorPlan } from '@ledger/shared';
import { PIN_STYLE, pinKind, pinStyle, type PinKind } from './colors.js';
import { physicalBlocksView, pinAnchors, planGeometry, type PhysicalWall, type PlanGeometry, type Vec3 } from './geometry.js';

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

export function UnitModel({ plan, items = [], selected = null, onSelect, view = '3d', style }: UnitModelProps) {
  const geo = useMemo(() => planGeometry(plan), [plan]);
  const charged = useMemo(() => new Set(items.filter((i) => pinStyle(i).charged).map((i) => i.surfaceId)), [items]);
  const select = (id: string | null) => onSelect?.(id);
  const colorOf = (id?: string) => (id && selected === id ? SELECTED : id && charged.has(id) ? WALL_FLAGGED : WALL);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 360, background: 'linear-gradient(#fbfaf7, #efece6)', borderRadius: 12, ...style }}>
      <Canvas flat dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 200 }} onPointerMissed={() => select(null)}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[geo.bounds.center[0] + 6, 12, geo.bounds.center[2] + 8]} intensity={1.15} />
        <hemisphereLight args={['#ffffff', '#d9d2c3', 0.5]} />
        <CameraRig geo={geo} view={view} />
        {/* drei <Html> loses the FIRST overlay it creates on startup (its React root is unmounted mid-render under
            React 19; see "synchronously unmount a root" in the console). This empty one takes that hit so the room
            labels and pin tags that follow all appear. Verified by screenshot: without it the first room label is missing. */}
        <Html>{null}</Html>
        {geo.floors.map((f) => (
          <Floor key={f.surfaceId} floor={f} selected={selected === f.surfaceId} onClick={() => select(f.surfaceId)} />
        ))}
        {geo.physical.map((w) => (
          <BuiltWall key={w.id} wall={w} leftColor={colorOf(w.left)} rightColor={colorOf(w.right)} mode={view === 'top' ? 'plan' : 'cutaway'} onSelect={select} />
        ))}
        <Pins geo={geo} items={items} selected={selected} onSelect={select} />
      </Canvas>
      <Legend items={items} />
    </div>
  );
}

function CameraRig({ geo, view }: { geo: PlanGeometry; view: '3d' | 'top' }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [cx, , cz] = geo.bounds.center;
  const d = geo.bounds.size;

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (view === 'top') {
      // A narrow lens from far above is almost orthographic: reads like the paper plan, no leaning walls.
      cam.fov = 14;
      cam.position.set(cx, (d * 0.62) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), cz + 0.001);
    } else {
      cam.fov = 40;
      cam.position.set(cx + d * 0.85, d * 1.25, cz + d * 1.35);
    }
    cam.far = 400;
    cam.updateProjectionMatrix();
    cam.lookAt(cx, 0, cz);
    controls.current?.target.set(cx, view === 'top' ? 0 : 0.8, cz);
    controls.current?.update();
  }, [view, camera, cx, cz, d]);

  // target is passed at creation too: if the effect above runs before the controls exist, they would otherwise
  // keep aiming at (0, 0, 0), which is beside the unit whenever the plan doesn't start at the origin.
  return <OrbitControls ref={controls} target={[cx, view === 'top' ? 0 : 0.8, cz]} makeDefault enableRotate={view === '3d'} maxPolarAngle={Math.PI / 2.05} minDistance={1.5} maxDistance={d * 12} />;
}

function BuiltWall({ wall, leftColor, rightColor, mode, onSelect }: { wall: PhysicalWall; leftColor: string; rightColor: string; mode: 'cutaway' | 'plan'; onSelect: (id: string) => void }) {
  const full = useRef<THREE.Group>(null);
  const stub = useRef<THREE.Group>(null);
  // Cut-away: an outside wall between the camera and the unit drops to a low stub (door gaps only), so you look
  // straight in. Top-down shows every wall as a stub, like the thick lines of a paper plan.
  useFrame(({ camera }) => {
    const low = mode === 'plan' || physicalBlocksView(wall, camera.position.toArray() as Vec3);
    if (full.current) full.current.visible = !low;
    if (stub.current) stub.current.visible = low;
  });
  // Box faces: +x, -x, +y, -y, +z (right side of the wall line), -z (left side). Each side wears its room's color.
  const materials = useMemo(() => {
    const m = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
    return [m(WALL), m(WALL), m(WALL), m(WALL), m(rightColor), m(leftColor)];
  }, [leftColor, rightColor]);
  useEffect(() => () => materials.forEach((x) => x.dispose()), [materials]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const side = e.face?.materialIndex === 4 ? wall.right : e.face?.materialIndex === 5 ? wall.left : undefined;
    const id = side ?? wall.left ?? wall.right;
    if (id) onSelect(id);
  };
  const boxes = (pieces: PhysicalWall['pieces']) =>
    pieces.map((p, i) => (
      <mesh key={i} position={p.position} rotation={[0, p.rotationY, 0]} material={materials} receiveShadow>
        <boxGeometry args={p.size} />
      </mesh>
    ));
  return (
    <group onClick={click}>
      <group ref={full}>{boxes(wall.pieces)}</group>
      <group ref={stub} visible={false}>
        {boxes(wall.stub)}
      </group>
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
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <>
      {placed.map(({ item, at }, i) => {
        const s = pinStyle(item);
        const active = selected === item.surfaceId;
        // Text tags only where they matter (charges, the selected surface, the pin under the mouse); every other
        // pin is just a colored dot explained by the legend. Keeps crowded walls readable.
        const showTag = s.charged || active || hovered === i;
        return (
          <group key={i} position={at}>
            <mesh
              castShadow
              scale={active || hovered === i ? 1.35 : 1}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(i);
              }}
              onPointerOut={() => setHovered((h) => (h === i ? null : h))}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(item.surfaceId);
              }}
            >
              <sphereGeometry args={[0.11, 24, 16]} />
              <meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={active ? 0.6 : 0.25} roughness={0.4} />
            </mesh>
            {showTag && (
            <Html position={[0, 0.24, 0]} center zIndexRange={[active ? 30 : s.charged ? 20 : 10, 0]} style={{ pointerEvents: 'none' }}>
              <div style={{ background: s.color, color: '#fff', font: '600 11px/1 system-ui', padding: '4px 7px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.18)', opacity: active ? 1 : 0.92 }}>
                {s.charged ? `$${(item.costUsd ?? 0).toFixed(2)}` : `${s.label} · $0`}
              </div>
            </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Color key for the pins actually on screen, with counts. */
function Legend({ items }: { items: DiffItem[] }) {
  const counts = new Map<PinKind, number>();
  for (const it of items) counts.set(pinKind(it), (counts.get(pinKind(it)) ?? 0) + 1);
  if (counts.size === 0) return null;
  return (
    <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px 10px', background: 'rgba(255,255,255,.85)', borderRadius: 8, font: '12px system-ui', color: '#4a443b' }}>
      {[...counts.entries()].map(([k, n]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 99, background: PIN_STYLE[k].color, display: 'inline-block' }} />
          {PIN_STYLE[k].label} {n > 1 ? `×${n}` : ''}
        </span>
      ))}
    </div>
  );
}

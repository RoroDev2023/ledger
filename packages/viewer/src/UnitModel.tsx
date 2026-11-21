// [Alex] <UnitModel plan items selected onSelect view /> : the 3D evidence map.
// Walls and floors come from the plan (geometry.ts), pins from the statement/diff items (colors.ts).
// Clicking a wall, floor or pin calls onSelect(surfaceId); clicking empty space calls onSelect(null).
import { OrbitControls } from '@react-three/drei';
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
  /** Slow turntable rotation (landing page). Stops as soon as the user drags. */
  autoRotate?: boolean;
  /** Background behind the model; 'none' lets the page show through. */
  background?: string;
  style?: CSSProperties;
}

const WALL = '#f3efe7';
const WALL_FLAGGED = '#fcd9d9';
const FLOOR = '#e4dccd';
const SELECTED = '#fde68a';

export function UnitModel({ plan, items = [], selected = null, onSelect, view = '3d', autoRotate = false, background, style }: UnitModelProps) {
  const geo = useMemo(() => planGeometry(plan), [plan]);
  const charged = useMemo(() => new Set(items.filter((i) => pinStyle(i).charged).map((i) => i.surfaceId)), [items]);
  const select = (id: string | null) => onSelect?.(id);
  const colorOf = (id?: string) => (id && selected === id ? SELECTED : id && charged.has(id) ? WALL_FLAGGED : WALL);
  const [hovered, setHovered] = useState<number | null>(null);
  const placed = useMemo(() => placePins(geo, items), [geo, items]);
  // Price tags wait until the pins have dropped in (see <Pins>): ~0.6 s camera + 0.14 s per pin + 0.7 s fall.
  const [tagsReady, setTagsReady] = useState(false);
  useEffect(() => {
    setTagsReady(false);
    const t = setTimeout(() => setTagsReady(true), 1400 + placed.length * 140);
    return () => clearTimeout(t);
  }, [plan.unitId, placed.length]);

  // Text over the 3D view (room names, pin tags). Plain DOM positioned every frame by <LabelProjector>; drei's <Html>
  // was used before but under React 19 it dropped its first label and threw removeChild errors on unmount.
  const labels: Label[] = [
    ...geo.floors.map((f) => ({ key: f.surfaceId, at: [f.center[0], 0.05, f.center[2]] as Vec3, text: f.label.replace(/ floor$/i, ''), kind: 'room' as const })),
    ...placed.flatMap(({ item, at }, i) => {
      const s = pinStyle(item);
      const active = selected === item.surfaceId;
      if (!(s.charged || active || hovered === i) || (!tagsReady && hovered !== i)) return [];
      return [{ key: `pin-${i}`, at: [at[0], at[1] + 0.24, at[2]] as Vec3, text: s.charged ? `$${(item.costUsd ?? 0).toFixed(2)}` : `${s.label} · $0`, kind: 'pin' as const, color: s.color, z: active ? 3 : s.charged ? 2 : 1 }];
    }),
  ];
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 360, background: background ?? 'radial-gradient(120% 90% at 50% 0%, #fffdf9 0%, #efe8db 70%, #e7dfcf 100%)', borderRadius: 18, ...style }}>
      <Canvas flat dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 200 }} onPointerMissed={() => select(null)}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[geo.bounds.center[0] + 6, 12, geo.bounds.center[2] + 8]} intensity={1.15} />
        <hemisphereLight args={['#ffffff', '#d9d2c3', 0.5]} />
        <CameraRig geo={geo} view={view} autoRotate={autoRotate} />
        {geo.floors.map((f) => (
          <Floor key={f.surfaceId} floor={f} selected={selected === f.surfaceId} onClick={() => select(f.surfaceId)} />
        ))}
        {geo.physical.map((w) => (
          <BuiltWall key={w.id} wall={w} leftColor={colorOf(w.left)} rightColor={colorOf(w.right)} mode={view === 'top' ? 'plan' : 'cutaway'} onSelect={select} />
        ))}
        <Pins key={plan.unitId + items.length} placed={placed} selected={selected} hovered={hovered} onHover={setHovered} onSelect={select} />
        <LabelProjector points={labels.map((l) => l.at)} els={labelEls} />
      </Canvas>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 12 }}>
        {labels.map((l, i) => (
          <span
            key={l.key}
            ref={(el) => {
              labelEls.current[i] = el;
            }}
            style={
              l.kind === 'room'
                ? { position: 'absolute', left: 0, top: 0, font: '600 11px system-ui', color: '#8a8173', whiteSpace: 'nowrap', letterSpacing: '.06em', textTransform: 'uppercase', visibility: 'hidden' }
                : { position: 'absolute', left: 0, top: 0, zIndex: l.z, background: l.color, color: '#fff', font: '600 11px/1 system-ui', padding: '4px 7px', borderRadius: 999, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.18)', visibility: 'hidden' }
            }
          >
            {l.text}
          </span>
        ))}
      </div>
      <Legend items={items} />
    </div>
  );
}

function CameraRig({ geo, view, autoRotate }: { geo: PlanGeometry; view: '3d' | 'top'; autoRotate: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [cx, , cz] = geo.bounds.center;
  const d = geo.bounds.size;
  // Fly-in: the camera starts far and high and eases to its resting spot. Any drag by the user ends it.
  const fly = useRef<{ to: THREE.Vector3; active: boolean }>({ to: new THREE.Vector3(), active: false });
  const [spin, setSpin] = useState(autoRotate);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const to = new THREE.Vector3();
    if (view === 'top') {
      // A narrow lens from far above is almost orthographic: reads like the paper plan, no leaning walls.
      cam.fov = 14;
      to.set(cx, (d * 0.62) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), cz + 0.001);
    } else {
      cam.fov = 40;
      to.set(cx + d * 0.85, d * 1.25, cz + d * 1.35);
    }
    cam.far = 400;
    cam.updateProjectionMatrix();
    const from = to.clone().sub(new THREE.Vector3(cx, 0, cz)).multiplyScalar(view === 'top' ? 1.25 : 1.9).add(new THREE.Vector3(cx, view === 'top' ? 0 : d * 0.6, cz));
    cam.position.copy(from);
    cam.lookAt(cx, 0, cz);
    fly.current = { to, active: true };
    controls.current?.target.set(cx, view === 'top' ? 0 : 0.8, cz);
    controls.current?.update();
  }, [view, camera, cx, cz, d]);

  useFrame((_, delta) => {
    const f = fly.current;
    if (!f.active) return;
    camera.position.lerp(f.to, 1 - Math.exp(-delta * 3.2));
    if (camera.position.distanceTo(f.to) < 0.02) f.active = false;
    controls.current?.update();
  });

  // target is passed at creation too: if the effect above runs before the controls exist, they would otherwise
  // keep aiming at (0, 0, 0), which is beside the unit whenever the plan doesn't start at the origin.
  return (
    <OrbitControls
      ref={controls}
      target={[cx, view === 'top' ? 0 : 0.8, cz]}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotate={spin && view === '3d'}
      autoRotateSpeed={0.7}
      onStart={() => {
        fly.current.active = false;
        setSpin(false);
      }}
      enableRotate={view === '3d'}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={1.5}
      maxDistance={d * 12}
    />
  );
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
    </group>
  );
}

type Placed = { item: DiffItem; at: Vec3 };

/** Pin positions: items grouped by surface, spread out along their wall (see pinAnchors). */
function placePins(geo: PlanGeometry, items: DiffItem[]): Placed[] {
  const bySurface = new Map<string, DiffItem[]>();
  for (const it of items) bySurface.set(it.surfaceId, [...(bySurface.get(it.surfaceId) ?? []), it]);
  return [...bySurface.entries()].flatMap(([surfaceId, list]) => {
    const anchors = pinAnchors(geo, surfaceId, list.length);
    return list.map((item, i) => ({ item, at: anchors[i]! }));
  });
}

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/** Pins drop onto their walls one after another; charged pins keep a soft pulsing halo. */
function Pins({ placed, selected, hovered, onHover, onSelect }: { placed: Placed[]; selected: string | null; hovered: number | null; onHover: (i: number | null) => void; onSelect: (id: string) => void }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const halos = useRef<(THREE.Mesh | null)[]>([]);
  const start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime + 0.6; // after the camera has mostly arrived
    const t0 = clock.elapsedTime - start.current;
    placed.forEach((p, i) => {
      const g = groups.current[i];
      if (g) {
        const t = Math.min(1, Math.max(0, (t0 - i * 0.14) / 0.7));
        const big = selected === p.item.surfaceId || hovered === i ? 1.35 : 1;
        g.position.set(p.at[0], p.at[1] + (1 - Math.min(1, easeOutBack(t))) * 1.4, p.at[2]);
        g.scale.setScalar(Math.max(0.001, Math.min(1, t * 1.6)) * big);
      }
      const h = halos.current[i];
      if (h) {
        const k = ((clock.elapsedTime * 0.7 + i * 0.3) % 1 + 1) % 1;
        h.scale.setScalar(1 + k * 1.8);
        (h.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
      }
    });
  });
  return (
    <>
      {placed.map(({ item, at }, i) => {
        const s = pinStyle(item);
        const big = selected === item.surfaceId || hovered === i;
        return (
          <group
            key={i}
            ref={(g) => {
              groups.current[i] = g;
            }}
            position={at}
            scale={0.001}
          >
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                onHover(i);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                onHover(null);
                document.body.style.cursor = '';
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(item.surfaceId);
              }}
            >
              <sphereGeometry args={[0.11, 32, 20]} />
              <meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={big ? 0.65 : 0.3} roughness={0.35} metalness={0.05} />
            </mesh>
            {s.charged && (
              <mesh
                ref={(m) => {
                  halos.current[i] = m;
                }}
              >
                <sphereGeometry args={[0.11, 24, 16]} />
                <meshBasicMaterial color={s.color} transparent opacity={0.4} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

interface Label {
  key: string;
  at: Vec3;
  text: string;
  kind: 'room' | 'pin';
  color?: string;
  z?: number;
}

/** Moves each label element to its 3D point's screen position every frame (hidden when behind the camera). */
function LabelProjector({ points, els }: { points: Vec3[]; els: React.RefObject<(HTMLSpanElement | null)[]> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    points.forEach((p, i) => {
      const el = els.current?.[i];
      if (!el) return;
      v.set(p[0], p[1], p[2]).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.visibility = visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    });
  });
  return null;
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

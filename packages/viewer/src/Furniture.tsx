// [Alex] Furniture in the 3D unit, built from simple shapes with careful materials (no downloads, always loads).
// Wall items hide when their wall is cut away, so nothing floats in the air.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { chairsAround, type FurniturePiece } from './placement.js';
import { blocksView, type PlanGeometry, type Vec3 } from './geometry.js';

const WOOD = '#6b4630';
const WOOD_LIGHT = '#a77d58';
const WALNUT = '#4a2f20';
const TOP = '#efe9dc';
const TERRACOTTA = '#b45a40';
const CHROME = '#c9c6c0';
const BRASS = '#b8925a';
const CONCRETE = '#a9a49b';

/** A painted portrait for the canvas: ochre ground, a figure in a white top with a black sash (after the room's art). */
function portraitTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 400;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 400);
  bg.addColorStop(0, '#e9c96a');
  bg.addColorStop(1, '#d9b04f');
  g.fillStyle = bg;
  g.fillRect(0, 0, 320, 400);
  // soft brush texture
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${200 + Math.random() * 40},${160 + Math.random() * 40},${60 + Math.random() * 30},0.08)`;
    g.fillRect(Math.random() * 320, Math.random() * 400, 6 + Math.random() * 18, 2 + Math.random() * 3);
  }
  // shoulders and top
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.moveTo(40, 400);
  g.bezierCurveTo(50, 285, 110, 255, 160, 252);
  g.bezierCurveTo(210, 255, 270, 285, 280, 400);
  g.closePath();
  g.fill();
  // black sash
  g.fillStyle = '#1d1a17';
  g.fillRect(70, 340, 180, 26);
  // neck and head
  g.fillStyle = '#5a3a28';
  g.fillRect(142, 205, 36, 55);
  g.beginPath();
  g.ellipse(160, 160, 46, 58, 0, 0, Math.PI * 2);
  g.fill();
  // hair
  g.fillStyle = '#1f1612';
  g.beginPath();
  g.ellipse(160, 118, 50, 34, 0, Math.PI, Math.PI * 2);
  g.fill();
  // a little light on the face
  g.fillStyle = 'rgba(255,220,180,0.12)';
  g.beginPath();
  g.ellipse(148, 150, 18, 26, -0.3, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Concrete: speckled grey, generated once. */
function concreteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = CONCRETE;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const v = 120 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Furniture({ pieces, geo, mode }: { pieces: FurniturePiece[]; geo: PlanGeometry; mode: 'cutaway' | 'plan' }) {
  return (
    <group>
      {pieces.map((p) => (
        <Piece key={p.surfaceId} p={p} geo={geo} mode={mode} />
      ))}
    </group>
  );
}

function Piece({ p, geo, mode }: { p: FurniturePiece; geo: PlanGeometry; mode: 'cutaway' | 'plan' }) {
  const ref = useRef<THREE.Group>(null);
  const wall = p.wallSurfaceId ? geo.walls.find((w) => w.surfaceId === p.wallSurfaceId) : undefined;
  // Wall items disappear with their wall (cut-away or plan view); floor items always show.
  useFrame(({ camera }) => {
    if (!ref.current || !wall) return;
    const outside = geo.physical.find((w) => (w.left === wall.surfaceId || w.right === wall.surfaceId) && w.exterior);
    ref.current.visible = mode !== 'plan' && !(outside && blocksView(wall, camera.position.toArray() as Vec3));
  });
  return (
    <group ref={ref} position={p.position} rotation={[0, p.rotationY, 0]}>
      {p.kind === 'art' && <Art size={p.size} />}
      {p.kind === 'light' && <Sconce />}
      {p.kind === 'column' && <Column size={p.size} />}
      {p.kind === 'table' && <Table piece={p} />}
      {p.kind === 'cabinet' && <Cabinet size={p.size} />}
      {p.kind === 'chair' && <Chair />}
      {p.kind === 'sofa' && <Box size={p.size} color="#7d6a58" />}
      {p.kind === 'bed' && <Box size={p.size} color="#e6dfd2" />}
      {p.kind === 'fixture' && <Box size={p.size} color="#ddd6c8" />}
    </group>
  );
}

function Box({ size, color, y = size[1] / 2, roughness = 0.8 }: { size: Vec3; color: string; y?: number; roughness?: number }) {
  return (
    <mesh position={[0, y, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

function Art({ size }: { size: Vec3 }) {
  const tex = useMemo(() => portraitTexture(), []);
  const [w, h] = size;
  const f = 0.06; // frame width
  return (
    <group>
      {/* frame */}
      <mesh>
        <boxGeometry args={[w + f * 2, h + f * 2, 0.05]} />
        <meshStandardMaterial color="#2b1d15" roughness={0.45} metalness={0.1} />
      </mesh>
      {/* canvas, slightly proud of the frame's back */}
      <mesh position={[0, 0, 0.027]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {/* picture light above */}
      <mesh position={[0, h / 2 + f + 0.06, 0.08]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, w * 0.55, 16]} />
        <meshStandardMaterial color={BRASS} metalness={0.4} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Sconce() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.12, 0.2, 0.02]} />
        <meshStandardMaterial color={WOOD} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0.06]}>
        <cylinderGeometry args={[0.035, 0.045, 0.1, 20]} />
        <meshStandardMaterial color={BRASS} metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0.06]}>
        <sphereGeometry args={[0.03, 16, 12]} />
        <meshStandardMaterial color="#fff6dc" emissive="#ffd98a" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function Column({ size }: { size: Vec3 }) {
  const tex = useMemo(() => concreteTexture(), []);
  return (
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial map={tex} color="#ffffff" roughness={0.95} />
    </mesh>
  );
}

function Table({ piece }: { piece: FurniturePiece }) {
  const [w, h, d] = piece.size;
  const rim = 0.06;
  const legs: [number, number][] = [
    [-w / 2 + 0.25, -d / 2 + 0.3],
    [w / 2 - 0.25, -d / 2 + 0.3],
    [-w / 2 + 0.25, d / 2 - 0.3],
    [w / 2 - 0.25, d / 2 - 0.3],
  ];
  const chairs = useMemo(() => chairsAround({ ...piece, position: [0, 0, 0], rotationY: 0 }), [piece]);
  return (
    <group>
      {/* wood rim + pale top, like the room's table */}
      <mesh position={[0, h - 0.025, 0]}>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={WOOD} roughness={0.55} />
      </mesh>
      <mesh position={[0, h + 0.002, 0]}>
        <boxGeometry args={[w - rim * 2, 0.01, d - rim * 2]} />
        <meshStandardMaterial color={TOP} roughness={0.35} />
      </mesh>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, (h - 0.05) / 2, z]}>
          <boxGeometry args={[0.08, h - 0.05, 0.08]} />
          <meshStandardMaterial color={WALNUT} roughness={0.6} />
        </mesh>
      ))}
      {chairs.map((c, i) => (
        <group key={i} position={c.position} rotation={[0, c.rotationY, 0]}>
          <Chair />
        </group>
      ))}
    </group>
  );
}

function Chair() {
  return (
    <group>
      {/* seat */}
      <mesh position={[0, 0.46, 0]}>
        <boxGeometry args={[0.5, 0.08, 0.48]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
      </mesh>
      {/* back (at the chair's rear: local -z, the front faces +z) */}
      <mesh position={[0, 0.76, -0.22]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[0.48, 0.5, 0.07]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
      </mesh>
      {/* chrome sled legs */}
      {[-0.21, 0.21].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.22, 0]}>
            <boxGeometry args={[0.025, 0.44, 0.44]} />
            <meshStandardMaterial color={CHROME} metalness={0.35} roughness={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Cabinet({ size }: { size: Vec3 }) {
  const [w, h, d] = size;
  const doors = Math.max(2, Math.round(w / 0.5));
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={WALNUT} roughness={0.55} />
      </mesh>
      {/* door panels and pulls on the front (+z) */}
      {Array.from({ length: doors }, (_, i) => {
        const pw = w / doors;
        const x = -w / 2 + pw * (i + 0.5);
        return (
          <group key={i}>
            <mesh position={[x, h / 2, d / 2 + 0.004]}>
              <boxGeometry args={[pw - 0.04, h - 0.1, 0.01]} />
              <meshStandardMaterial color={WOOD_LIGHT} roughness={0.5} />
            </mesh>
            <mesh position={[x + (i % 2 ? -1 : 1) * (pw / 2 - 0.06), h / 2, d / 2 + 0.02]}>
              <boxGeometry args={[0.015, 0.14, 0.02]} />
              <meshStandardMaterial color={BRASS} metalness={0.4} roughness={0.35} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

"use client";

/**
 * ToyCarSmoke: a separate copy of ToyCar with exhaust smoke.
 *
 * Same car, same controls and props as ToyCar, plus:
 *   smoke       turn the exhaust smoke on or off (default true)
 *   smokeColor  smoke tint (default a warm grey)
 *   headlights  front lights on or off: real spot beams, glowing lenses and a faint light cone
 *
 * Smoke comes out of both tailpipes while the car is driving. Harder throttle
 * and higher speed give thicker, longer streams. The puffs are blown backward
 * (or forward when reversing) so the car looks like it is moving, even though
 * it stays in place. Nothing comes out when the car is stopped.
 *
 * Give it a `terrain` function (height at x, z) and it drives for real: it moves, turns, rides
 * over hills, pitches and rolls with the ground, and leaves its smoke behind in the world.
 * On top of that the car has real vertical physics: it leaves the ground when the surface drops away
 * (kickers, crests), flies a ballistic arc, noses along its flight path and lands with a bump that
 * costs some speed. `grip` (surface grip 0..1) makes gravel and grass slower, `collide` pushes it out
 * of trees and boulders.
 * `pose` (optional ref) receives its world position and heading every frame.
 *
 * Keep ToyCar.tsx untouched as the safe version; edit this one freely.
 */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CarInput = { fwd: number; back: number; left: number; right: number; brake: number };

export type CarPose = { x: number; y: number; z: number; yaw: number; speed: number };

export type ToyCarSmokeProps = {
  /** Paint color. */
  color?: string;
  /** Listen to the keyboard. Set false if you supply your own `input`. */
  keyboard?: boolean;
  /** External input ref (values 0 or 1). Used instead of the keyboard when provided. */
  input?: MutableRefObject<CarInput>;
  /** Top ground speed in units per second. */
  maxSpeed?: number;
  /** Max front-wheel steering angle in radians. */
  maxSteer?: number;
  /** Called every frame with the current ground speed. */
  onSpeed?: (speed: number) => void;
  /** Exhaust smoke on or off. */
  smoke?: boolean;
  /** Smoke tint. */
  smokeColor?: string;
  /** Ground height at (x, z). When given, the car really drives over that ground. */
  terrain?: (x: number, z: number) => number;
  /** Surface grip at (x, z), 1 = asphalt, lower = loose. Only used when `terrain` is given. */
  grip?: (x: number, z: number) => number;
  /** Obstacles: returns the push-out vector when a circle of radius r at (x, z) overlaps something. */
  collide?: (x: number, z: number, r: number) => [number, number] | null;
  /** Receives the car's world position and heading every frame (for cameras, lights). */
  pose?: MutableRefObject<CarPose>;
  /** Where the car may drive when `terrain` is given (center of the car stays inside). */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the car starts when `terrain` is given. */
  start?: { x: number; z: number; yaw?: number };
  /** Optional scale factor for the car (default 1.0). */
  carScale?: number;
  /**
   * Car body: the original procedural toy car, the Renault R17 GLB (public/models/r17.glb, built by scripts/build-r17.mjs),
   * or the Ferrari SF90 GLB (public/models/sf90.glb, built by scripts/build-sf90.mjs). The SF90 has no headlights,
   * ONE exhaust plume from the middle of the rear, and a small red dot light at the back instead of light bars.
   */
  model?: "toy" | "r17" | "sf90";
  /** Front lights: real beams, glowing lenses and a light cone. */
  headlights?: boolean;
  /** How visible the light cone is (1 at night, lower in daylight). */
  beam?: number;
} & Omit<ThreeElements["group"], "ref">;

const KEY_MAP: Record<string, keyof CarInput> = {
  KeyW: "fwd", ArrowUp: "fwd", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", Space: "brake",
};

const WHEEL_R = 0.45;
const WHEEL_X = 0.86;
const WHEEL_Z = 1.2;

/* Renault R17 model (scripts/build-r17.mjs): same wheelbase as the toy car, smaller wheels, narrower track. */
const R17_URL = "/models/r17.glb";
const R17_WHEEL_R = 0.3182;
const R17_WHEEL_X = 0.698;
const R17_Z_SHIFT = -0.04; // the GLB's axles sit at z = 1.24 / -1.16; shift so they are at +-1.2 like the toy car
const R17_EXHAUST = { x: 0.45, y: 0.32, z: -2.1 };
const R17_LAMP = { x: 0.54, y: 0.6, z: 1.92 };

/* Ferrari SF90 (scripts/build-sf90.mjs): same wheelbase as the toy car, small F1 wheels, one centre exhaust. Credit: "Ferrari F1 2019" by vecarz, CC-BY-4.0. */
const SF90_URL = "/models/sf90.glb";
const SF90_SCALE = 1.5; // the F1 is long and low next to the R17, so it is shown 1.5x bigger than the 2.4 wheelbase build
const SF90_WHEEL_R = 0.2016 * SF90_SCALE;
const SF90_WHEEL_X = 0.523 * SF90_SCALE;
const SF90_EXHAUST = { x: 0, y: 0.36 * SF90_SCALE, z: -1.34 * SF90_SCALE }; // the single exhaust tip, centre line, just behind the engine cover
const SF90_DOT = { y: 0.285, z: -1.64 };           // red dot light on the tip of the rear crash structure, centre line (unscaled: it sits inside the scaled group)
const LUGS = 28;
const SPOKE_PAIRS = 5;
const DEFAULT_BOUNDS = { minX: -235, maxX: 235, minZ: -235, maxZ: 235 };
const GRAVITY = 26; // toy-world gravity (units/s²): snappy hops instead of floaty ones

/* ---------- geometry helpers ---------- */

/**
 * Make the big flat side faces (the extrusion caps) perfectly flat-shaded. Creased normals blend them
 * with the rounded bevel, and the long sliver triangles there then show up as thin shading streaks.
 * Bevels and curved parts keep their smooth normals.
 */
function flattenCaps(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.sub(b)).normalize();
    if (Math.abs(n.x) > 0.9999) {
      const out = Math.sign(nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) || 1;
      for (let j = 0; j < 3; j++) nor.setXYZ(i + j, out, 0, 0);
    }
  }
  nor.needsUpdate = true;
}

/** Extrude a side-view profile (x = car length, y = height) across the car's width, with rounded edges. */
function extrudeSide(shape: THREE.Shape, width: number, bevel: number, segments = 5) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: segments,
    curveSegments: 28,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // profile x -> car z, extrusion -> car x
  const out = toCreasedNormals(g, 0.7); // smooth curves, keep hard edges
  flattenCaps(out);
  return out;
}

function poly(pts: [number, number][]) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/** Thin roof panel sitting flush on top of the glass, so the cabin reads as glass with a roof, not a fat cap. */
function roofShape() {
  const s = new THREE.Shape();
  s.moveTo(0.46, 1.66);
  s.quadraticCurveTo(0.4, 1.775, 0.12, 1.785); // windshield header
  s.lineTo(-0.4, 1.795);                        // gentle crown
  s.quadraticCurveTo(-0.62, 1.79, -0.68, 1.66); // rear edge, just past the rear glass
  s.closePath();
  return s;
}

/** Main body: side silhouette with two wheel arches cut out of the bottom. */
function bodyShape() {
  const r = 0.52, cy = WHEEL_R, sill = 0.32;
  const dx = Math.sqrt(r * r - (cy - sill) ** 2);
  const a1 = Math.atan2(sill - cy, -dx);
  const a2 = Math.atan2(sill - cy, dx);
  const s = new THREE.Shape();
  s.moveTo(-1.9, sill);
  s.lineTo(-WHEEL_Z - dx, sill);
  s.absarc(-WHEEL_Z, cy, r, a1 + Math.PI * 2, a2 + Math.PI * 2, true);
  s.lineTo(WHEEL_Z - dx, sill);
  s.absarc(WHEEL_Z, cy, r, a1 + Math.PI * 2, a2 + Math.PI * 2, true);
  s.lineTo(1.9, sill);
  s.lineTo(1.97, 0.5);
  s.lineTo(1.97, 0.85);
  s.lineTo(1.78, 1.06);
  s.lineTo(0.95, 1.14);   // hood
  s.lineTo(-1.5, 1.16);   // deck
  s.lineTo(-1.85, 1.12);
  s.lineTo(-1.97, 0.9);
  s.lineTo(-1.97, 0.5);
  s.closePath();
  return s;
}

/** Rounded tire profile revolved around its axle. */
function makeTireGeometry() {
  const pts = [
    [0.27, -0.15], [0.33, -0.17], [0.40, -0.16], [0.435, -0.12], [0.452, -0.06],
    [0.455, 0], [0.452, 0.06], [0.435, 0.12], [0.40, 0.16], [0.33, 0.17], [0.27, 0.15],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(Math.PI / 2); // axle along X
  return g;
}

/* ---------- shared materials ---------- */

function useMaterials(color: string) {
  return useMemo(() => {
    const std = (c: string, o: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, ...o });
    return {
      paint: new THREE.MeshPhysicalMaterial({
        color, roughness: 0.28, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: "#22303d", roughness: 0.05, metalness: 0.6, clearcoat: 1,
      }),
      trim: std("#17171a", { roughness: 0.7 }),
      tire: std("#161618", { roughness: 0.92 }),
      chrome: std("#d8d8dc", { metalness: 1, roughness: 0.18 }),
      disc: std("#8c8c94", { metalness: 0.85, roughness: 0.4 }),
      caliper: std("#d8262c", { roughness: 0.4 }),
      // headlight lens: dim glass when the lights are off, glowing when they are on (driven in useFrame)
      lamp: std("#fff6c9", { emissive: "#ffe9a0", emissiveIntensity: 0.05, roughness: 0.2 }),
      tail: std("#ff2b2b", { emissive: "#ff1a1a", emissiveIntensity: 0.7, roughness: 0.3 }),
      plate: std("#f1efe8", { roughness: 0.5 }),
    };
  }, [color]);
}

type Mats = ReturnType<typeof useMaterials>;

/* ---------- smoke ---------- */

const SMOKE_MAX = 240;
const EXHAUST_X = 0.5;
const EXHAUST_Y = 0.4;
const EXHAUST_Z = -2.08; // just past the tip of the tailpipe

const SMOKE_VERT = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uHeight;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // world-space diameter -> pixels, honoring the camera's field of view
    gl_PointSize = aSize * uHeight * 0.5 * projectionMatrix[1][1] / max(0.001, -mv.z);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float soft = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(uColor, soft * vAlpha);
    if (gl_FragColor.a < 0.005) discard;
  }
`;

function createSmoke(color: string) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SMOKE_MAX * 3), 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(SMOKE_MAX), 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(SMOKE_MAX), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uHeight: { value: 800 } },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  return {
    geo,
    mat,
    vel: new Float32Array(SMOKE_MAX * 3),
    age: new Float32Array(SMOKE_MAX).fill(1),
    life: new Float32Array(SMOKE_MAX).fill(1), // age >= life means the particle is dead
    a0: new Float32Array(SMOKE_MAX),
    head: 0,
    acc: 0,
    count: 0,
  };
}

type Smoke = ReturnType<typeof createSmoke>;

/** Tailpipe positions (side +x and -x) and car velocity in world space, used when the car really drives. */
type Exhaust = { p: THREE.Vector3; n: THREE.Vector3; vx: number; vz: number };

/** Where the smoke comes out in car space (x = 0 means a single centre exhaust). */
type Pipe = { x: number; y: number; z: number };

function spawnPuff(sm: Smoke, speed: number, throttle: number, pipe: Pipe, ex?: Exhaust) {
  const i = sm.head;
  sm.head = (sm.head + 1) % SMOKE_MAX;
  const side = sm.count++ % 2 ? 1 : -1;
  const pos = sm.geo.attributes.position as THREE.BufferAttribute;
  if (ex) {
    // driving: puffs are born at the tailpipes in world space and get left behind as the car moves on
    const p = side === 1 ? ex.p : ex.n;
    pos.setXYZ(i, p.x + (Math.random() - 0.5) * 0.05, p.y, p.z + (Math.random() - 0.5) * 0.05);
    sm.vel[i * 3] = ex.vx * 0.25 + (Math.random() - 0.5) * 0.4;
    sm.vel[i * 3 + 1] = 0.35 + Math.random() * 0.45;
    sm.vel[i * 3 + 2] = ex.vz * 0.25 + (Math.random() - 0.5) * 0.4;
  } else {
    pos.setXYZ(i, side * pipe.x + (Math.random() - 0.5) * 0.05, pipe.y, pipe.z);

    // car stays in place: air rushes past it, blowing the smoke backward (none is spawned when reversing)
    const dir = -1;
    const flow = Math.abs(speed) * 0.8 + 1.0;
    sm.vel[i * 3] = (pipe.x === 0 ? 0 : side * 0.12) + (Math.random() - 0.5) * 0.35; // a single centre pipe must not split into two streams
    sm.vel[i * 3 + 1] = 0.35 + Math.random() * 0.45;
    sm.vel[i * 3 + 2] = dir * flow * (0.8 + Math.random() * 0.4);
  }

  sm.age[i] = 0;
  sm.life[i] = 1.1 + Math.random() * 0.9;
  sm.a0[i] = throttle !== 0 ? 0.5 : 0.28; // thicker puffs under throttle
}

function updateSmoke(sm: Smoke, dt: number, speed: number, throttle: number, on: boolean, pipe: Pipe, ex?: Exhaust) {
  // no smoke while reversing (reverse pedal held, or still rolling backward)
  const reversing = throttle < 0 || speed < -0.05;
  const rate = !on || reversing ? 0 : throttle !== 0 ? Math.min(45, 12 + Math.abs(speed) * 3) : Math.min(7, Math.abs(speed) * 0.8);
  sm.acc = reversing ? 0 : sm.acc + rate * dt;
  while (sm.acc >= 1) {
    sm.acc -= 1;
    spawnPuff(sm, speed, throttle, pipe, ex);
  }

  const pos = sm.geo.attributes.position as THREE.BufferAttribute;
  const alpha = sm.geo.attributes.aAlpha as THREE.BufferAttribute;
  const size = sm.geo.attributes.aSize as THREE.BufferAttribute;
  const drag = Math.max(0, 1 - 0.6 * dt);

  for (let i = 0; i < SMOKE_MAX; i++) {
    if (sm.age[i] >= sm.life[i]) {
      alpha.setX(i, 0);
      size.setX(i, 0);
      continue;
    }
    sm.age[i] += reversing ? dt * 5 : dt; // leftover puffs clear out fast when reversing
    const t = Math.min(1, sm.age[i] / sm.life[i]);
    sm.vel[i * 3] *= drag;
    sm.vel[i * 3 + 2] *= drag;
    sm.vel[i * 3 + 1] *= Math.max(0, 1 - 0.3 * dt);
    pos.setXYZ(
      i,
      pos.getX(i) + sm.vel[i * 3] * dt,
      pos.getY(i) + sm.vel[i * 3 + 1] * dt,
      pos.getZ(i) + sm.vel[i * 3 + 2] * dt
    );
    size.setX(i, 0.14 + 0.5 * Math.sqrt(t));        // puffs expand as they cool
    alpha.setX(i, sm.a0[i] * Math.pow(1 - t, 1.5)); // and fade out
  }
  pos.needsUpdate = true;
  alpha.needsUpdate = true;
  size.needsUpdate = true;
}

/* ---------- wheel ---------- */

type WheelProps = {
  side: 1 | -1;
  z: number;
  mats: Mats;
  tireGeo: THREE.BufferGeometry;
  spinRef: (g: THREE.Group | null) => void;
  pivotRef?: (g: THREE.Group | null) => void;
};

function Wheel({ side, z, mats, tireGeo, spinRef, pivotRef }: WheelProps) {
  const lugs = useMemo(
    () =>
      Array.from({ length: LUGS }, (_, i) => {
        const a = (i / LUGS) * Math.PI * 2;
        return { pos: [0, Math.sin(a) * 0.455, Math.cos(a) * 0.455] as [number, number, number], rot: Math.PI / 2 - a };
      }),
    []
  );
  const nuts = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return [side * 0.175, Math.sin(a) * 0.1, Math.cos(a) * 0.1] as [number, number, number];
      }),
    [side]
  );

  return (
    <group position={[side * WHEEL_X, WHEEL_R, z]} ref={pivotRef}>
      {/* caliper stays put while the wheel spins */}
      <mesh position={[side * 0.01, 0.15, 0.13]} material={mats.caliper}>
        <boxGeometry args={[0.11, 0.14, 0.13]} />
      </mesh>

      <group ref={spinRef}>
        <mesh geometry={tireGeo} material={mats.tire} />
        {lugs.map((l, i) => (
          <mesh key={i} position={l.pos} rotation={[l.rot, 0, 0]} material={mats.tire}>
            <boxGeometry args={[0.27, 0.03, 0.06]} />
          </mesh>
        ))}

        {/* rim barrel and lip */}
        <mesh rotation={[0, 0, Math.PI / 2]} material={mats.chrome}>
          <cylinderGeometry args={[0.3, 0.3, 0.3, 36, 1, true]} />
        </mesh>
        <mesh position={[side * 0.15, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.chrome}>
          <torusGeometry args={[0.295, 0.022, 10, 40]} />
        </mesh>

        {/* brake disc seen through the spokes */}
        <mesh position={[side * 0.03, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.disc}>
          <cylinderGeometry args={[0.25, 0.25, 0.03, 36]} />
        </mesh>

        {/* 10 spokes */}
        {Array.from({ length: SPOKE_PAIRS }, (_, i) => (
          <mesh key={i} position={[side * 0.13, 0, 0]} rotation={[(i / SPOKE_PAIRS) * Math.PI, 0, 0]} material={mats.chrome}>
            <boxGeometry args={[0.035, 0.58, 0.05]} />
          </mesh>
        ))}

        {/* hub cap and lug nuts */}
        <mesh position={[side * 0.16, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.paint}>
          <cylinderGeometry args={[0.075, 0.075, 0.04, 20]} />
        </mesh>
        {nuts.map((p, i) => (
          <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]} material={mats.chrome}>
            <cylinderGeometry args={[0.015, 0.015, 0.03, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ---------- headlights ---------- */

let glowTexCache: THREE.CanvasTexture | null = null;
let poolTexCache: THREE.CanvasTexture | null = null;

function glowTexture() {
  if (!glowTexCache) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,244,205,0.65)");
    g.addColorStop(1, "rgba(255,244,205,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    glowTexCache = new THREE.CanvasTexture(canvas);
  }
  return glowTexCache;
}

function groundPoolTexture() {
  if (!poolTexCache) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255, 246, 215, 0.75)");
    g.addColorStop(0.35, "rgba(255, 238, 185, 0.42)");
    g.addColorStop(0.7, "rgba(255, 225, 155, 0.15)");
    g.addColorStop(1, "rgba(255, 210, 130, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    poolTexCache = new THREE.CanvasTexture(canvas);
  }
  return poolTexCache;
}

/** One headlight: spot beam illuminating track & grass, lens glow, and ground light pool. `level` (0..1) fades everything in and out. */
function HeadlightSide({ x, level, y = 0.86, z = 2.0 }: { x: number; level: MutableRefObject<number>; beam?: number; y?: number; z?: number }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const poolMat = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useMemo(() => glowTexture(), []);
  const poolTex = useMemo(() => groundPoolTexture(), []);

  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(() => {
    const l = level.current;
    if (light.current) light.current.intensity = 280 * l;
    if (sprite.current) {
      sprite.current.visible = l > 0.01;
      (sprite.current.material as THREE.SpriteMaterial).opacity = 0.85 * l;
    }
    if (poolMat.current) {
      poolMat.current.opacity = 0.52 * l;
      poolMat.current.visible = l > 0.01;
    }
  });

  return (
    <>
      {/* Real spotlight shining downwards onto both track and terrain */}
      <spotLight
        ref={light}
        position={[x, y, z]}
        color="#fff4d0"
        intensity={0}
        distance={55}
        angle={0.62}
        penumbra={0.65}
        decay={1.3}
      />
      <object3D ref={target} position={[x * 0.45, -0.2, 14]} />

      {/* Ground headlight pool: always shows brightly on track asphalt and grass */}
      <mesh position={[x * 0.5, 0.035, 7.5]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <planeGeometry args={[4.4, 8.8]} />
        <meshBasicMaterial
          ref={poolMat}
          map={poolTex}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Lens glow at the headlight bezel */}
      <sprite ref={sprite} position={[x, y, z + 0.02]} scale={[1.1, 1.1, 1]} visible={false}>
        <spriteMaterial
          map={glow}
          color="#fff2c4"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          opacity={0}
        />
      </sprite>
    </>
  );
}

/* ---------- Renault R17 body ---------- */

/** Loads the R17 GLB, repaints it with the shared materials and hands the wheel / steering nodes to the physics. */
function R17Body({
  mats,
  spinGroups,
  steerPivots,
  cast,
}: {
  mats: Mats;
  spinGroups: MutableRefObject<THREE.Group[]>;
  steerPivots: MutableRefObject<THREE.Group[]>;
  cast: boolean;
}) {
  const gltf = useGLTF(R17_URL);
  const root = useMemo(() => {
    const r = gltf.scene.clone(true);
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.matName = (m.material as THREE.Material).name;
      m.castShadow = cast;
    });
    return r;
  }, [gltf, cast]);

  // GLB material names -> the shared materials, so the `color` prop still repaints the car
  useLayoutEffect(() => {
    const map: Record<string, THREE.Material> = {
      paint: mats.paint, glass: mats.glass, trim: mats.trim, lamp: mats.lamp,
      tail: mats.tail, chrome: mats.chrome, tire: mats.tire, rim: mats.chrome,
    };
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && map[m.userData.matName]) m.material = map[m.userData.matName];
    });
  }, [root, mats]);

  useLayoutEffect(() => {
    const get = (n: string) => root.getObjectByName(n) as THREE.Group;
    // same order as the toy car: 0 front +x, 1 front -x, 2 rear +x, 3 rear -x
    spinGroups.current = [get("Wheel_FL"), get("Wheel_FR"), get("Wheel_RL"), get("Wheel_RR")];
    steerPivots.current = [get("Steer_FL"), get("Steer_FR")];
  }, [root, spinGroups, steerPivots]);

  return (
    <group position={[0, 0, R17_Z_SHIFT]}>
      <primitive object={root} />
    </group>
  );
}

/* ---------- Ferrari SF90 body ---------- */

/** Loads the SF90 GLB and hands its wheel / steering nodes to the physics. It keeps its own livery and materials (the paint colour does not apply). */
function Sf90Body({
  spinGroups,
  steerPivots,
  cast,
}: {
  spinGroups: MutableRefObject<THREE.Group[]>;
  steerPivots: MutableRefObject<THREE.Group[]>;
  cast: boolean;
}) {
  const gltf = useGLTF(SF90_URL);
  const root = useMemo(() => {
    const r = gltf.scene.clone(true);
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = cast;
    });
    return r;
  }, [gltf, cast]);

  useLayoutEffect(() => {
    const get = (n: string) => root.getObjectByName(n) as THREE.Group;
    // same order as the toy car: 0 front +x, 1 front -x, 2 rear +x, 3 rear -x
    spinGroups.current = [get("Wheel_FL"), get("Wheel_FR"), get("Wheel_RL"), get("Wheel_RR")];
    steerPivots.current = [get("Steer_FL"), get("Steer_FR")];
  }, [root, spinGroups, steerPivots]);

  return <primitive object={root} />;
}

let redGlowTexCache: THREE.CanvasTexture | null = null;

function redGlowTexture() {
  if (!redGlowTexCache) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,160,150,1)");
    g.addColorStop(0.3, "rgba(255,40,30,0.7)");
    g.addColorStop(1, "rgba(255,20,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    redGlowTexCache = new THREE.CanvasTexture(canvas);
  }
  return redGlowTexCache;
}

/** One small red dot light at the back (instead of light bars) with a soft halo. It flares up when braking or reversing, like the other tail lights. */
function RearDot({ mats, y, z }: { mats: Mats; y: number; z: number }) {
  const halo = useRef<THREE.Sprite>(null);
  const glow = useMemo(() => redGlowTexture(), []);

  useFrame(() => {
    // mats.tail.emissiveIntensity is ~0.6-1.0 normally and jumps by 1.6 under braking
    const t = Math.min(1, Math.max(0, (mats.tail.emissiveIntensity - 0.6) / 1.9));
    const h = halo.current;
    if (h) {
      (h.material as THREE.SpriteMaterial).opacity = 0.35 + 0.55 * t;
      h.scale.setScalar(0.28 + 0.2 * t);
    }
  });

  return (
    <>
      <mesh position={[0, y, z]} material={mats.tail}>
        <sphereGeometry args={[0.045, 16, 12]} />
      </mesh>
      <sprite ref={halo} position={[0, y, z - 0.03]} scale={[0.28, 0.28, 1]}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} opacity={0.35} />
      </sprite>
    </>
  );
}

/* ---------- car ---------- */

export default function ToyCarSmoke({
  color = "#8d9196",
  keyboard = true,
  input,
  maxSpeed = 14,
  maxSteer = 0.55,
  onSpeed,
  smoke: smokeOn = true,
  smokeColor = "#9a9792",
  terrain,
  grip,
  collide,
  pose,
  bounds,
  start,
  carScale = 1.0,
  model = "toy",
  headlights = false,
  beam = 1,
  ...groupProps
}: ToyCarSmokeProps) {
  const r17 = model === "r17";
  const sf90 = model === "sf90";
  const wheelR = sf90 ? SF90_WHEEL_R : r17 ? R17_WHEEL_R : WHEEL_R;
  const trackX = sf90 ? SF90_WHEEL_X : r17 ? R17_WHEEL_X : WHEEL_X;
  const exX = sf90 ? SF90_EXHAUST.x : r17 ? R17_EXHAUST.x : EXHAUST_X;
  const exY = sf90 ? SF90_EXHAUST.y : r17 ? R17_EXHAUST.y : EXHAUST_Y;
  const exZ = sf90 ? SF90_EXHAUST.z : r17 ? R17_EXHAUST.z : EXHAUST_Z;
  const pipe = useMemo<Pipe>(() => ({ x: exX, y: exY, z: exZ }), [exX, exY, exZ]);
  const carRef = useRef<THREE.Group>(null);
  const spinGroups = useRef<THREE.Group[]>([]);
  const steerPivots = useRef<THREE.Group[]>([]);
  const keys = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });
  const sim = useRef({ speed: 0, steer: 0, pitch: 0, roll: 0 });
  const lightLevel = useRef(headlights ? 1 : 0);

  // world driving (only used when `terrain` is given)
  const outerRef = useRef<THREE.Group>(null);
  const poseRef = useRef<THREE.Group>(null);
  const world = useRef({
    x: start?.x ?? 0,
    z: start?.z ?? 0,
    y: 0,
    yaw: start?.yaw ?? 0,
    pitch: 0,
    roll: 0,
    slope: 0,
    // vertical physics
    vy: 0,         // vertical speed of the car body
    gv: 0,         // smoothed vertical speed of the ground under it (what the car "inherits" when it takes off)
    gy: 0,         // ground height under the car last frame
    ginit: false,
    air: false,
    // suspension spring that rings after a landing
    comp: 0,
    compV: 0,
    // smoothed surface grip
    grip: 1,
  });
  const exhaust = useMemo(() => ({ p: new THREE.Vector3(), n: new THREE.Vector3(), vx: 0, vz: 0 }), []);
  const driving = !!terrain;
  useEffect(() => {
    if (!driving) return;
    carRef.current?.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }, [driving]);

  const mats = useMaterials(color);
  const geo = useMemo(
    () => ({
      body: extrudeSide(bodyShape(), 1.8, 0.1),
      glass: extrudeSide(poly([[0.9, 1.12], [0.4, 1.7], [-0.6, 1.72], [-1.1, 1.15]]), 1.4, 0.05, 4),
      roof: extrudeSide(roofShape(), 1.44, 0.03, 4),
      tire: makeTireGeometry(),
      flare: new THREE.TorusGeometry(0.545, 0.035, 10, 40, Math.PI).rotateY(Math.PI / 2),
    }),
    []
  );

  const smoke = useMemo(() => createSmoke(smokeColor), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    smoke.mat.uniforms.uColor.value.set(smokeColor);
  }, [smoke, smokeColor]);
  useEffect(
    () => () => {
      smoke.geo.dispose();
      smoke.mat.dispose();
    },
    [smoke]
  );

  useEffect(() => {
    if (!keyboard) return;
    const down = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) { keys.current[k] = 1; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) keys.current[k] = 0;
    };
    const reset = () => { keys.current = { fwd: 0, back: 0, left: 0, right: 0, brake: 0 }; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, [keyboard]);

  const collect = (list: MutableRefObject<THREE.Group[]>, i: number) => (g: THREE.Group | null) => {
    if (g) list.current[i] = g;
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = sim.current;
    const w = world.current;
    const k = input ? input.current : keys.current;

    // lights fade in and out (lens glow, beams, cone) and the tail lights flare when braking
    lightLevel.current += ((headlights ? 1 : 0) - lightLevel.current) * Math.min(1, dt * 9);
    mats.lamp.emissiveIntensity = 0.05 + 2.6 * lightLevel.current;
    mats.tail.emissiveIntensity = 0.6 + 0.35 * lightLevel.current + (k.brake || k.back ? 1.6 : 0);

    const throttle = k.fwd - k.back;
    const target = throttle * maxSpeed;

    // surface grip under the car (smoothed so crossing the gravel edge isn't a jolt)
    if (terrain && grip) w.grip += (grip(w.x, w.z) - w.grip) * Math.min(1, dt * 8);
    const gripNow = terrain && grip ? w.grip : 1;
    const onGround = !terrain || !w.air;

    if (onGround) {
      s.speed += (target - s.speed) * Math.min(1, dt * (throttle ? 2.2 : 1.2) * (0.35 + 0.65 * gripNow));
      if (terrain) {
        s.speed -= w.slope * 8 * dt;                          // uphill slows the car, downhill speeds it up
        s.speed -= s.speed * (1 - gripNow) * 0.55 * dt;       // gravel and grass drag it down
      }
      if (k.brake) s.speed *= Math.pow(0.02, dt * (0.5 + 0.5 * gripNow));
    } else {
      s.speed *= 1 - 0.04 * dt;                               // in the air: no engine, no brakes, just a little drag
    }
    if (Math.abs(s.speed) < 0.02 && !throttle) s.speed = 0;

    s.steer += ((k.left - k.right) * maxSteer - s.steer) * Math.min(1, dt * 9);

    if (terrain) {
      // move: bicycle steering, a bit less twitchy at speed, less bite on loose ground, almost none in the air
      const authority = w.air ? 0.15 : 0.55 + 0.45 * gripNow;
      const steerEff = (s.steer * authority) / (1 + Math.abs(s.speed) * 0.12);
      w.yaw += ((s.speed * Math.tan(steerEff)) / (WHEEL_Z * 2)) * dt;
      w.x += Math.sin(w.yaw) * s.speed * dt;
      w.z += Math.cos(w.yaw) * s.speed * dt;

      // trees, rocks, bushes, signs & barriers: solid collision with elastic crash response
      if (collide && !(w.air && w.y - w.gy > 1.8)) {
        const snCol = Math.sin(w.yaw), csCol = Math.cos(w.yaw);
        // Multi-point chassis collision: front bumper, center, and rear bumper
        const fX = w.x + snCol * 1.35 * carScale;
        const fZ = w.z + csCol * 1.35 * carScale;
        const rX = w.x - snCol * 1.35 * carScale;
        const rZ = w.z - csCol * 1.35 * carScale;

        const hitCenter = collide(w.x, w.z, 1.05 * carScale);
        const hitFront = collide(fX, fZ, 0.95 * carScale);
        const hitRear = collide(rX, rZ, 0.95 * carScale);

        const hit = hitCenter || hitFront || hitRear;
        if (hit) {
          w.x += hit[0] * 1.15;
          w.z += hit[1] * 1.15;

          const pLen = Math.hypot(hit[0], hit[1]);
          if (pLen > 0.001) {
            const nx = hit[0] / pLen;
            const nz = hit[1] / pLen;
            const dot = (snCol * nx + csCol * nz) * s.speed;
            if (dot < 0) {
              // Moving into obstacle: rebound with realistic crash bounce
              s.speed = -s.speed * 0.35;
              w.comp = Math.min(0.28, w.comp + 0.14);
            } else {
              s.speed *= 0.3;
            }
          }
        }
      }

      // soft walls at the edge of the allowed area
      const b = bounds ?? DEFAULT_BOUNDS;
      if (w.x < b.minX || w.x > b.maxX || w.z < b.minZ || w.z > b.maxZ) {
        w.x = Math.max(b.minX, Math.min(b.maxX, w.x));
        w.z = Math.max(b.minZ, Math.min(b.maxZ, w.z));
        s.speed *= 0.9;
      }

      // sample the ground under all four wheels
      const sn = Math.sin(w.yaw), cs = Math.cos(w.yaw);
      const wheelX = trackX * carScale;
      const wheelZ = WHEEL_Z * carScale;
      const ground = (lx: number, lz: number) => terrain(w.x + cs * lx + sn * lz, w.z - sn * lx + cs * lz);
      const fl = ground(wheelX, wheelZ), fr = ground(-wheelX, wheelZ);
      const rl = ground(wheelX, -wheelZ), rr = ground(-wheelX, -wheelZ);
      const gAvg = (fl + fr + rl + rr) / 4;
      const front = (fl + fr) / 2, rear = (rl + rr) / 2;
      const slope = (front - rear) / (wheelZ * 2); // rise per unit driven forward

      /* vertical physics: the car is a ballistic body that the ground holds up.
         Driving up a kicker it inherits the ground's upward speed, so when the surface falls away
         (the lip, a crest) it keeps going and flies. It lands again when the ground comes back up. */
      if (!w.ginit) {
        w.ginit = true;
        w.y = gAvg;
        w.gy = gAvg;
      }
      const gvRaw = (gAvg - w.gy) / Math.max(dt, 1e-3);
      w.gv += (gvRaw - w.gv) * Math.min(1, dt * 22);
      w.gy = gAvg;
      w.vy = Math.max(-40, Math.min(18, w.vy - GRAVITY * dt));
      const ny = w.y + w.vy * dt;
      if (ny <= gAvg + (w.air ? 0 : 0.04)) {
        if (w.air) {
          // touchdown: the harder the hit (relative to the ground's own motion), the more speed it costs
          const impact = Math.max(0, -(w.vy - w.gv));
          if (impact > 2) {
            s.speed *= 1 - Math.min(0.28, impact * 0.011);
            w.comp = Math.min(0.3, 0.02 + impact * 0.018);
            w.compV = 0;
          }
          w.air = false;
        }
        w.y = gAvg;
        w.vy = w.gv;
      } else {
        w.air = true;
        w.y = ny;
      }

      // attitude: follow the ground while on it, follow the flight path in the air
      if (!w.air) {
        const ease = Math.min(1, dt * 14);
        w.pitch += (-Math.atan(slope) - w.pitch) * ease;
        w.roll += (Math.atan((fl + rl - fr - rr) / 2 / (wheelX * 2)) - w.roll) * ease;
      } else {
        const dir = s.speed < 0 ? -1 : 1;
        const airPitch = -Math.atan2(w.vy * dir, Math.max(3, Math.abs(s.speed))) * 0.85;
        w.pitch += (airPitch - w.pitch) * Math.min(1, dt * 3.2);
        w.roll += (0 - w.roll) * Math.min(1, dt * 1.5);
      }
      w.slope = slope;

      // suspension spring that rings after a landing
      w.compV += (-w.comp * 200 - w.compV * 12) * dt;
      w.comp += w.compV * dt;

      const g = poseRef.current;
      if (g) {
        g.position.set(w.x, w.y, w.z);
        g.rotation.set(w.pitch, w.yaw, w.roll, "YXZ");
        g.updateMatrixWorld();
        exhaust.p.set(exX * carScale, exY * carScale, exZ * carScale);
        exhaust.n.set(-exX * carScale, exY * carScale, exZ * carScale);
        g.localToWorld(exhaust.p);
        g.localToWorld(exhaust.n);
        const outer = outerRef.current;
        if (outer) {
          outer.updateWorldMatrix(true, false);
          outer.worldToLocal(exhaust.p);
          outer.worldToLocal(exhaust.n);
        }
      }
      exhaust.vx = Math.sin(w.yaw) * s.speed;
      exhaust.vz = Math.cos(w.yaw) * s.speed;

      if (pose) {
        const p = pose.current;
        p.x = w.x; p.y = w.y; p.z = w.z; p.yaw = w.yaw; p.speed = s.speed;
      }
    }

    const spin = (s.speed * dt) / (wheelR * carScale); // rolling without slipping
    for (const wh of spinGroups.current) if (wh) wh.rotation.x += spin;
    for (const p of steerPivots.current) if (p) p.rotation.y = s.steer;

    const accel = (throttle ? target - s.speed : 0) - (k.brake ? s.speed * 0.5 : 0);
    s.pitch += (-accel * 0.004 - s.pitch) * Math.min(1, dt * 6);
    s.roll += (s.steer * s.speed * 0.006 - s.roll) * Math.min(1, dt * 6);

    const car = carRef.current;
    if (car) {
      car.rotation.x = s.pitch + (terrain ? w.compV * 0.03 : 0);
      car.rotation.z = s.roll;
      car.position.y =
        0.02 * carScale +
        Math.abs(Math.sin(state.clock.elapsedTime * 20)) * Math.min(0.02, Math.abs(s.speed) * 0.0015) -
        (terrain ? Math.max(-0.12, Math.min(0.3, w.comp)) : 0);
    }

    // smoke
    smoke.mat.uniforms.uHeight.value = state.size.height * state.gl.getPixelRatio();
    updateSmoke(smoke, dt, s.speed, throttle, smokeOn, pipe, terrain ? exhaust : undefined);

    onSpeed?.(s.speed);
  });

  return (
    <group {...groupProps} ref={outerRef}>
      {/* moves around the world when `terrain` is given, otherwise stays at the origin */}
      <group ref={poseRef}>
      <group ref={carRef} scale={carScale} position={[0, 0.02 * carScale, 0]}>
        {r17 && (
          <>
            <Suspense fallback={null}>
              <R17Body mats={mats} spinGroups={spinGroups} steerPivots={steerPivots} cast={driving} />
            </Suspense>
            {[-1, 1].map((s) => (
              <HeadlightSide key={s} x={s * R17_LAMP.x} y={R17_LAMP.y} z={R17_LAMP.z} level={lightLevel} beam={beam} />
            ))}
          </>
        )}
        {sf90 && (
          <>
            {/* no headlights on this one: a single red dot light at the back, one smoke plume from the rear middle */}
            <group scale={SF90_SCALE}>
              <Suspense fallback={null}>
                <Sf90Body spinGroups={spinGroups} steerPivots={steerPivots} cast={driving} />
              </Suspense>
              <RearDot mats={mats} y={SF90_DOT.y} z={SF90_DOT.z} />
            </group>
          </>
        )}
        {!r17 && !sf90 && (
        <>
        {/* shell */}
        <mesh geometry={geo.body} material={mats.paint} />
        <mesh geometry={geo.glass} material={mats.glass} />
        <mesh geometry={geo.roof} material={mats.paint} />

        {/* dark wheel wells behind the tires */}
        {[WHEEL_Z, -WHEEL_Z].map((z) => (
          <mesh key={z} position={[0, 0.66, z]} material={mats.trim}>
            <boxGeometry args={[1.2, 0.6, 1.1]} />
          </mesh>
        ))}

        {/* arch flares, door cuts, handles, skirts, B pillars, mirrors */}
        {[-1, 1].map((s) => (
          <group key={s}>
            {[WHEEL_Z, -WHEEL_Z].map((z) => (
              <mesh key={z} geometry={geo.flare} material={mats.trim} position={[s * 0.905, WHEEL_R, z]} />
            ))}
            <mesh position={[s * 0.903, 0.74, 0.57]} material={mats.trim}><boxGeometry args={[0.008, 0.56, 0.012]} /></mesh>
            <mesh position={[s * 0.903, 0.74, -0.57]} material={mats.trim}><boxGeometry args={[0.008, 0.56, 0.012]} /></mesh>
            <mesh position={[s * 0.915, 0.98, -0.42]} material={mats.chrome}><boxGeometry args={[0.025, 0.04, 0.2]} /></mesh>
            <mesh position={[s * 0.9, 0.38, 0]} material={mats.trim}><boxGeometry args={[0.05, 0.1, 1.15]} /></mesh>
            {/* (no B pillar: the side glass stays one clean pane up to the roof) */}
            <mesh position={[s * 0.9, 1.19, 0.64]} material={mats.trim}><boxGeometry args={[0.14, 0.04, 0.05]} /></mesh>
            <mesh position={[s * 0.99, 1.23, 0.62]} material={mats.paint}><boxGeometry args={[0.1, 0.1, 0.19]} /></mesh>

            {/* headlight: chrome ring, lens (glows when the lights are on) */}
            <mesh position={[s * 0.62, 0.86, 1.93]} scale={[1, 0.85, 0.55]} material={mats.lamp}>
              <sphereGeometry args={[0.15, 20, 14]} />
            </mesh>
            <mesh position={[s * 0.62, 0.86, 1.93]} material={mats.chrome}>
              <torusGeometry args={[0.15, 0.015, 8, 28]} />
            </mesh>
            <HeadlightSide x={s * 0.62} level={lightLevel} beam={beam} />
            {/* tail light and exhaust */}
            <mesh position={[s * 0.62, 0.9, -1.96]} material={mats.tail}><boxGeometry args={[0.45, 0.12, 0.05]} /></mesh>
            <mesh position={[s * 0.5, 0.4, -1.97]} rotation={[Math.PI / 2, 0, 0]} material={mats.chrome}>
              <cylinderGeometry args={[0.055, 0.055, 0.18, 16]} />
            </mesh>
            {/* spoiler end plate and post */}
            <mesh position={[s * 0.75, 1.42, -1.78]} material={mats.trim}><boxGeometry args={[0.03, 0.14, 0.38]} /></mesh>
            <mesh position={[s * 0.5, 1.27, -1.78]} material={mats.trim}><boxGeometry args={[0.05, 0.22, 0.06]} /></mesh>
          </group>
        ))}

        {/* front: grille, slats, splitter, lower intake */}
        <mesh position={[0, 0.72, 1.965]} material={mats.trim}><boxGeometry args={[0.9, 0.16, 0.04]} /></mesh>
        {[-0.05, 0, 0.05].map((dy) => (
          <mesh key={dy} position={[0, 0.72 + dy, 1.99]} material={mats.chrome}><boxGeometry args={[0.85, 0.01, 0.015]} /></mesh>
        ))}
        <mesh position={[0, 0.48, 1.965]} material={mats.trim}><boxGeometry args={[1.2, 0.12, 0.04]} /></mesh>
        <mesh position={[0, 0.34, 1.9]} material={mats.trim}><boxGeometry args={[1.7, 0.04, 0.26]} /></mesh>

        {/* rear: light bar, plate, spoiler wing */}
        <mesh position={[0, 0.9, -1.97]} material={mats.tail}><boxGeometry args={[0.5, 0.04, 0.03]} /></mesh>
        <mesh position={[0, 0.66, -1.975]} material={mats.plate}><boxGeometry args={[0.45, 0.14, 0.03]} /></mesh>
        <mesh position={[0, 1.38, -1.78]} material={mats.trim}><boxGeometry args={[1.5, 0.04, 0.38]} /></mesh>

        {/* wheels: all four spin, front pair also steers */}
        <Wheel side={1} z={WHEEL_Z} mats={mats} tireGeo={geo.tire} spinRef={collect(spinGroups, 0)} pivotRef={collect(steerPivots, 0)} />
        <Wheel side={-1} z={WHEEL_Z} mats={mats} tireGeo={geo.tire} spinRef={collect(spinGroups, 1)} pivotRef={collect(steerPivots, 1)} />
        <Wheel side={1} z={-WHEEL_Z} mats={mats} tireGeo={geo.tire} spinRef={collect(spinGroups, 2)} />
        <Wheel side={-1} z={-WHEEL_Z} mats={mats} tireGeo={geo.tire} spinRef={collect(spinGroups, 3)} />
        </>
        )}
      </group>
      </group>

      {/* exhaust smoke lives outside the car and pose groups so it doesn't move or tilt with the body */}
      <points geometry={smoke.geo} material={smoke.mat} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

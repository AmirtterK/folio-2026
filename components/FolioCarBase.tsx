"use client";

/**
 * FolioCarBase (detailed): a sculpted coupe with a curved, bevelled body, real wheel
 * arches, glossy clearcoat paint, tinted glass, rounded tires, spoked rims,
 * brake discs and calipers, headlights, tail lights, mirrors, spoiler and exhausts.
 *
 * Controls (when `keyboard` is true):
 *   W / ArrowUp      drive forward
 *   S / ArrowDown    reverse
 *   A / ArrowLeft    steer left
 *   D / ArrowRight   steer right
 *   Space            brake
 *
 * Usage (Next.js App Router, R3F v9, three 0.170):
 *
 *   import { Canvas } from "@react-three/fiber";
 *   import { OrbitControls, Environment } from "@react-three/drei";
 *   import FolioCarBase from "@/components/FolioCarBase";
 *
 *   <Canvas camera={{ position: [6, 3.5, 7], fov: 40 }}>
 *     <Environment preset="city" />          // reflections make the paint look glossy
 *     <directionalLight position={[4, 7, 5]} intensity={1.2} />
 *     <FolioCarBase />
 *     <OrbitControls target={[0, 1, 0]} />
 *   </Canvas>
 *
 * To drive it from your own UI (touch buttons, gamepad, zustand store):
 *
 *   const input = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });
 *   <FolioCarBase keyboard={false} input={input} />
 */

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type CarInput = { fwd: number; back: number; left: number; right: number; brake: number };

export type FolioCarBaseProps = {
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
} & Omit<ThreeElements["group"], "ref">;

const KEY_MAP: Record<string, keyof CarInput> = {
  KeyW: "fwd", ArrowUp: "fwd", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", Space: "brake",
};

const WHEEL_R = 0.45;
const WHEEL_X = 0.86;
const WHEEL_Z = 1.2;
const LUGS = 28;
const SPOKE_PAIRS = 5;

/* ---------- geometry helpers ---------- */

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
  return toCreasedNormals(g, 0.7); // smooth curves, keep hard edges
}

function poly(pts: [number, number][]) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
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
      lamp: std("#fff6c9", { emissive: "#ffe9a0", emissiveIntensity: 0.9, roughness: 0.2 }),
      tail: std("#ff2b2b", { emissive: "#ff1a1a", emissiveIntensity: 0.7, roughness: 0.3 }),
      plate: std("#f1efe8", { roughness: 0.5 }),
    };
  }, [color]);
}

type Mats = ReturnType<typeof useMaterials>;

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

/* ---------- car ---------- */

export default function FolioCarBase({
  color = "#ff7a1a",
  keyboard = true,
  input,
  maxSpeed = 14,
  maxSteer = 0.55,
  onSpeed,
  ...groupProps
}: FolioCarBaseProps) {
  const carRef = useRef<THREE.Group>(null);
  const spinGroups = useRef<THREE.Group[]>([]);
  const steerPivots = useRef<THREE.Group[]>([]);
  const keys = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });
  const sim = useRef({ speed: 0, steer: 0, pitch: 0, roll: 0 });

  const mats = useMaterials(color);
  const geo = useMemo(
    () => ({
      body: extrudeSide(bodyShape(), 1.8, 0.1),
      glass: extrudeSide(poly([[0.9, 1.12], [0.4, 1.7], [-0.6, 1.72], [-1.1, 1.15]]), 1.4, 0.05, 4),
      roof: extrudeSide(poly([[0.5, 1.6], [0.38, 1.76], [-0.68, 1.78], [-0.82, 1.6]]), 1.46, 0.07, 4),
      tire: makeTireGeometry(),
      flare: new THREE.TorusGeometry(0.545, 0.035, 10, 40, Math.PI).rotateY(Math.PI / 2),
    }),
    []
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
    const k = input ? input.current : keys.current;

    const throttle = k.fwd - k.back;
    const target = throttle * maxSpeed;
    s.speed += (target - s.speed) * Math.min(1, dt * (throttle ? 2.2 : 1.2));
    if (k.brake) s.speed *= Math.pow(0.02, dt);
    if (Math.abs(s.speed) < 0.02 && !throttle) s.speed = 0;

    s.steer += ((k.left - k.right) * maxSteer - s.steer) * Math.min(1, dt * 9);

    const spin = (s.speed * dt) / WHEEL_R; // rolling without slipping
    for (const w of spinGroups.current) if (w) w.rotation.x += spin;
    for (const p of steerPivots.current) if (p) p.rotation.y = s.steer;

    const accel = (throttle ? target - s.speed : 0) - (k.brake ? s.speed * 0.5 : 0);
    s.pitch += (-accel * 0.004 - s.pitch) * Math.min(1, dt * 6);
    s.roll += (s.steer * s.speed * 0.006 - s.roll) * Math.min(1, dt * 6);

    const car = carRef.current;
    if (car) {
      car.rotation.x = s.pitch;
      car.rotation.z = s.roll;
      car.position.y = 0.02 + Math.abs(Math.sin(state.clock.elapsedTime * 20)) * Math.min(0.02, Math.abs(s.speed) * 0.0015);
    }
    onSpeed?.(s.speed);
  });

  return (
    <group {...groupProps}>
      <group ref={carRef} position={[0, 0.02, 0]}>
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
            <mesh position={[s * 0.905, 0.72, 0.62]} material={mats.trim}><boxGeometry args={[0.012, 0.74, 0.012]} /></mesh>
            <mesh position={[s * 0.905, 0.72, -0.6]} material={mats.trim}><boxGeometry args={[0.012, 0.74, 0.012]} /></mesh>
            <mesh position={[s * 0.915, 0.98, -0.42]} material={mats.chrome}><boxGeometry args={[0.025, 0.04, 0.2]} /></mesh>
            <mesh position={[s * 0.9, 0.38, 0]} material={mats.trim}><boxGeometry args={[0.05, 0.1, 1.15]} /></mesh>
            <mesh position={[s * 0.71, 1.43, -0.2]} material={mats.paint}><boxGeometry args={[0.05, 0.6, 0.1]} /></mesh>
            <mesh position={[s * 0.9, 1.19, 0.64]} material={mats.trim}><boxGeometry args={[0.14, 0.04, 0.05]} /></mesh>
            <mesh position={[s * 0.99, 1.23, 0.62]} material={mats.paint}><boxGeometry args={[0.1, 0.1, 0.19]} /></mesh>

            {/* headlight: chrome ring, lens */}
            <mesh position={[s * 0.62, 0.86, 1.93]} scale={[1, 0.85, 0.55]} material={mats.lamp}>
              <sphereGeometry args={[0.15, 20, 14]} />
            </mesh>
            <mesh position={[s * 0.62, 0.86, 1.93]} material={mats.chrome}>
              <torusGeometry args={[0.15, 0.015, 8, 28]} />
            </mesh>
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
      </group>
    </group>
  );
}

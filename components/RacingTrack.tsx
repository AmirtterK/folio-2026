"use client";

import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CarPose } from "@/components/ToyCarSmoke";

/* ---------- Track layout & coordinates ---------- */

/** Center of the start/finish straight on the asphalt */
export const TRACK_START = {
  x: -11.28,
  z: 6.0,
  y: 0.02,
  yaw: Math.PI, // Facing forward along -z into turn 1
};

/** Entire racing circuit world bounds */
export const TRACK_BOUNDS = {
  minX: -110,
  maxX: 90,
  minZ: -115,
  maxZ: 105,
};

export const flatGround = () => 0.02;

/* ---------- Checkered Start / Finish Line Texture ---------- */

function createCheckeredTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const cols = 16;
  const rows = 4;
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#ffffff" : "#1a181b";
      ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
    }
  }

  // Subtle border lines
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, 3);
  ctx.fillRect(0, canvas.height - 3, canvas.width, 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- Red & White Curbs + Asphalt Road Texture ---------- */

function createTrackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  // 1. Dark asphalt base in the center
  ctx.fillStyle = "#2c282e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Asphalt fine texture speckles
  for (let i = 0; i < 2200; i++) {
    const rx = Math.random() * canvas.width;
    const ry = Math.random() * canvas.height;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(rx, ry, 2, 2);
  }

  // Curb height: 46px on top (V ~ 0) and 46px on bottom (V ~ 1)
  const curbHeight = 46;
  const halfW = canvas.width / 2; // 64px red, 64px white

  // Top curb (V: 0 to ~0.09): Red / White alternating pavement blocks
  ctx.fillStyle = "#d82424"; // Racing Red
  ctx.fillRect(0, 0, halfW, curbHeight);
  ctx.fillStyle = "#f5f5f5"; // Racing White
  ctx.fillRect(halfW, 0, halfW, curbHeight);

  // Top curb inner edge / boundary line
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, curbHeight, canvas.width, 4);

  // Bottom curb (V: ~0.91 to 1.0): Red / White alternating pavement blocks
  ctx.fillStyle = "#d82424";
  ctx.fillRect(0, canvas.height - curbHeight, halfW, curbHeight);
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(halfW, canvas.height - curbHeight, halfW, curbHeight);

  // Bottom curb inner edge / boundary line
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, canvas.height - curbHeight - 4, canvas.width, 4);

  // Outer dark rim lines separating curbs from grass
  ctx.fillStyle = "#181519";
  ctx.fillRect(0, 0, canvas.width, 2);
  ctx.fillRect(0, canvas.height - 2, canvas.width, 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- Racing Track Component ---------- */

type RacingTrackProps = {
  showCurbs?: boolean;
};

export function RacingTrack({ showCurbs = true }: RacingTrackProps) {
  // Load track model from folio-2025
  const scenery = useGLTF("/models/scenery.glb");

  // Track material with red & white curbs on edges and dark asphalt in center
  const trackMaterial = useMemo(() => {
    const tex = createTrackTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.84,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }, []);

  // Plain dark asphalt material when curbs are toggled off
  const plainAsphaltMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2c282e",
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
    []
  );

  // Checkered start line material
  const startLineMaterial = useMemo(() => {
    const tex = createCheckeredTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }, []);

  // Extract and UV-map the road surface mesh (refRoad) from scenery.glb
  const roadMesh = useMemo(() => {
    const original = scenery.scene.getObjectByName("refRoad") as THREE.Mesh | null;
    if (!original) return null;

    const clone = original.clone();
    const geom = original.geometry.clone();
    const pos = geom.attributes.position;
    const numPairs = pos.count / 2;

    // Calculate physical arc length along the track to accurately map the red & white curbs
    const dists: number[] = [0];
    let total = 0;
    for (let k = 1; k < numPairs; k++) {
      const x0 = pos.getX(2 * (k - 1)), z0 = pos.getZ(2 * (k - 1));
      const x1 = pos.getX(2 * (k - 1) + 1), z1 = pos.getZ(2 * (k - 1) + 1);
      const cxPrev = (x0 + x1) / 2, czPrev = (z0 + z1) / 2;

      const x2 = pos.getX(2 * k), z2 = pos.getZ(2 * k);
      const x3 = pos.getX(2 * k + 1), z3 = pos.getZ(2 * k + 1);
      const cxCurr = (x2 + x3) / 2, czCurr = (z2 + z3) / 2;

      total += Math.hypot(cxCurr - cxPrev, czCurr - czPrev);
      dists.push(total);
    }

    // Period of 1 red + 1 white stripe (3.2 units total: 1.6 units red, 1.6 units white)
    const STRIPE_PERIOD = 3.2;
    const uvAttr = geom.attributes.uv;
    for (let k = 0; k < numPairs; k++) {
      const u = dists[k] / STRIPE_PERIOD;
      uvAttr.setXY(2 * k, u, 0.0);
      uvAttr.setXY(2 * k + 1, u, 1.0);
    }
    uvAttr.needsUpdate = true;

    clone.geometry = geom;
    clone.material = showCurbs ? trackMaterial : plainAsphaltMaterial;
    clone.receiveShadow = true;
    clone.castShadow = false;
    // World translation in folio-2025: [-45.327175, 0.02, 35.990040]
    clone.position.set(-45.327175, 0.02, 35.99004);
    return clone;
  }, [scenery, showCurbs, trackMaterial, plainAsphaltMaterial]);

  return (
    <group>
      {/* Surrounding landscape ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#7ea560" roughness={0.92} metalness={0.02} />
      </mesh>

      {/* Outer landscape subtle border/skirt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshStandardMaterial color="#68884f" roughness={1} />
      </mesh>

      {/* The Asphalt Road Ribbon with Flat Red & White Pavement Curbs */}
      {roadMesh && <primitive object={roadMesh} />}

      {/* Checkered Start / Finish Line across the straight (width 10, depth 1.6) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-11.28, 0.024, 0.0]}
        material={startLineMaterial}
        receiveShadow
      >
        <planeGeometry args={[10.0, 1.6]} />
      </mesh>
    </group>
  );
}

// Preload the track GLB asset
useGLTF.preload("/models/scenery.glb");

/* ---------- Top-Down Isometric Camera (Bruno Simon Folio-2025 style) ---------- */

export function FolioTopDownCam({
  pose,
  zoomMultiplier = 1,
}: {
  pose: MutableRefObject<CarPose>;
  zoomMultiplier?: number;
}) {
  const camera = useThree((s) => s.camera);
  const st = useRef({
    ready: false,
    smoothedTarget: new THREE.Vector3(),
    currentRadius: 28,
  });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = pose.current;
    const s = st.current;

    // Center target on car
    const target = new THREE.Vector3(p.x, p.y + 0.3, p.z);
    if (!s.ready) {
      s.smoothedTarget.copy(target);
      s.ready = true;
    } else {
      // Smooth camera translation
      s.smoothedTarget.lerp(target, 1 - Math.exp(-6.5 * dt));
    }

    // Dynamic zoom based on driving speed, matching Bruno Simon's folio
    const baseRadius = 26 * zoomMultiplier;
    const speedZoom = Math.min(12, Math.abs(p.speed) * 0.45);
    const targetRadius = baseRadius + speedZoom;
    s.currentRadius += (targetRadius - s.currentRadius) * (1 - Math.exp(-3.5 * dt));

    // Bruno Simon's exact spherical projection angles:
    // phi = 0.27 * PI (~48.6° from +Y, or ~41.4° pitch above the ground)
    // theta = 0.25 * PI (45° azimuth, corner top-down perspective)
    const phi = Math.PI * 0.27;
    const theta = Math.PI * 0.25;

    const r = s.currentRadius;
    const offsetX = r * Math.sin(phi) * Math.sin(theta);
    const offsetY = r * Math.cos(phi);
    const offsetZ = r * Math.sin(phi) * Math.cos(theta);

    camera.position.set(
      s.smoothedTarget.x + offsetX,
      s.smoothedTarget.y + offsetY,
      s.smoothedTarget.z + offsetZ
    );
    camera.lookAt(s.smoothedTarget);
  });

  return null;
}

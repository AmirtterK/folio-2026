"use client";

import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/ToyCarSmoke";

/* ---------- Monza Circuit Accurate Layout & Coordinates ---------- */

export const TRACK_SCALE = 0.45;
export const TRACK_CENTER_X = 258.0;
export const TRACK_CENTER_Z = 131.0;

/** Starting grid position on Monza Rettifilo Main Straight heading West */
export const TRACK_START = {
  x: 30.15,
  z: 57.15,
  y: 0.02,
  yaw: -Math.PI / 2, // Facing West along -x towards Turn 1 (Variante del Rettifilo)
};

/** Entire Monza circuit driving bounds */
export const TRACK_BOUNDS = {
  minX: -140,
  maxX: 140,
  minZ: -85,
  maxZ: 85,
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

  // Border lines
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

  // Dark asphalt base in the center
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
  ctx.fillStyle = "#d82424"; // Monza Racing Red
  ctx.fillRect(0, 0, halfW, curbHeight);
  ctx.fillStyle = "#f5f5f5"; // Monza White
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

/* ---------- Procedural Monza Geometry Generator ---------- */

export function buildMonzaGeometry() {
  const points = [
    new THREE.Vector3(30.15, 0.02, 57.15),
    new THREE.Vector3(25.12, 0.02, 57.15),
    new THREE.Vector3(20.1, 0.02, 57.15),
    new THREE.Vector3(15.07, 0.02, 57.15),
    new THREE.Vector3(10.04, 0.02, 57.15),
    new THREE.Vector3(5.02, 0.02, 57.15),
    new THREE.Vector3(-0.01, 0.02, 57.15),
    new THREE.Vector3(-5.04, 0.02, 57.15),
    new THREE.Vector3(-10.06, 0.02, 57.15),
    new THREE.Vector3(-15.09, 0.02, 57.15),
    new THREE.Vector3(-20.09, 0.02, 56.7),
    new THREE.Vector3(-25.11, 0.02, 56.7),
    new THREE.Vector3(-29.2, 0.02, 54.39),
    new THREE.Vector3(-33.93, 0.02, 54.06),
    new THREE.Vector3(-38.7, 0.02, 55.62),
    new THREE.Vector3(-43.56, 0.02, 56.93),
    new THREE.Vector3(-48.57, 0.02, 57.15),
    new THREE.Vector3(-53.59, 0.02, 57.15),
    new THREE.Vector3(-58.62, 0.02, 57.12),
    new THREE.Vector3(-63.61, 0.02, 56.63),
    new THREE.Vector3(-68.5, 0.02, 55.46),
    new THREE.Vector3(-73.2, 0.02, 53.69),
    new THREE.Vector3(-77.65, 0.02, 51.36),
    new THREE.Vector3(-81.48, 0.02, 48.12),
    new THREE.Vector3(-84.87, 0.02, 44.41),
    new THREE.Vector3(-87.57, 0.02, 40.19),
    new THREE.Vector3(-89.69, 0.02, 35.63),
    new THREE.Vector3(-91.12, 0.02, 30.82),
    new THREE.Vector3(-92.11, 0.02, 25.89),
    new THREE.Vector3(-93.01, 0.02, 20.95),
    new THREE.Vector3(-93.91, 0.02, 16.01),
    new THREE.Vector3(-94.81, 0.02, 11.06),
    new THREE.Vector3(-95.62, 0.02, 6.1),
    new THREE.Vector3(-96.52, 0.02, 1.16),
    new THREE.Vector3(-97.26, 0.02, -3.81),
    new THREE.Vector3(-97.97, 0.02, -8.78),
    new THREE.Vector3(-100.55, 0.02, -12.86),
    new THREE.Vector3(-103.64, 0.02, -16.52),
    new THREE.Vector3(-105.35, 0.02, -21.25),
    new THREE.Vector3(-107.28, 0.02, -25.89),
    new THREE.Vector3(-109.23, 0.02, -30.52),
    new THREE.Vector3(-111.24, 0.02, -35.12),
    new THREE.Vector3(-113.02, 0.02, -39.83),
    new THREE.Vector3(-114.26, 0.02, -44.68),
    new THREE.Vector3(-114.28, 0.02, -47.21),
    new THREE.Vector3(-113.77, 0.02, -42.24),
    new THREE.Vector3(-113.67, 0.02, -41.87),
    new THREE.Vector3(-114.29, 0.02, -46.83),
    new THREE.Vector3(-111.92, 0.02, -51.01),
    new THREE.Vector3(-107.34, 0.02, -53.02),
    new THREE.Vector3(-102.44, 0.02, -54.12),
    new THREE.Vector3(-97.52, 0.02, -55.15),
    new THREE.Vector3(-92.57, 0.02, -56.0),
    new THREE.Vector3(-87.61, 0.02, -56.81),
    new THREE.Vector3(-82.63, 0.02, -57.09),
    new THREE.Vector3(-78.84, 0.02, -54.02),
    new THREE.Vector3(-76.02, 0.02, -49.86),
    new THREE.Vector3(-73.26, 0.02, -45.65),
    new THREE.Vector3(-70.47, 0.02, -41.47),
    new THREE.Vector3(-67.65, 0.02, -37.31),
    new THREE.Vector3(-64.83, 0.02, -33.16),
    new THREE.Vector3(-61.8, 0.02, -29.15),
    new THREE.Vector3(-58.65, 0.02, -25.23),
    new THREE.Vector3(-55.28, 0.02, -21.51),
    new THREE.Vector3(-51.83, 0.02, -17.85),
    new THREE.Vector3(-48.27, 0.02, -14.3),
    new THREE.Vector3(-44.62, 0.02, -10.85),
    new THREE.Vector3(-41.05, 0.02, -7.3),
    new THREE.Vector3(-37.47, 0.02, -3.78),
    new THREE.Vector3(-33.83, 0.02, -0.31),
    new THREE.Vector3(-30.17, 0.02, 3.13),
    new THREE.Vector3(-26.55, 0.02, 6.62),
    new THREE.Vector3(-22.86, 0.02, 10.02),
    new THREE.Vector3(-19.28, 0.02, 13.55),
    new THREE.Vector3(-15.6, 0.02, 16.97),
    new THREE.Vector3(-11.88, 0.02, 20.35),
    new THREE.Vector3(-7.27, 0.02, 22.04),
    new THREE.Vector3(-2.27, 0.02, 21.72),
    new THREE.Vector3(2.56, 0.02, 22.96),
    new THREE.Vector3(6.44, 0.02, 26.13),
    new THREE.Vector3(11.14, 0.02, 27.61),
    new THREE.Vector3(16.15, 0.02, 27.9),
    new THREE.Vector3(21.17, 0.02, 27.9),
    new THREE.Vector3(26.2, 0.02, 27.9),
    new THREE.Vector3(31.19, 0.02, 28.35),
    new THREE.Vector3(36.22, 0.02, 28.35),
    new THREE.Vector3(41.25, 0.02, 28.35),
    new THREE.Vector3(46.28, 0.02, 28.35),
    new THREE.Vector3(51.3, 0.02, 28.35),
    new THREE.Vector3(56.3, 0.02, 28.78),
    new THREE.Vector3(61.32, 0.02, 28.8),
    new THREE.Vector3(66.35, 0.02, 28.8),
    new THREE.Vector3(71.38, 0.02, 28.8),
    new THREE.Vector3(76.41, 0.02, 28.8),
    new THREE.Vector3(81.43, 0.02, 28.8),
    new THREE.Vector3(86.43, 0.02, 29.23),
    new THREE.Vector3(91.45, 0.02, 29.25),
    new THREE.Vector3(96.48, 0.02, 29.25),
    new THREE.Vector3(101.51, 0.02, 29.25),
    new THREE.Vector3(106.49, 0.02, 29.88),
    new THREE.Vector3(111.0, 0.02, 31.84),
    new THREE.Vector3(113.92, 0.02, 35.88),
    new THREE.Vector3(114.01, 0.02, 40.84),
    new THREE.Vector3(112.14, 0.02, 45.49),
    new THREE.Vector3(109.19, 0.02, 49.51),
    new THREE.Vector3(104.87, 0.02, 52.06),
    new THREE.Vector3(100.14, 0.02, 53.77),
    new THREE.Vector3(95.26, 0.02, 54.93),
    new THREE.Vector3(90.31, 0.02, 55.79),
    new THREE.Vector3(85.33, 0.02, 56.46),
    new THREE.Vector3(80.35, 0.02, 57.12),
    new THREE.Vector3(75.36, 0.02, 57.6),
    new THREE.Vector3(70.33, 0.02, 57.6),
    new THREE.Vector3(65.31, 0.02, 57.6),
    new THREE.Vector3(60.31, 0.02, 57.16),
    new THREE.Vector3(55.28, 0.02, 57.15),
    new THREE.Vector3(50.26, 0.02, 57.15),
    new THREE.Vector3(45.23, 0.02, 57.15),
    new THREE.Vector3(40.2, 0.02, 57.15),
    new THREE.Vector3(35.18, 0.02, 57.15)
  ];

  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
  const SAMPLES = 480;
  const TRACK_WIDTH = 8.5;
  const STRIPE_PERIOD = 3.2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pts = curve.getSpacedPoints(SAMPLES);
  let cumulativeDist = 0;

  for (let i = 0; i <= SAMPLES; i++) {
    const p = pts[i % SAMPLES];
    const nextP = pts[(i + 1) % SAMPLES];
    const prevP = pts[(i - 1 + SAMPLES) % SAMPLES];
    const tangent = nextP.clone().sub(prevP).normalize();
    const norm = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) {
      const prevPt = pts[(i - 1) % SAMPLES];
      cumulativeDist += p.distanceTo(prevPt);
    }

    const u = cumulativeDist / STRIPE_PERIOD;
    const halfW = TRACK_WIDTH / 2;

    // Left vertex (v = 0)
    positions.push(p.x + norm.x * halfW, p.y, p.z + norm.z * halfW);
    normals.push(0, 1, 0);
    uvs.push(u, 0.0);

    // Right vertex (v = 1)
    positions.push(p.x - norm.x * halfW, p.y, p.z - norm.z * halfW);
    normals.push(0, 1, 0);
    uvs.push(u, 1.0);

    if (i < SAMPLES) {
      const row1 = i * 2;
      const row2 = (i + 1) * 2;
      indices.push(row1, row1 + 1, row2);
      indices.push(row1 + 1, row2 + 1, row2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

/* ---------- Racing Track Component (Monza Circuit) ---------- */

type RacingTrackProps = {
  showCurbs?: boolean;
};

export function RacingTrack({ showCurbs = true }: RacingTrackProps) {
  const trackMaterial = useMemo(() => {
    const tex = createTrackTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.84,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }, []);

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

  const monzaGeometry = useMemo(() => buildMonzaGeometry(), []);

  return (
    <group>
      {/* Monza landscape ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[800, 800]} />
        <meshStandardMaterial color="#6e9a4f" roughness={0.92} metalness={0.02} />
      </mesh>

      {/* Outer landscape border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color="#557a3e" roughness={1} />
      </mesh>

      {/* Monza Asphalt Road Ribbon with Flat Red & White Pavement Curbs */}
      <mesh
        geometry={monzaGeometry}
        material={showCurbs ? trackMaterial : plainAsphaltMaterial}
        receiveShadow
      />

      {/* Checkered Start / Finish Line on the Rettifilo Straight */}
      <mesh
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        position={[30.15, 0.024, 57.15]}
        material={startLineMaterial}
        receiveShadow
      >
        <planeGeometry args={[8.5, 2.0]} />
      </mesh>

      {/* Starting Grid Line markings along the straight heading West */}
      {[21, 12, 3, -6].map((x, idx) => (
        <mesh
          key={x}
          rotation={[-Math.PI / 2, 0, Math.PI / 2]}
          position={[x, 0.023, 57.15 + (idx % 2 === 0 ? 2.2 : -2.2)]}
        >
          <planeGeometry args={[2.5, 0.25]} />
          <meshBasicMaterial color="#ffffff" opacity={0.7} transparent />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- Top-Down Camera (Directly aligned with Track & Minimap) ---------- */

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
    currentRadius: 32,
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
      s.smoothedTarget.lerp(target, 1 - Math.exp(-6.5 * dt));
    }

    // Dynamic zoom based on driving speed
    const baseRadius = 28 * zoomMultiplier;
    const speedZoom = Math.min(14, Math.abs(p.speed) * 0.45);
    const targetRadius = baseRadius + speedZoom;
    s.currentRadius += (targetRadius - s.currentRadius) * (1 - Math.exp(-3.5 * dt));

    // High-angle top-down view aligned straight with the track axes (theta = 0)
    const phi = Math.PI * 0.16; // ~28.8° tilt from overhead for rich 3D depth
    const theta = 0;            // Aligns screen-X (horizontal) and screen-Z (vertical) 1:1 with Minimap

    const r = s.currentRadius;
    const offsetX = 0;
    const offsetY = r * Math.cos(phi);
    const offsetZ = r * Math.sin(phi);

    camera.position.set(
      s.smoothedTarget.x + offsetX,
      s.smoothedTarget.y + offsetY,
      s.smoothedTarget.z + offsetZ
    );
    camera.lookAt(s.smoothedTarget);
  });

  return null;
}

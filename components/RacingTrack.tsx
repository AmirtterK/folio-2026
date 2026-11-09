"use client";

import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/ToyCarSmoke";

/* ---------- Monza Circuit Layout & Coordinates ---------- */

/** Starting grid position on Monza's Rettifilo Tribune (Main Straight heading West) */
export const TRACK_START = {
  x: 13.08,
  z: 41.27,
  y: 0.02,
  yaw: -Math.PI / 2, // Facing West along -x towards Turn 1 (Variante del Rettifilo)
};

/** Entire Monza circuit driving bounds */
export const TRACK_BOUNDS = {
  minX: -105,
  maxX: 105,
  minZ: -60,
  maxZ: 60,
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
  // Key control waypoints representing the iconic Autodromo Nazionale Monza corners (500gt3.com layout)
  const points = [
    // 1. Rettifilo Tribune (Main Straight heading West)
    new THREE.Vector3(13.08, 0.02, 41.27),
    new THREE.Vector3(4.90, 0.02, 41.27),
    new THREE.Vector3(-4.09, 0.02, 41.27),
    new THREE.Vector3(-13.08, 0.02, 41.27),

    // 2. Turns 1 & 2: Variante del Rettifilo Chicane
    new THREE.Vector3(-21.25, 0.02, 38.82),
    new THREE.Vector3(-30.24, 0.02, 41.27),
    new THREE.Vector3(-39.23, 0.02, 42.09),
    new THREE.Vector3(-48.22, 0.02, 41.27),

    // 3. Turn 3: Curva Grande (Biassono) sweeping up towards North-West
    new THREE.Vector3(-56.39, 0.02, 38.00),
    new THREE.Vector3(-64.57, 0.02, 29.83),
    new THREE.Vector3(-67.84, 0.02, 20.84),
    new THREE.Vector3(-69.47, 0.02, 12.67),
    new THREE.Vector3(-71.11, 0.02, 3.68),
    new THREE.Vector3(-71.92, 0.02, -5.31),

    // 4. Turns 4 & 5: Variante della Roggia Chicane
    new THREE.Vector3(-76.83, 0.02, -13.49),
    new THREE.Vector3(-80.91, 0.02, -21.66),
    new THREE.Vector3(-85.00, 0.02, -30.65),

    // 5. Turns 6 & 7: Curve di Lesmo 1 & 2 (Top Left)
    new THREE.Vector3(-81.73, 0.02, -38.82),
    new THREE.Vector3(-72.74, 0.02, -40.46),
    new THREE.Vector3(-64.57, 0.02, -42.09),

    // 6. Curva del Serraglio & Straight towards Ascari (sloping down-right)
    new THREE.Vector3(-57.21, 0.02, -37.19),
    new THREE.Vector3(-51.49, 0.02, -29.01),
    new THREE.Vector3(-46.59, 0.02, -20.84),
    new THREE.Vector3(-39.23, 0.02, -13.49),
    new THREE.Vector3(-33.51, 0.02, -8.58),
    new THREE.Vector3(-25.34, 0.02, -0.41),

    // 7. Turns 8, 9 & 10: Variante Ascari
    new THREE.Vector3(-17.98, 0.02, 6.13),
    new THREE.Vector3(-12.26, 0.02, 11.03),
    new THREE.Vector3(-3.27, 0.02, 15.94),
    new THREE.Vector3(4.90, 0.02, 18.39),

    // 8. Rettifilo Posteriore (Back Straight heading East)
    new THREE.Vector3(13.89, 0.02, 20.02),
    new THREE.Vector3(22.88, 0.02, 20.02),
    new THREE.Vector3(31.88, 0.02, 20.02),
    new THREE.Vector3(40.05, 0.02, 20.02),
    new THREE.Vector3(49.04, 0.02, 20.02),
    new THREE.Vector3(58.03, 0.02, 20.02),
    new THREE.Vector3(67.02, 0.02, 20.02),
    new THREE.Vector3(75.19, 0.02, 20.02),

    // 9. Turn 11: Curva Parabolica (Alboreto - 180° opening right carousel)
    new THREE.Vector3(84.18, 0.02, 21.66),
    new THREE.Vector3(85.00, 0.02, 30.65),
    new THREE.Vector3(77.64, 0.02, 36.37),
    new THREE.Vector3(68.65, 0.02, 39.64),

    // 10. Main Straight run back to Start / Finish line
    new THREE.Vector3(59.66, 0.02, 40.46),
    new THREE.Vector3(50.67, 0.02, 40.46),
    new THREE.Vector3(42.50, 0.02, 40.46),
    new THREE.Vector3(33.51, 0.02, 40.46),
    new THREE.Vector3(22.88, 0.02, 41.27),
    new THREE.Vector3(13.89, 0.02, 41.27),
  ];

  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
  const SAMPLES = 320;
  const TRACK_WIDTH = 9.5;
  const STRIPE_PERIOD = 3.2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pts = curve.getSpacedPoints(SAMPLES);
  let cumulativeDist = 0;

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = pts[i % SAMPLES];
    const tangent = curve.getTangentAt(t % 1).normalize();
    const norm = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) {
      const prevP = pts[(i - 1) % SAMPLES];
      cumulativeDist += p.distanceTo(prevP);
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
  // Monza track material with red & white curbs
  const trackMaterial = useMemo(() => {
    const tex = createTrackTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.84,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }, []);

  // Plain asphalt material when curbs are toggled off
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

  // Procedural Monza circuit ribbon mesh
  const monzaGeometry = useMemo(() => buildMonzaGeometry(), []);

  return (
    <group>
      {/* Monza Royal Park landscape ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[700, 700]} />
        <meshStandardMaterial color="#6e9a4f" roughness={0.92} metalness={0.02} />
      </mesh>

      {/* Outer landscape border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[1400, 1400]} />
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
        position={[13.08, 0.024, 41.27]}
        material={startLineMaterial}
        receiveShadow
      >
        <planeGeometry args={[9.5, 1.8]} />
      </mesh>

      {/* Starting Grid Line markings along the straight heading West */}
      {[5, -3, -11, -19].map((x, idx) => (
        <mesh
          key={x}
          rotation={[-Math.PI / 2, 0, Math.PI / 2]}
          position={[x, 0.023, 41.27 + (idx % 2 === 0 ? 2.2 : -2.2)]}
        >
          <planeGeometry args={[2.5, 0.25]} />
          <meshBasicMaterial color="#ffffff" opacity={0.7} transparent />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- Top-Down Isometric Camera (Bruno Simon Folio style) ---------- */

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
      s.smoothedTarget.lerp(target, 1 - Math.exp(-6.5 * dt));
    }

    // Dynamic zoom based on driving speed
    const baseRadius = 26 * zoomMultiplier;
    const speedZoom = Math.min(12, Math.abs(p.speed) * 0.45);
    const targetRadius = baseRadius + speedZoom;
    s.currentRadius += (targetRadius - s.currentRadius) * (1 - Math.exp(-3.5 * dt));

    // Bruno Simon's spherical angles
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

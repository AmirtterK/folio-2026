"use client";

import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/ToyCarSmoke";

/* ---------- Monza Circuit Layout & Coordinates ---------- */

/** Starting grid position on Monza's Rettifilo Tribune (Main Straight heading West) */
export const TRACK_START = {
  x: 25.0,
  z: 45.0,
  y: 0.02,
  yaw: -Math.PI / 2, // Facing West along -x towards Turn 1 (Variante del Rettifilo)
};

/** Entire Monza circuit driving bounds */
export const TRACK_BOUNDS = {
  minX: -110,
  maxX: 125,
  minZ: -90,
  maxZ: 70,
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
    // 1. Main Rettifilo Straight (heading West / -X)
    new THREE.Vector3(25.0, 0.02, 45.0), // START / FINISH LINE
    new THREE.Vector3(10.0, 0.02, 45.0),
    new THREE.Vector3(-5.0, 0.02, 45.0),
    new THREE.Vector3(-18.0, 0.02, 45.0),

    // 2. Variante del Rettifilo (Turns 1 & 2: Right-Left Chicane)
    new THREE.Vector3(-26.0, 0.02, 43.0),
    new THREE.Vector3(-30.0, 0.02, 34.0), // Turn 1 apex (right flick)
    new THREE.Vector3(-36.0, 0.02, 35.0),
    new THREE.Vector3(-40.0, 0.02, 45.0), // Turn 2 exit (left flick back to main line)

    // 3. Curva Grande / Biassono (Turn 3: Sweeping fast right)
    new THREE.Vector3(-50.0, 0.02, 45.0),
    new THREE.Vector3(-62.0, 0.02, 42.0),
    new THREE.Vector3(-72.0, 0.02, 32.0),
    new THREE.Vector3(-78.0, 0.02, 18.0),
    new THREE.Vector3(-80.0, 0.02, 2.0),
    new THREE.Vector3(-80.0, 0.02, -14.0),

    // 4. Straight to Roggia
    new THREE.Vector3(-80.0, 0.02, -28.0),

    // 5. Variante della Roggia (Turns 4 & 5: Left-Right Chicane)
    new THREE.Vector3(-82.0, 0.02, -36.0),
    new THREE.Vector3(-89.0, 0.02, -42.0), // Turn 4 apex (left flick)
    new THREE.Vector3(-85.0, 0.02, -48.0),
    new THREE.Vector3(-78.0, 0.02, -52.0), // Turn 5 exit (right flick)

    // 6. Curva di Lesmo 1 (Turn 6: 90 deg right)
    new THREE.Vector3(-76.0, 0.02, -60.0),
    new THREE.Vector3(-70.0, 0.02, -66.0),
    new THREE.Vector3(-60.0, 0.02, -68.0),

    // 7. Curva di Lesmo 2 (Turn 7: tight right into back run)
    new THREE.Vector3(-48.0, 0.02, -68.0),
    new THREE.Vector3(-38.0, 0.02, -63.0),
    new THREE.Vector3(-32.0, 0.02, -54.0),

    // 8. Curva del Serraglio & Diagonal run towards Ascari
    new THREE.Vector3(-24.0, 0.02, -42.0),
    new THREE.Vector3(-14.0, 0.02, -28.0),
    new THREE.Vector3(-4.0, 0.02, -14.0),
    new THREE.Vector3(6.0, 0.02, 0.0),

    // 9. Variante Ascari (Turns 8, 9 & 10: fast Left-Right-Left chicane)
    new THREE.Vector3(13.0, 0.02, 8.0),
    new THREE.Vector3(18.0, 0.02, 2.0), // Turn 8 (left entry)
    new THREE.Vector3(25.0, 0.02, 5.0), // Turn 9 (right flick)
    new THREE.Vector3(31.0, 0.02, 12.0), // Turn 10 (left exit onto back straight)

    // 10. Rettifilo Posteriore (Back Straight heading East / +X)
    new THREE.Vector3(42.0, 0.02, 13.0),
    new THREE.Vector3(56.0, 0.02, 13.0),
    new THREE.Vector3(70.0, 0.02, 13.0),
    new THREE.Vector3(82.0, 0.02, 13.0),

    // 11. Curva Parabolica / Alboreto (Turn 11: 180 deg opening right carousel)
    new THREE.Vector3(93.0, 0.02, 16.0),
    new THREE.Vector3(101.0, 0.02, 23.0),
    new THREE.Vector3(103.0, 0.02, 32.0),
    new THREE.Vector3(98.0, 0.02, 40.0),
    new THREE.Vector3(88.0, 0.02, 44.0),
    new THREE.Vector3(75.0, 0.02, 45.0),

    // 12. Main Straight run back to Start Line
    new THREE.Vector3(60.0, 0.02, 45.0),
    new THREE.Vector3(42.0, 0.02, 45.0),
  ];

  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
  const SAMPLES = 360;
  const TRACK_WIDTH = 9.0;
  const STRIPE_PERIOD = 3.2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pts = curve.getSpacedPoints(SAMPLES);
  let cumulativeDist = 0;

  for (let i = 0; i <= SAMPLES; i++) {
    const p = pts[i % SAMPLES];
    // Central difference tangent from spaced points ensures seamless continuity
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
        position={[25.0, 0.024, 45.0]}
        material={startLineMaterial}
        receiveShadow
      >
        <planeGeometry args={[9.0, 1.8]} />
      </mesh>

      {/* Starting Grid Line markings along the straight heading West */}
      {[17, 9, 1, -7].map((x, idx) => (
        <mesh
          key={x}
          rotation={[-Math.PI / 2, 0, Math.PI / 2]}
          position={[x, 0.023, 45.0 + (idx % 2 === 0 ? 2.2 : -2.2)]}
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

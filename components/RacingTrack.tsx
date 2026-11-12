"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/FolioCar";

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

  // Dark asphalt base in the center with realistic race surface grain
  ctx.fillStyle = "#363238";
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

export function buildMonzaGeometry(width = 8.5, period = 3.2, yOffset = 0) {
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
  const TRACK_WIDTH = width;
  const STRIPE_PERIOD = period;

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
    positions.push(p.x + norm.x * halfW, p.y + yOffset, p.z + norm.z * halfW);
    normals.push(0, 1, 0);
    uvs.push(u, 0.0);

    // Right vertex (v = 1)
    positions.push(p.x - norm.x * halfW, p.y + yOffset, p.z - norm.z * halfW);
    normals.push(0, 1, 0);
    uvs.push(u, 1.0);

    if (i < SAMPLES) {
      const row1 = i * 2;
      const row2 = (i + 1) * 2;
      // Counter-clockwise winding so front face normal points UP (+Y)
      indices.push(row1, row2, row1 + 1);
      indices.push(row1 + 1, row2, row2 + 1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/* ---------- Procedural ground: grass, dry earth patches, gravel runoff ---------- */

/** Tileable value noise (wraps at the edges so the texture repeats without seams). */
export function periodicNoise(size: number, cells: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const x1 = (x0 + 1) % cells;
      const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
      const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function createGroundTexture(): THREE.CanvasTexture {
  const size = 1024;
  const n1 = periodicNoise(size, 4, 11);
  const n2 = periodicNoise(size, 12, 23);
  const n3 = periodicNoise(size, 40, 37);
  const n4 = periodicNoise(size, 160, 51);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);

  const lo = [40, 70, 30];    // shaded grass
  const hi = [112, 152, 66];  // sunlit grass
  const dry = [138, 122, 68]; // dry earth / hay patches

  for (let i = 0; i < size * size; i++) {
    const big = n1[i] * 0.45 + n2[i] * 0.35 + n3[i] * 0.2;
    const t = Math.min(1, Math.max(0, (big - 0.22) * 1.7));
    const dryAmt = Math.min(0.75, Math.max(0, (n2[i] * 0.55 + n1[i] * 0.45 - 0.6) * 4.5));
    const jitter = (n4[i] - 0.5) * 26;
    for (let c = 0; c < 3; c++) {
      const grass = lo[c] + (hi[c] - lo[c]) * t;
      const v = grass + (dry[c] - grass) * dryAmt + jitter;
      img.data[i * 4 + c] = Math.max(0, Math.min(255, v));
    }
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // grass blades
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const len = 3 + Math.random() * 5;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(150,190,80,0.22)" : "rgba(20,44,16,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(12, 12);
  return tex;
}

function createGravelTexture(): THREE.CanvasTexture {
  const size = 512;
  const n = periodicNoise(size, 16, 77);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 118 + n[i] * 40;
    img.data[i * 4] = v + 12;
    img.data[i * 4 + 1] = v + 2;
    img.data[i * 4 + 2] = v - 22;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 9000; i++) {
    const l = 60 + Math.random() * 150;
    ctx.fillStyle = `rgba(${l + 10},${l},${l - 25},0.55)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/* ---------- Street lamps along the outside of the corners (night only) ---------- */

type Lamp = { x: number; z: number; rot: number };

const LAMP_HEAD = { out: 1.8, y: 5.25 }; // where the light head sits, in the lamp's local space
const LAMP_LIGHTS = 4; // real spotlights in the pool (constant count, so no shader recompiles)
const LAMP_FADE_NEAR = 16; // full strength inside this distance from the car
const LAMP_FADE_FAR = 48; // completely off beyond this distance
const LAMP_INTENSITY = 750;

/**
 * Real light from the street lamps. A small pool of spotlights is moved onto the lamps nearest the car every
 * frame and faded by distance, so the car, track and grass are actually lit (and the paint catches the highlights)
 * without paying for one light per lamp.
 */
function LampLights({ lamps, pose }: { lamps: Lamp[]; pose?: MutableRefObject<CarPose> }) {
  const lights = useRef<(THREE.SpotLight | null)[]>([]);
  const targets = useRef<(THREE.Object3D | null)[]>([]);
  const heads = useMemo(
    () =>
      lamps.map(
        (l) =>
          new THREE.Vector3(
            l.x + LAMP_HEAD.out * Math.cos(l.rot),
            LAMP_HEAD.y,
            l.z - LAMP_HEAD.out * Math.sin(l.rot)
          )
      ),
    [lamps]
  );
  const scratch = useMemo(
    () => ({ idx: new Int16Array(LAMP_LIGHTS), dist: new Float32Array(LAMP_LIGHTS) }),
    []
  );

  useEffect(() => {
    lights.current.forEach((l, i) => {
      const t = targets.current[i];
      if (l && t) l.target = t;
    });
  }, []);

  useFrame(() => {
    const cx = pose ? pose.current.x : 0;
    const cz = pose ? pose.current.z : 0;
    const { idx, dist } = scratch;
    idx.fill(-1);
    dist.fill(Infinity);

    // pick the LAMP_LIGHTS nearest lamps (tiny insertion sort, ~20 lamps)
    for (let i = 0; i < heads.length; i++) {
      const dx = heads[i].x - cx;
      const dz = heads[i].z - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      let slot = LAMP_LIGHTS;
      while (slot > 0 && d < dist[slot - 1]) slot--;
      if (slot >= LAMP_LIGHTS) continue;
      for (let j = LAMP_LIGHTS - 1; j > slot; j--) {
        dist[j] = dist[j - 1];
        idx[j] = idx[j - 1];
      }
      dist[slot] = d;
      idx[slot] = i;
    }

    for (let k = 0; k < LAMP_LIGHTS; k++) {
      const light = lights.current[k];
      const target = targets.current[k];
      if (!light || !target) continue;
      const i = idx[k];
      if (i < 0) {
        light.intensity = 0;
        continue;
      }
      const h = heads[i];
      light.position.copy(h);
      target.position.set(h.x, h.y - 10, h.z); // straight down
      const t = Math.min(1, Math.max(0, (dist[k] - LAMP_FADE_NEAR) / (LAMP_FADE_FAR - LAMP_FADE_NEAR)));
      light.intensity = LAMP_INTENSITY * (1 - t * t * (3 - 2 * t)); // smoothstep fade, so lights never pop
    }
  });

  return (
    <>
      {Array.from({ length: LAMP_LIGHTS }, (_, k) => (
        <group key={k}>
          <spotLight
            ref={(el) => {
              lights.current[k] = el;
            }}
            color="#ffc878"
            intensity={0}
            angle={1.2}
            penumbra={1}
            distance={55}
            decay={2}
          />
          <object3D
            ref={(el) => {
              targets.current[k] = el;
            }}
          />
        </group>
      ))}
    </>
  );
}

function TrackLamps({
  geometry,
  pose,
}: {
  geometry: THREE.BufferGeometry;
  pose?: MutableRefObject<CarPose>;
}) {
  const glow = useMemo(() => createGlowTexture(), []);
  const mats = useMemo(
    () => ({
      pole: new THREE.MeshStandardMaterial({ color: "#2a2d3a", roughness: 0.6, metalness: 0.4 }),
      head: new THREE.MeshBasicMaterial({ color: "#fff1c9", toneMapped: false }),
      pool: new THREE.MeshBasicMaterial({
        map: glow,
        color: "#ffc66b",
        transparent: true,
        opacity: 0.22, // just a soft halo now — the real light comes from LampLights
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [glow]
  );

  const lamps = useMemo(() => {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const rows = pos.count / 2;
    const center = (i: number) => {
      const k = ((i % (rows - 1)) + (rows - 1)) % (rows - 1);
      return new THREE.Vector2(
        (pos.getX(k * 2) + pos.getX(k * 2 + 1)) / 2,
        (pos.getZ(k * 2) + pos.getZ(k * 2 + 1)) / 2
      );
    };
    const out: { x: number; z: number; rot: number }[] = [];
    let flip = 1;
    for (let i = 0; i < rows - 1; i += 24) {
      const c = center(i);
      const t0 = center(i + 2).sub(center(i - 2)).normalize();
      const t1 = center(i + 14).sub(center(i + 10)).normalize();
      const turn = t1.clone().sub(t0); // points toward the inside of the corner
      const left = new THREE.Vector2(-t0.y, t0.x);
      const bend = left.dot(turn);
      const side = bend > 0.03 ? -1 : bend < -0.03 ? 1 : (flip = -flip);
      const dir = left.multiplyScalar(side); // from the track outward
      const base = c.clone().addScaledVector(dir, 8.6);
      // local +x of the lamp group points back toward the track
      out.push({ x: base.x, z: base.y, rot: Math.atan2(dir.y, -dir.x) });
    }
    return out;
  }, [geometry]);

  return (
    <group>
      <LampLights lamps={lamps} pose={pose} />
      {lamps.map((l, i) => (
        <group key={i} position={[l.x, 0, l.z]} rotation={[0, l.rot, 0]}>
          <mesh position={[0, 2.7, 0]} material={mats.pole} castShadow>
            <cylinderGeometry args={[0.1, 0.15, 5.4, 8]} />
          </mesh>
          <mesh position={[0.9, 5.35, 0]} material={mats.pole}>
            <boxGeometry args={[1.9, 0.1, 0.1]} />
          </mesh>
          <mesh position={[1.8, 5.27, 0]} material={mats.head}>
            <boxGeometry args={[0.9, 0.12, 0.45]} />
          </mesh>
          <mesh position={[1.8, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.pool} renderOrder={3}>
            <planeGeometry args={[17, 17]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------- Racing Track Component (Monza Circuit) ---------- */

type RacingTrackProps = {
  showCurbs?: boolean;
  /** When true (default), the heightfield `Terrain` paints the realistic grass + gravel without self-intersecting ribbon geometry. */
  withTerrain?: boolean;
  night?: boolean;
  /** Car pose, used to put the real street-lamp lights on the lamps nearest the car. */
  pose?: MutableRefObject<CarPose>;
};

export function RacingTrack({ showCurbs = true, night = false, withTerrain = true, pose }: RacingTrackProps) {
  const groundMaterial = useMemo(
    () => (withTerrain ? undefined : new THREE.MeshStandardMaterial({ map: createGroundTexture(), roughness: 0.96, metalness: 0 })),
    [withTerrain]
  );

  const trackMaterial = useMemo(() => {
    const tex = createTrackTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.78,
      metalness: 0.08,
      side: THREE.FrontSide,
    });
  }, []);

  const plainAsphaltMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#343036",
        roughness: 0.82,
        metalness: 0.06,
        side: THREE.FrontSide,
      }),
    []
  );

  const startLineMaterial = useMemo(() => {
    const tex = createCheckeredTexture();
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.75,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }, []);

  const monzaGeometry = useMemo(() => buildMonzaGeometry(), []);

  return (
    <group>
      {/* Fallback flat ground only if Terrain heightfield is disabled */}
      {!withTerrain && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={groundMaterial} receiveShadow>
          <planeGeometry args={[800, 800]} />
        </mesh>
      )}

      {night && <TrackLamps geometry={monzaGeometry} pose={pose} />}

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
  mobile = false,
  inspecting = false,
  inspectTarget,
  inspectCamPos,
  freeCam = false,
}: {
  pose: MutableRefObject<CarPose>;
  zoomMultiplier?: number;
  /** Touch devices: pull the chase camera back a little so the car and scene do not feel oversized. */
  mobile?: boolean;
  inspecting?: boolean;
  inspectTarget?: THREE.Vector3;
  inspectCamPos?: THREE.Vector3;
  /** When true this component stops touching the camera (OrbitControls owns it). On exit it blends back. */
  freeCam?: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const st = useRef({
    ready: false,
    smoothedTarget: new THREE.Vector3(),
    currentRadius: 32,
    inspectAlpha: 0,
    wasFree: false,
    returning: false,
    returnT: 0,
    fromPos: new THREE.Vector3(),
    fromQuat: new THREE.Quaternion(),
    tmpPos: new THREE.Vector3(),
    tmpMat: new THREE.Matrix4(),
    tmpQuat: new THREE.Quaternion(),
  });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = pose.current;
    const s = st.current;

    // Smoothly blend inspection alpha (0 = normal driving, 1 = inspecting trophy)
    const targetAlpha = inspecting && inspectTarget && inspectCamPos ? 1 : 0;
    s.inspectAlpha += (targetAlpha - s.inspectAlpha) * (1 - Math.exp(-4.5 * dt));

    // Car drive target
    const carTarget = new THREE.Vector3(p.x, p.y + 0.3, p.z);
    const goalTarget = s.inspectAlpha > 0.5 && inspectTarget ? inspectTarget : carTarget;

    if (!s.ready) {
      s.smoothedTarget.copy(goalTarget);
      s.ready = true;
    } else {
      s.smoothedTarget.lerp(goalTarget, 1 - Math.exp(-6.5 * dt));
    }

    // Dynamic zoom based on driving speed. On phones the scene is physically small, so pull the
    // camera back 22–30% to keep the car and track from feeling oversized.
    const viewAspect = size.width / Math.max(1, size.height);
    const mobileZoom = mobile ? (viewAspect < 1 ? 1.8 : 1.6) : 1;
    const baseRadius = 28 * zoomMultiplier * mobileZoom;
    const speedZoom = Math.min(14, Math.abs(p.speed) * 0.45);
    const targetRadius = baseRadius + speedZoom;
    s.currentRadius += (targetRadius - s.currentRadius) * (1 - Math.exp(-3.5 * dt));

    // Free cam: leave the camera alone (OrbitControls drives it). We keep tracking the car above
    // so the return trip lands on wherever the car is when free cam is closed.
    if (freeCam) {
      s.wasFree = true;
      s.returning = false;
      return;
    }

    // Just left free cam: remember where the free camera was so we can glide back from it.
    if (s.wasFree) {
      s.wasFree = false;
      s.returning = true;
      s.returnT = 0;
      s.fromPos.copy(camera.position);
      s.fromQuat.copy(camera.quaternion);
    }

    // High-angle top-down view aligned straight with the track axes (theta = 0)
    const phi = Math.PI * 0.16; // ~28.8° tilt from overhead for rich 3D depth
    const r = s.currentRadius;
    const offsetX = 0;
    const offsetY = r * Math.cos(phi);
    const offsetZ = r * Math.sin(phi);

    const driveCamPos = new THREE.Vector3(
      s.smoothedTarget.x + offsetX,
      s.smoothedTarget.y + offsetY,
      s.smoothedTarget.z + offsetZ
    );

    if (s.returning) {
      // Ease from the free-cam pose back to the regular chase view (~0.8s)
      s.returnT = Math.min(1, s.returnT + dt / 0.8);
      const e = 1 - Math.pow(1 - s.returnT, 3);
      camera.position.lerpVectors(s.fromPos, driveCamPos, e);
      s.tmpMat.lookAt(driveCamPos, s.smoothedTarget, camera.up);
      s.tmpQuat.setFromRotationMatrix(s.tmpMat);
      camera.quaternion.slerpQuaternions(s.fromQuat, s.tmpQuat, e);
      if (s.returnT >= 1) s.returning = false;
      return;
    }

    if (s.inspectAlpha > 0.001 && inspectCamPos && inspectTarget) {
      // On narrow screens the holographic text column is wider than the viewport, so back the
      // inspection camera off along the same sight line until the whole landmark + text fits.
      const pull = mobile && viewAspect < 1 ? 1.0 : (viewAspect < 1 ? Math.min(2.2, 1 / viewAspect) : 1);
      s.tmpPos.copy(inspectCamPos).sub(inspectTarget).multiplyScalar(pull).add(inspectTarget);
      // Smoothly blend position between driving overhead and inspection angle
      camera.position.lerpVectors(driveCamPos, s.tmpPos, s.inspectAlpha);
    } else {
      // 100% rigid lock to smoothed target when driving — zero lag, zero wobble, zero dizziness
      camera.position.set(driveCamPos.x, driveCamPos.y, driveCamPos.z);
    }

    camera.lookAt(s.smoothedTarget);
  });

  return null;
}

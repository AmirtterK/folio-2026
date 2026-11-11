"use client";

/**
 * Terrain: a real heightfield around the Monza track.
 *
 *  - flat near the asphalt, rolling hills + big backdrop hills further out
 *  - kicker ramps with landing hills, a row of whoops (washboard) and a few extra mounds, see `ToyCarSmoke`
 *    for the jump / landing physics that drives over them
 *  - gravel runoff, dirt rim, grass, rock on steep slopes are painted into ONE world texture (no ribbon
 *    geometry, so nothing can fold in tight corners and nothing can z-fight)
 *  - a material mask texture drives close-up detail in the shader: tiled pebble gravel with a bump effect,
 *    grain on the grass and dirt
 *  - a folio-style grass blade field follows the car, bends away from it and leaves tracks behind it
 *  - instanced pines, bushes, boulders and loose gravel stones (the car collides with trees and boulders)
 *
 * `groundHeight`, `groundGrip` and `groundCollide` are what the car uses to drive on it.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildMonzaGeometry, periodicNoise } from "@/components/RacingTrack";
import type { CarPose } from "@/components/ToyCarSmoke";
import { TrackBarriers, BARRIER_POINTS } from "@/components/TrackBarriers";
import { JumpArrowSigns, JUMP_SIGNS } from "@/components/JumpArrowSigns";
import { TROPHY_POS, KNIGHT_POS, NEURAL_POS } from "@/components/landmarkConfig";

/* ---------- world layout ---------- */

const X0 = -200, X1 = 200, Z0 = -160, Z1 = 160;
const RES = 1.25;                                   // height grid resolution (also the mesh resolution)
const NX = Math.round((X1 - X0) / RES);
const NZ = Math.round((Z1 - Z0) / RES);
const GW = NX + 1;                                  // height grid size in samples
const GH = NZ + 1;
const DRES = 2.5;                                   // distance-to-track grid resolution
const DNX = Math.round((X1 - X0) / DRES);
const DNZ = Math.round((Z1 - Z0) / DRES);
const BASE = 0.02;                                  // asphalt height
const GRAVEL_EDGE = 7.4;                            // distance from the centerline where gravel ends
const MW = 2000, MH = 1600;                         // world color / mask texture size

type Bump = { x: number; z: number; h: number; s: number };
type Ramp = { x: number; z: number; a: number; len: number; w: number; h: number };
type Ridge = { x: number; z: number; a: number; len: number; w: number; h: number };
type Whoops = { x: number; z: number; a: number; n: number; period: number; w: number; h: number };

const BUMPS: Bump[] = [
  // Backdrop outer scenic mountains and hills
  { x: 0, z: -140, h: 18, s: 30 },
  { x: -60, z: -110, h: 13, s: 22 },
  { x: 130, z: -110, h: 15, s: 24 },
  { x: -40, z: 130, h: 14, s: 26 },
  { x: 80, z: 125, h: 15, s: 26 },
  { x: -145, z: 75, h: 12, s: 20 },
  { x: -160, z: -25, h: 14, s: 24 },
  { x: 175, z: 0, h: 16, s: 26 },
  // Playful rolling hills around the circuit
  { x: 50, z: -35, h: 8, s: 16 },
  { x: 95, z: -45, h: 7, s: 13 },
  { x: 15, z: -62, h: 6, s: 14 },
  { x: -65, z: 10, h: 5.5, s: 13 },
  { x: 0, z: 85, h: 6, s: 15 },
  { x: 110, z: 80, h: 7, s: 15 },
  // Infield mounds and tabletops
  { x: 15, z: 12, h: 4.8, s: 12 },
  { x: -25, z: -12, h: 5.2, s: 14 },
  { x: 55, z: 80, h: 5.5, s: 12 },
  { x: -30, z: -66, h: 6, s: 12 },
  { x: 128, z: 8, h: 5.5, s: 11 },
  { x: -112, z: 28, h: 4.5, s: 9 },
];

/** Kickers: slope up along direction (cos a, sin a) in (x, z), then a steep drop for big airtime. */
const RAMPS: Ramp[] = [
  // Infield Mega Kicker: launches across the wide grass towards West
  { x: 35, z: 38, a: -Math.PI * 0.9, len: 14, w: 10, h: 3.4 },
  // Curva Grande Infield Stunt Ramp: launches inwards
  { x: -55, z: 25, a: -Math.PI * 0.25, len: 14, w: 10, h: 3.2 },
  // Serraglio Outfield Kicker: launches north towards the Lesmo hill
  { x: -40, z: -38, a: Math.PI * 0.5, len: 15, w: 10, h: 3.6 },
  // Parabolica Outfield Big Ramp: launches towards the back straight
  { x: 95, z: 12, a: Math.PI * 0.85, len: 15, w: 10, h: 3.5 },
  // Infield Center Kicker
  { x: 45, z: 6, a: 0, len: 14, w: 10, h: 3.0 },
];

/** Landing hills: a short steep nose, then a gentle slope down for smooth touchdown. */
const RIDGES: Ridge[] = [
  { x: 12, z: 38, a: -Math.PI * 0.9, len: 18, w: 12, h: 2.6 },
  { x: -38, z: 18, a: -Math.PI * 0.25, len: 18, w: 12, h: 2.4 },
  { x: 65, z: 6, a: 0, len: 18, w: 12, h: 2.4 },
];

/** Washboard: a rhythmic row of rounded humps that bounce and skip cars at high speed. */
const WHOOPS: Whoops[] = [
  { x: -12, z: -6, a: 0, n: 6, period: 6.5, w: 14, h: 0.7 },
];

/** Places that stay free of trees and boulders (jump corridors and trophy plaza). */
const CLEAR: { x: number; z: number; r: number }[] = [
  ...RAMPS.map((r) => ({ x: r.x + Math.cos(r.a) * (r.len * 0.5 + 7), z: r.z + Math.sin(r.a) * (r.len * 0.5 + 7), r: r.len * 0.5 + 14 })),
  ...RIDGES.map((r) => ({ x: r.x + Math.cos(r.a) * r.len * 0.5, z: r.z + Math.sin(r.a) * r.len * 0.5, r: r.len * 0.5 + 8 })),
  ...WHOOPS.map((r) => ({ x: r.x + Math.cos(r.a) * r.n * r.period * 0.5, z: r.z + Math.sin(r.a) * r.n * r.period * 0.5, r: r.n * r.period * 0.5 + 8 })),
  { x: TROPHY_POS.x, z: TROPHY_POS.z, r: 14 },
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function bilinear(grid: Float32Array, nx: number, nz: number, fx: number, fz: number) {
  fx = clamp(fx, 0, nx - 1e-3);
  fz = clamp(fz, 0, nz - 1e-3);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const w = nx + 1;
  const a = grid[z0 * w + x0], b = grid[z0 * w + x0 + 1];
  const c = grid[(z0 + 1) * w + x0], d = grid[(z0 + 1) * w + x0 + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- textures ---------- */

/** Grain for grass and dirt, tiled in the shader at two scales. */
function createDetailTexture(): THREE.CanvasTexture {
  const size = 512;
  const n1 = periodicNoise(size, 48, 3);
  const n2 = periodicNoise(size, 128, 4);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.52 + (n1[i] - 0.5) * 0.35 + (n2[i] - 0.5) * 0.4;
    const b = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
    const len = 3 + Math.random() * 6;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Tileable heap of rounded stones, shaded light on top / dark in the cracks. Used for gravel color AND bump. */
function createPebbleTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3e3e3e";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry(4242);
  const stone = (x: number, y: number, rx: number, ry: number, rot: number, tone: number) => {
    const hi = Math.round(Math.min(255, tone + 55));
    const mid = Math.round(tone);
    const lo = Math.round(tone * 0.4);
    const reach = Math.max(rx, ry);
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        const px = x + ox, py = y + oy;
        if (px < -reach || px > size + reach || py < -reach || py > size + reach) continue;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(-rx * 0.3, -rx * 0.3, rx * 0.1, 0, 0, rx);
        g.addColorStop(0, `rgb(${hi},${hi},${hi})`);
        g.addColorStop(0.65, `rgb(${mid},${mid},${mid})`);
        g.addColorStop(1, `rgb(${lo},${lo},${lo})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };
  for (let i = 0; i < 1500; i++) {
    const rx = 3.5 + rnd() * rnd() * 9;
    stone(rnd() * size, rnd() * size, rx, rx * (0.65 + rnd() * 0.3), rnd() * Math.PI, 95 + rnd() * 115);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- terrain data ---------- */

type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; color: THREE.Color };

type TerrainData = {
  geometry: THREE.BufferGeometry;
  macro: THREE.CanvasTexture;
  mask: THREE.DataTexture;
  heightTex: THREE.DataTexture;
  detail: THREE.CanvasTexture;
  pebble: THREE.CanvasTexture;
  height: (x: number, z: number) => number;
  grip: (x: number, z: number) => number;
  collide: (x: number, z: number, r: number) => [number, number] | null;
  trees: Item[];
  bushes: Item[];
  rocks: Item[];
  pebbles: Item[];
};

let cache: TerrainData | null = null;

function buildTerrain(): TerrainData {
  /* centerline of the track, taken from the road geometry */
  const road = buildMonzaGeometry();
  const rp = road.attributes.position as THREE.BufferAttribute;
  const rows = rp.count / 2 - 1;
  const cx: number[] = [], cz: number[] = [];
  for (let i = 0; i < rows; i++) {
    cx.push((rp.getX(i * 2) + rp.getX(i * 2 + 1)) / 2);
    cz.push((rp.getZ(i * 2) + rp.getZ(i * 2 + 1)) / 2);
  }
  road.dispose();

  /* distance to the centerline on a coarse grid */
  const dGrid = new Float32Array((DNX + 1) * (DNZ + 1));
  for (let gz = 0; gz <= DNZ; gz++) {
    for (let gx = 0; gx <= DNX; gx++) {
      const px = X0 + gx * DRES, pz = Z0 + gz * DRES;
      let best = 1e12;
      for (let i = 0; i < rows; i++) {
        const j = (i + 1) % rows;
        const ax = cx[i], az = cz[i];
        const bx = cx[j] - ax, bz = cz[j] - az;
        const len2 = bx * bx + bz * bz || 1;
        const t = clamp(((px - ax) * bx + (pz - az) * bz) / len2, 0, 1);
        const dx = px - (ax + bx * t), dz = pz - (az + bz * t);
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      dGrid[gz * (DNX + 1) + gx] = Math.sqrt(best);
    }
  }
  const distAt = (x: number, z: number) => bilinear(dGrid, DNX, DNZ, (x - X0) / DRES, (z - Z0) / DRES);

  /* hand-made features (ramps, landing hills, whoops), faded out near the road */
  const alongRidge = (t: number) => (t < 0.25 ? smooth(0, 0.25, t) : 1 - smooth(0.25, 1, t));
  const featureHeight = (x: number, z: number, d: number) => {
    const m = smooth(6, 11, d);
    if (m <= 0) return 0;
    let ramp = 0;
    for (const r of RAMPS) {
      const dx = x - r.x, dz = z - r.z;
      const dirx = Math.cos(r.a), dirz = Math.sin(r.a);
      const u = dx * dirx + dz * dirz;
      const v = -dx * dirz + dz * dirx;
      if (u < 0 || u > r.len + 2.4) continue;
      const rise = u <= r.len ? Math.pow(u / r.len, 1.4) : 1 - smooth(0, 1, (u - r.len) / 2.4);
      const edge = 1 - smooth(r.w * 0.35, r.w * 0.5, Math.abs(v));
      ramp = Math.max(ramp, r.h * rise * edge);
    }
    let ridge = 0;
    for (const r of RIDGES) {
      const dx = x - r.x, dz = z - r.z;
      const dirx = Math.cos(r.a), dirz = Math.sin(r.a);
      const u = dx * dirx + dz * dirz;
      const v = -dx * dirz + dz * dirx;
      if (u < 0 || u > r.len) continue;
      const edge = 1 - smooth(r.w * 0.3, r.w * 0.5, Math.abs(v));
      ridge = Math.max(ridge, r.h * alongRidge(u / r.len) * edge);
    }
    let whoops = 0;
    for (const wh of WHOOPS) {
      const dx = x - wh.x, dz = z - wh.z;
      const dirx = Math.cos(wh.a), dirz = Math.sin(wh.a);
      const u = dx * dirx + dz * dirz;
      const v = -dx * dirz + dz * dirx;
      const total = wh.n * wh.period;
      if (u < 0 || u > total) continue;
      const hump = 0.5 - 0.5 * Math.cos((u / wh.period) * Math.PI * 2);
      const env = smooth(0, wh.period * 0.8, u) * (1 - smooth(total - wh.period * 0.8, total, u));
      const edge = 1 - smooth(wh.w * 0.35, wh.w * 0.5, Math.abs(v));
      whoops += wh.h * hump * env * edge;
    }
    return (ramp + ridge + whoops) * m;
  };

  /* hill height (without the base offset) */
  const hillHeight = (x: number, z: number) => {
    const d = distAt(x, z);
    let h = 0;
    const mask = smooth(11, 24, d);
    if (mask > 0) {
      let n = 0;
      for (const b of BUMPS) {
        const dx = x - b.x, dz = z - b.z;
        n += b.h * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
      }
      n += 1.3 * Math.sin(x * 0.05 + 1.3) * Math.cos(z * 0.065) + 0.7 * Math.sin(x * 0.13 + z * 0.11);
      h += mask * Math.max(n, -0.6);
    }
    return h + featureHeight(x, z, d);
  };

  /* height + slope grids */
  const hGrid = new Float32Array(GW * GH);
  for (let gz = 0; gz < GH; gz++)
    for (let gx = 0; gx < GW; gx++) hGrid[gz * GW + gx] = hillHeight(X0 + gx * RES, Z0 + gz * RES);
  const sGrid = new Float32Array(GW * GH);
  for (let gz = 0; gz < GH; gz++) {
    for (let gx = 0; gx < GW; gx++) {
      const l = hGrid[gz * GW + Math.max(0, gx - 1)], r = hGrid[gz * GW + Math.min(NX, gx + 1)];
      const u = hGrid[Math.max(0, gz - 1) * GW + gx], dn = hGrid[Math.min(NZ, gz + 1) * GW + gx];
      sGrid[gz * GW + gx] = Math.hypot((r - l) / (2 * RES), (dn - u) / (2 * RES));
    }
  }
  const hAt = (x: number, z: number) => bilinear(hGrid, NX, NZ, (x - X0) / RES, (z - Z0) / RES);
  const sAt = (x: number, z: number) => bilinear(sGrid, NX, NZ, (x - X0) / RES, (z - Z0) / RES);
  /** What the car drives on: the hills, plus the asphalt's 2 cm on the road itself. */
  const height = (x: number, z: number) => hAt(x, z) + BASE * (1 - smooth(4.3, 5.0, distAt(x, z)));

  /* mesh */
  const pos = new Float32Array(GW * GH * 3);
  const uv = new Float32Array(GW * GH * 2);
  for (let gz = 0; gz < GH; gz++) {
    for (let gx = 0; gx < GW; gx++) {
      const i = gz * GW + gx;
      pos[i * 3] = X0 + gx * RES;
      pos[i * 3 + 1] = hGrid[i];
      pos[i * 3 + 2] = Z0 + gz * RES;
      uv[i * 2] = gx / NX;
      uv[i * 2 + 1] = 1 - gz / NZ;
    }
  }
  const idx = new Uint32Array(NX * NZ * 6);
  let k = 0;
  for (let gz = 0; gz < NZ; gz++) {
    for (let gx = 0; gx < NX; gx++) {
      const a = gz * GW + gx, b = a + 1, c = a + GW, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeVertexNormals();

  /* height as a texture, so the grass blades can sit on the ground (half float, linear filtering) */
  const hHalf = new Uint16Array(GW * GH);
  for (let i = 0; i < hHalf.length; i++) hHalf[i] = THREE.DataUtils.toHalfFloat(hGrid[i]);
  const heightTex = new THREE.DataTexture(hHalf, GW, GH, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;

  /* world color map + material mask (r gravel, g grass, b dirt, a rock) */
  const canvas = document.createElement("canvas");
  canvas.width = MW;
  canvas.height = MH;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(MW, MH);
  const maskData = new Uint8Array(MW * MH * 4);
  const nEdge = periodicNoise(512, 32, 5);
  const nMid = periodicNoise(512, 24, 13);
  const nBig = periodicNoise(512, 4, 9);
  const nFine = periodicNoise(512, 96, 21);
  const grassLow = [58, 98, 40], grassHigh = [128, 172, 60], dry = [168, 146, 82];
  const dirt = [132, 94, 60], rock = [126, 120, 114];
  const gravLo = [182, 168, 138], gravHi = [222, 210, 182];
  const out = img.data;
  const col = [0, 0, 0];
  const mix = (a: number[], b: number[], t: number) => {
    col[0] = a[0] + (b[0] - a[0]) * t;
    col[1] = a[1] + (b[1] - a[1]) * t;
    col[2] = a[2] + (b[2] - a[2]) * t;
  };
  /** where the gravel ends here, with the same wobble that gets painted (so grip matches what you see) */
  const edgeAt = (x: number, z: number) => {
    const px = clamp(Math.floor(((x - X0) / (X1 - X0)) * MW), 0, MW - 1);
    const py = clamp(Math.floor(((z - Z0) / (Z1 - Z0)) * MH), 0, MH - 1);
    return GRAVEL_EDGE + (nEdge[(py & 511) * 512 + (px & 511)] - 0.5) * 3.2;
  };
  for (let py = 0; py < MH; py++) {
    const wz = Z0 + ((py + 0.5) / MH) * (Z1 - Z0);
    for (let px = 0; px < MW; px++) {
      const wx = X0 + ((px + 0.5) / MW) * (X1 - X0);
      const d = distAt(wx, wz);
      const h = hAt(wx, wz);
      const slope = sAt(wx, wz);
      const eN = nEdge[(py & 511) * 512 + (px & 511)];
      const mN = nMid[((py >> 1) & 511) * 512 + ((px >> 1) & 511)];
      const bN = nBig[((py >> 2) & 511) * 512 + ((px >> 2) & 511)];
      const fN = nFine[(py & 511) * 512 + (px & 511)];

      // grass with large scale variation, dry patches, lighter hill tops
      const big = bN * 0.5 + mN * 0.5;
      mix(grassLow, grassHigh, clamp((big - 0.2) * 1.7, 0, 1));
      const g0 = col[0], g1 = col[1], g2 = col[2];
      const dryAmt = clamp((bN * 0.6 + mN * 0.4 - 0.58) * 4.5, 0, 0.7);
      let r = g0 + (dry[0] - g0) * dryAmt, g = g1 + (dry[1] - g1) * dryAmt, b = g2 + (dry[2] - g2) * dryAmt;
      const lift = 0.92 + clamp(h / 12, 0, 0.3);
      r *= lift; g *= lift; b *= lift;

      // dirt on mid slopes, rock on steep ones
      const dirtAmt = smooth(0.28, 0.5, slope) * 0.85;
      r += (dirt[0] - r) * dirtAmt; g += (dirt[1] - g) * dirtAmt; b += (dirt[2] - b) * dirtAmt;
      const rockAmt = smooth(0.5, 0.85, slope + (fN - 0.5) * 0.2);
      r += (rock[0] - r) * rockAmt; g += (rock[1] - g) * rockAmt; b += (rock[2] - b) * rockAmt;

      // worn dirt rim just past the gravel, then the gravel runoff itself
      const edge = GRAVEL_EDGE + (eN - 0.5) * 3.2;
      const rim = smooth(edge - 0.1, edge + 0.5, d) * (1 - smooth(edge + 0.9, edge + 2.4, d));
      r += (dirt[0] - r) * rim * 0.75; g += (dirt[1] - g) * rim * 0.75; b += (dirt[2] - b) * rim * 0.75;
      const gw = 1 - smooth(edge - 0.3, edge + 0.3, d);
      if (gw > 0) {
        mix(gravLo, gravHi, clamp(mN * 0.6 + fN * 0.6 - 0.2, 0, 1));
        r += (col[0] - r) * gw; g += (col[1] - g) * gw; b += (col[2] - b) * gw;
      }

      const o = (py * MW + px) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;

      // mask rows are stored bottom-up so the texture lines up with the (flipped) canvas texture
      const dirtW = clamp(Math.max(dirtAmt, rim * 0.75), 0, 1);
      const grassW = clamp((1 - gw) * (1 - rockAmt) * (1 - dirtW * 0.7), 0, 1);
      const mo = ((MH - 1 - py) * MW + px) * 4;
      maskData[mo] = gw * 255;
      maskData[mo + 1] = grassW * 255;
      maskData[mo + 2] = dirtW * 255;
      maskData[mo + 3] = rockAmt * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const macro = new THREE.CanvasTexture(canvas);
  macro.colorSpace = THREE.SRGBColorSpace;
  macro.anisotropy = 8;

  const mask = new THREE.DataTexture(maskData, MW, MH, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.magFilter = THREE.LinearFilter;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.generateMipmaps = true;
  mask.anisotropy = 4;
  mask.needsUpdate = true;

  const detail = createDetailTexture();
  const pebble = createPebbleTexture();

  /* trees, bushes and rocks (kept away from the track and the jump corridors, thicker on hills) */
  const rnd = mulberry(1234);
  const trees: Item[] = [], bushes: Item[] = [], rocks: Item[] = [], pebbles: Item[] = [];
  const solids: { x: number; z: number; r: number }[] = [];
  const nearClear = (x: number, z: number) => CLEAR.some((c) => (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < c.r * c.r);
  const okSpot = (x: number, z: number, minD: number) =>
    distAt(x, z) > minD && sAt(x, z) < 0.65 && featureHeight(x, z, 99) < 0.05 && !nearClear(x, z);
  for (let tries = 0; tries < 9000 && trees.length < 520; tries++) {
    const x = X0 + 8 + rnd() * (X1 - X0 - 16), z = Z0 + 8 + rnd() * (Z1 - Z0 - 16);
    const cluster = nBig[((Math.floor((z - Z0) * 2) >> 0) & 511) * 512 + ((Math.floor((x - X0) * 2)) & 511)];
    if (rnd() > 0.2 + cluster * 0.9 || !okSpot(x, z, 16)) continue;
    const s = 0.8 + rnd() * 0.9;
    trees.push({ x, y: hAt(x, z), z, sx: s, sy: s * (0.9 + rnd() * 0.5), sz: s, ry: rnd() * 6.28, color: new THREE.Color().setHSL(0.28 + rnd() * 0.07, 0.45, 0.2 + rnd() * 0.1) });
    solids.push({ x, z, r: 0.95 * s });
  }
  for (let tries = 0; tries < 6000 && bushes.length < 220; tries++) {
    const x = X0 + 8 + rnd() * (X1 - X0 - 16), z = Z0 + 8 + rnd() * (Z1 - Z0 - 16);
    if (!okSpot(x, z, 12)) continue;
    const s = 0.7 + rnd() * 0.9;
    bushes.push({ x, y: hAt(x, z) + 0.2 * s, z, sx: s * 1.2, sy: s * 0.8, sz: s * 1.2, ry: rnd() * 6.28, color: new THREE.Color().setHSL(0.24 + rnd() * 0.1, 0.4, 0.22 + rnd() * 0.1) });
    solids.push({ x, z, r: 0.85 * s });
  }
  for (let tries = 0; tries < 6000 && rocks.length < 150; tries++) {
    const x = X0 + 8 + rnd() * (X1 - X0 - 16), z = Z0 + 8 + rnd() * (Z1 - Z0 - 16);
    if (!okSpot(x, z, 11)) continue;
    const s = 0.7 + rnd() * rnd() * 2.6;
    rocks.push({ x, y: hAt(x, z) + 0.15 * s, z, sx: s * (0.9 + rnd() * 0.6), sy: s * (0.6 + rnd() * 0.5), sz: s * (0.9 + rnd() * 0.6), ry: rnd() * 6.28, color: new THREE.Color().setHSL(0.08, 0.06, 0.32 + rnd() * 0.2) });
    solids.push({ x, z, r: 1.25 * s });
  }

  /* perimeter crash barriers (keep cars safe inside the Monza circuit area)
     NOTE: We compute collision points directly from BARRIER_POINTS here instead of
     calling getBarrierSegments() because that function calls groundHeight() which
     calls getTerrain() which would re-enter buildTerrain() → infinite recursion. */
  const barrierCurve = new THREE.CatmullRomCurve3(BARRIER_POINTS, true, "centripetal", 0.5);
  const barrierPts = barrierCurve.getSpacedPoints(200);
  barrierPts.forEach((p) => {
    solids.push({ x: p.x, z: p.z, r: 1.6 });
  });

  /* jump arrow signs */
  JUMP_SIGNS.forEach((s) => {
    solids.push({ x: s.x, z: s.z, r: 1.2 });
  });

  /* golden achievement trophy pedestal landmark */
  solids.push({ x: TROPHY_POS.x, z: TROPHY_POS.z, r: 1.05 });

  /* holographic chess knight landmark */
  solids.push({ x: KNIGHT_POS.x, z: KNIGHT_POS.z, r: 0.95 });

  /* holographic neural network landmark */
  solids.push({ x: NEURAL_POS.x, z: NEURAL_POS.z, r: 1.05 });

  /* loose stones lying in the gravel next to the asphalt */
  for (let tries = 0; tries < 8000 && pebbles.length < 1500; tries++) {
    const i = Math.floor(rnd() * rows);
    const j = (i + 1) % rows;
    let tx = cx[j] - cx[i], tz = cz[j] - cz[i];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const along = rnd() * tl;
    const off = (rnd() < 0.5 ? -1 : 1) * (4.6 + rnd() * 2.8);
    const x = cx[i] + tx * along - tz * off;
    const z = cz[i] + tz * along + tx * off;
    const d = distAt(x, z);
    if (d < 4.6 || d > edgeAt(x, z) - 0.2) continue;
    const s = 0.045 + rnd() * rnd() * 0.15;
    const tone = 0.34 + rnd() * 0.3;
    pebbles.push({ x, y: hAt(x, z) + s * 0.25, z, sx: s * (0.9 + rnd() * 0.5), sy: s * 0.6, sz: s * (0.9 + rnd() * 0.5), ry: rnd() * 6.28, color: new THREE.Color().setHSL(0.09, 0.14, tone) });
  }

  /* spatial hash for the solids */
  const CELL = 6;
  const hash = new Map<string, number[]>();
  const key = (cxi: number, czi: number) => `${cxi}:${czi}`;
  solids.forEach((o, i) => {
    const minCX = Math.floor((o.x - o.r) / CELL);
    const maxCX = Math.floor((o.x + o.r) / CELL);
    const minCZ = Math.floor((o.z - o.r) / CELL);
    const maxCZ = Math.floor((o.z + o.r) / CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const kk = key(cx, cz);
        const list = hash.get(kk);
        if (list) list.push(i); else hash.set(kk, [i]);
      }
    }
  });
  const collide = (x: number, z: number, r: number): [number, number] | null => {
    const cxi = Math.floor(x / CELL), czi = Math.floor(z / CELL);
    const list = hash.get(key(cxi, czi));
    if (!list) return null;
    let px = 0, pz = 0, hit = false;
    for (const id of list) {
      const o = solids[id];
      const dx = x - o.x, dz = z - o.z;
      const min = r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        const pen = min - d;
        px += (dx / d) * pen;
        pz += (dz / d) * pen;
        hit = true;
      }
    }
    return hit ? [px, pz] : null;
  };

  /* grip: asphalt, slippery gravel, a bit draggy grass, loose dirt on steep slopes */
  const grip = (x: number, z: number) => {
    const d = distAt(x, z);
    let g = lerp(1, 0.5, smooth(4.2, 4.9, d));
    const e = edgeAt(x, z);
    g = lerp(g, 0.8, smooth(e - 0.5, e + 0.7, d));
    return g * (1 - 0.25 * smooth(0.3, 0.6, sAt(x, z)));
  };

  return { geometry, macro, mask, heightTex, detail, pebble, height, grip, collide, trees, bushes, rocks, pebbles };
}

export function getTerrain(): TerrainData {
  if (!cache) cache = buildTerrain();
  return cache;
}

export const groundHeight = (x: number, z: number) => getTerrain().height(x, z);
export const groundGrip = (x: number, z: number) => getTerrain().grip(x, z);
export const groundCollide = (x: number, z: number, r: number) => getTerrain().collide(x, z, r);

export const TERRAIN_BOUNDS = {
  minX: -175,
  maxX: 175,
  minZ: -140,
  maxZ: 140,
};

/* ---------- grass blades (folio style: a field of tiny triangles that follows the car) ---------- */

const GRASS_G = 100;        // blades per side (10,000 blades: lush yet high performance)
const GRASS_SIZE = 54;      // world size of the window the blades loop inside (matches top-down cam viewport)
const TRAIL_N = 32;         // flattened grass left behind the car

function GrassField({ data, pose }: { data: TerrainData; pose?: MutableRefObject<CarPose> }) {
  const built = useMemo(() => {
    const n = GRASS_G * GRASS_G;
    const geometry = new THREE.InstancedBufferGeometry();
    // one blade = one triangle, tip first. Wide at the base, pointing up.
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, 0, -1, 0, 0, 1, 0, 0], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const aBase = new Float32Array(n * 2);
    const aRand = new Float32Array(n * 3);
    const rnd = mulberry(99);
    for (let i = 0; i < GRASS_G; i++) {
      for (let j = 0; j < GRASS_G; j++) {
        const k = i * GRASS_G + j;
        aBase[k * 2] = ((i + rnd()) / GRASS_G - 0.5) * GRASS_SIZE;
        aBase[k * 2 + 1] = ((j + rnd()) / GRASS_G - 0.5) * GRASS_SIZE;
        aRand[k * 3] = rnd();
        aRand[k * 3 + 1] = rnd();
        aRand[k * 3 + 2] = rnd();
      }
    }
    geometry.setAttribute("aBase", new THREE.InstancedBufferAttribute(aBase, 2));
    geometry.setAttribute("aRand", new THREE.InstancedBufferAttribute(aRand, 3));
    geometry.instanceCount = n;

    const uniforms = {
      uCenter: { value: new THREE.Vector2() },
      uCar: { value: new THREE.Vector2(1e5, 1e5) },
      uTime: { value: 0 },
      uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(1e5, 1e5)) },
      uHeightTex: { value: data.heightTex },
      uMask: { value: data.mask },
      uMacro: { value: data.macro },
    };

    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `#include <common>
          attribute vec2 aBase;
          attribute vec3 aRand;
          uniform vec2 uCenter;
          uniform vec2 uCar;
          uniform float uTime;
          uniform vec2 uTrail[${TRAIL_N}];
          uniform sampler2D uHeightTex;
          uniform sampler2D uMask;
          uniform sampler2D uMacro;
          varying vec3 vBladeCol;`
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          const float G_SIZE = ${GRASS_SIZE.toFixed(1)};
          const float G_HALF = ${(GRASS_SIZE / 2).toFixed(1)};
          // blades are pinned to the world and wrap around the car, so nothing swims while you drive
          vec2 loopP = mod(aBase - uCenter + G_HALF, G_SIZE) - G_HALF;
          vec2 wp = loopP + uCenter;
          float dist = length(loopP);

          vec2 huv = vec2(((wp.x - (${X0.toFixed(1)})) / ${RES.toFixed(3)} + 0.5) / ${GW.toFixed(1)}, ((wp.y - (${Z0.toFixed(1)})) / ${RES.toFixed(3)} + 0.5) / ${GH.toFixed(1)});
          float gy = texture2D(uHeightTex, huv).r;
          vec2 muv = vec2((wp.x - (${X0.toFixed(1)})) / ${(X1 - X0).toFixed(1)}, 1.0 - (wp.y - (${Z0.toFixed(1)})) / ${(Z1 - Z0).toFixed(1)});
          float grass = smoothstep(0.35, 0.8, texture2D(uMask, muv).g);
          vec3 ground = texture2D(uMacro, muv).rgb;

          // pressed down by the car and by the tracks it left
          float press = 1.0 - smoothstep(0.7, 1.9, distance(wp, uCar));
          for (int i = 0; i < ${TRAIL_N}; i++) {
            press = max(press, (1.0 - smoothstep(0.35, 0.95, distance(wp, uTrail[i]))) * 0.85);
          }

          float fade = 1.0 - smoothstep(G_HALF * 0.62, G_HALF * 0.95, dist);
          float clump = 0.75 + 0.5 * sin(wp.x * 0.21) * sin(wp.y * 0.17);
          float bh = 0.48 * (0.55 + 0.9 * aRand.x) * clump * grass * fade * (1.0 - 0.8 * press);
          float bw = 0.12 * (0.7 + 0.6 * aRand.y) * grass * fade;

          // the blade turns to face the camera, then leans a little and sways in the wind
          vec2 toCam = cameraPosition.xz - wp;
          float ang = atan(toCam.x, toCam.y);
          float cr = cos(ang), sr = sin(ang);
          float tip = position.y;
          vec3 local = vec3(position.x * bw, tip * bh, 0.0);
          vec3 rotated = vec3(local.x * cr, local.y, -local.x * sr);
          float lean = aRand.z * 6.2831;
          vec2 wind = vec2(sin(uTime * 1.7 + wp.x * 0.37 + wp.y * 0.21), cos(uTime * 1.3 + wp.y * 0.33 - wp.x * 0.12)) * 0.12 * bh;
          vec2 awayDir = normalize(wp - uCar + vec2(0.0001));
          vec2 sway = vec2(cos(lean), sin(lean)) * 0.2 * bh + wind + awayDir * press * 0.3 * bh;
          rotated.xz += sway * tip * tip;
          vec3 transformed = vec3(wp.x, gy - 0.02, wp.y) + rotated;

          float shade = mix(0.5, 1.2, tip) * (0.85 + 0.3 * aRand.y);
          vBladeCol = ground * shade * mix(vec3(1.0), vec3(1.08, 1.1, 0.8), tip * 0.6) * (1.0 - 0.25 * press);
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBladeCol;")
        .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vBladeCol;")
        // every blade is lit like the ground under it: straight up, whichever side we see
        .replace(
          "#include <normal_fragment_begin>",
          "#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);"
        );
    };
    material.customProgramCacheKey = () => "grass-blades";
    return { geometry, material, uniforms };
  }, [data]);

  const last = useRef(new THREE.Vector2(1e5, 1e5));
  const head = useRef(0);

  useFrame((state) => {
    const u = built.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    const p = pose?.current;
    if (!p) return;
    u.uCenter.value.set(p.x, p.z);
    u.uCar.value.set(p.x, p.z);
    if (Math.hypot(p.x - last.current.x, p.z - last.current.y) > 0.45) {
      u.uTrail.value[head.current].set(p.x, p.z);
      head.current = (head.current + 1) % TRAIL_N;
      last.current.set(p.x, p.z);
    }
  });

  return <mesh geometry={built.geometry} material={built.material} frustumCulled={false} receiveShadow />;
}

/* ---------- rendering ---------- */

/** The instances near the car are re-picked only after the car has moved this far (world units). */
const CULL_STEP = 4;

/**
 * Instanced scenery that only draws what is within `radius` of the car (everything when radius is Infinity,
 * e.g. in free cam). Every item's matrix and colour is baked once; each time the car has moved CULL_STEP the
 * nearby ones are copied to the front of the instance buffer and `count` is set, so far trees cost nothing
 * in the main pass or the shadow pass.
 */
function Instances({
  geometry,
  material,
  items,
  cast = true,
  pose,
  radius = Infinity,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Item[];
  cast?: boolean;
  pose?: MutableRefObject<CarPose>;
  radius?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const last = useRef({ x: 0, z: 0, r: -1 });

  const baked = useMemo(() => {
    const mats = new Float32Array(items.length * 16);
    const cols = new Float32Array(items.length * 3);
    const d = new THREE.Object3D();
    items.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(0, it.ry, 0);
      d.scale.set(it.sx, it.sy, it.sz);
      d.updateMatrix();
      d.matrix.toArray(mats, i * 16);
      cols[i * 3] = it.color.r;
      cols[i * 3 + 1] = it.color.g;
      cols[i * 3 + 2] = it.color.b;
    });
    return { mats, cols };
  }, [items]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
    last.current.r = -1; // force a fresh pick on the next frame
  }, [items, baked]);

  useFrame(() => {
    const m = ref.current;
    if (!m || !m.instanceColor) return;
    const p = pose?.current;
    const cx = p ? p.x : 0;
    const cz = p ? p.z : 0;
    const l = last.current;
    if (l.r === radius && Math.hypot(cx - l.x, cz - l.z) < CULL_STEP) return;
    l.x = cx;
    l.z = cz;
    l.r = radius;

    const mArr = m.instanceMatrix.array as Float32Array;
    const cArr = m.instanceColor.array as Float32Array;
    const reach = radius + CULL_STEP; // margin so nothing pops in between two picks
    const reach2 = reach * reach;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const dx = items[i].x - cx;
      const dz = items[i].z - cz;
      if (dx * dx + dz * dz > reach2) continue;
      mArr.set(baked.mats.subarray(i * 16, i * 16 + 16), n * 16);
      cArr.set(baked.cols.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={cast} receiveShadow frustumCulled={false} />;
}

let cachedSlabsTex: THREE.Texture | null = null;
function getSlabsTexture(): THREE.Texture {
  if (!cachedSlabsTex && typeof window !== "undefined") {
    // Use an isolated LoadingManager so we never interfere with React or DefaultLoadingManager
    const loader = new THREE.TextureLoader(new THREE.LoadingManager());
    cachedSlabsTex = loader.load("/textures/slabs.png");
    cachedSlabsTex.wrapS = cachedSlabsTex.wrapT = THREE.RepeatWrapping;
    cachedSlabsTex.colorSpace = THREE.SRGBColorSpace;
  }
  return cachedSlabsTex!;
}

export function Terrain({ pose, radius = Infinity }: { pose?: MutableRefObject<CarPose>; radius?: number }) {
  const data = useMemo(() => getTerrain(), []);

  const slabsTex = useMemo(() => getSlabsTexture(), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ map: data.macro, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = { value: data.mask };
      shader.uniforms.uDetail = { value: data.detail };
      shader.uniforms.uPebble = { value: data.pebble };
      shader.uniforms.uSlabs = { value: slabsTex };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWXZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vWXZ = position.xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `#include <common>
          uniform sampler2D uMask;
          uniform sampler2D uDetail;
          uniform sampler2D uPebble;
          uniform sampler2D uSlabs;
          varying vec2 vWXZ;
          // same idea as three's bump mapping, but the height comes from the shader
          vec3 gPerturb(vec3 sp, vec3 sn, vec2 dh, float fd) {
            vec3 sx = normalize(dFdx(sp));
            vec3 sy = normalize(dFdy(sp));
            vec3 r1 = cross(sy, sn);
            vec3 r2 = cross(sn, sx);
            float det = dot(sx, r1) * fd;
            vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
            return normalize(abs(det) * sn - grad);
          }`
        )
        .replace(
          "#include <map_fragment>",
          /* glsl */ `#include <map_fragment>
          vec4 gMask = texture2D(uMask, vMapUv);
          float gGrain = texture2D(uDetail, vWXZ * 0.071).r * 0.55 + texture2D(uDetail, vWXZ * 0.29 + 0.37).r * 0.45;
          float gP1 = texture2D(uPebble, vWXZ * 0.33).r;
          float gPeb = gP1 * 0.6 + texture2D(uPebble, vWXZ * 0.97 + 0.21).r * 0.4;
          float gSlab = texture2D(uSlabs, vWXZ * 0.16).r;

          // folio-2025 style slabs and pebbles
          vec3 slabTone = mix(vec3(0.68, 0.48, 0.38), vec3(1.0, 0.82, 0.56), gSlab);
          float slabMix = gMask.r * 0.55 + gMask.b * 0.35;
          diffuseColor.rgb = mix(diffuseColor.rgb, slabTone * diffuseColor.rgb * 1.3, slabMix);

          // gravel gets stones & slabs, grass gets fine grain
          diffuseColor.rgb *= clamp(mix(gGrain * 1.85, 0.32 + (gPeb * 0.7 + gSlab * 0.5) * 1.25, gMask.r), 0.28, 1.65);
          float gHeight = mix(gGrain * 0.12 + gMask.a * gP1 * 0.25, gPeb * 0.5 + gSlab * 0.18, gMask.r);`
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `#include <normal_fragment_maps>
          float gFade = 1.0 - smoothstep(30.0, 75.0, length(vViewPosition));
          // at a low, grazing view (the trophy close-up) the stone bump aliases and shimmers, so fade it out there
          gFade *= smoothstep(0.12, 0.45, abs(dot(normalize(vViewPosition), normal)));
          if (gFade > 0.02) {
            normal = gPerturb(-vViewPosition, normal, vec2(dFdx(gHeight), dFdy(gHeight)) * (1.4 * gFade), faceDirection);
          }`
        );
    };
    mat.customProgramCacheKey = () => "terrain-detail-v5";
    return mat;
  }, [data, slabsTex]);

  const geo = useMemo(() => {
    const flat = (g: THREE.BufferGeometry) => { g.deleteAttribute("uv"); return g; };
    const cone1 = flat(new THREE.ConeGeometry(1.5, 3.4, 7).translate(0, 2.2, 0));
    const cone2 = flat(new THREE.ConeGeometry(1.15, 2.8, 7).translate(0, 3.9, 0));
    const cone3 = flat(new THREE.ConeGeometry(0.75, 2.2, 7).translate(0, 5.3, 0));
    const trunk = flat(new THREE.CylinderGeometry(0.2, 0.28, 1.6, 6).translate(0, 0.8, 0));
    return {
      foliage: mergeGeometries([cone1, cone2, cone3])!,
      trunk,
      bush: new THREE.IcosahedronGeometry(1, 1),
      rock: new THREE.IcosahedronGeometry(1, 0),
      stone: new THREE.IcosahedronGeometry(1, 0),
    };
  }, []);
  const mats = useMemo(
    () => ({
      foliage: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }),
      trunk: new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 }),
      bush: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true }),
    }),
    []
  );
  const trunkItems = useMemo(() => data.trees.map((t) => ({ ...t, color: new THREE.Color("#ffffff") })), [data]);

  return (
    <group>
      {/* far ground so the edge of the heightfield never shows the void */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
        <planeGeometry args={[1800, 1800]} />
        <meshStandardMaterial color="#3a5a2a" roughness={1} />
      </mesh>
      <mesh geometry={data.geometry} material={material} receiveShadow />
      <GrassField data={data} pose={pose} />
      <Instances geometry={geo.foliage} material={mats.foliage} items={data.trees} pose={pose} radius={radius} />
      <Instances geometry={geo.trunk} material={mats.trunk} items={trunkItems} pose={pose} radius={radius} />
      <Instances geometry={geo.bush} material={mats.bush} items={data.bushes} pose={pose} radius={radius} />
      <Instances geometry={geo.rock} material={mats.rock} items={data.rocks} pose={pose} radius={radius} />
      <Instances geometry={geo.stone} material={mats.stone} items={data.pebbles} cast={false} pose={pose} radius={radius} />
      {/* Perimeter crash barriers around the Monza driving park */}
      <TrackBarriers />
      {/* Light-bulbed glowing marquee arrow signs pointing towards jump hills */}
      <JumpArrowSigns />
    </group>
  );
}

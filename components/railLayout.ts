/**
 * Layout of the crash barrier along both edges of the road. Pure maths (no React / three.js), so it can be unit-run
 * in node.
 *
 * The barrier is cut into modules that follow the barrier line (RAIL_OFFSET to the side of the centre line). Each
 * module is cut by length along ITS OWN side, so every module keeps close to its natural size. The only opening is
 * INFIELD_GAP on the inside of the main straight.
 *
 * Two outputs:
 *  - `layoutRails`: one straight chord per module (used for the physics colliders).
 *  - `buildBentRails`: the visible barrier. Every module is BENT along the barrier line (each vertex follows the
 *    curve) instead of being a rigid straight piece, so neighbouring modules (and their overlapping beam ends) lie on
 *    the same smooth curve and there are no kinks, gaps or sticking-out corners in the bends.
 */

import { INFIELD_GAP, RAIL_OFFSET, TrackField, inInfieldGap } from "@/components/trackCollision";

export type RailSeg = {
  /** middle of the module on the ground */
  x: number;
  z: number;
  /** rotation around Y that turns the module's local +x along the barrier */
  yaw: number;
  /** distance between the two ends of the module */
  len: number;
};

/** Native module length (post spacing x 4) and visual scale applied on top of it, see scripts/build-track-assets.py. */
export const RAIL_MODULE_LENGTH = 5.4;
export const RAIL_SCALE = 1.2;

/** Resolution of the sampled barrier lines, in world units. */
const STEP = 0.4;

function centerline(field: TrackField) {
  const n = field.n;
  const S = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    S[i + 1] = S[i] + Math.hypot(field.xs[j] - field.xs[i], field.zs[j] - field.zs[i]);
  }
  const total = S[n];

  const pos = (s: number) => {
    const t0 = ((s % total) + total) % total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= t0) lo = mid;
      else hi = mid;
    }
    const j = (lo + 1) % n;
    const seg = S[lo + 1] - S[lo];
    const t = seg > 0 ? (t0 - S[lo]) / seg : 0;
    return { x: field.xs[lo] + (field.xs[j] - field.xs[lo]) * t, z: field.zs[lo] + (field.zs[j] - field.zs[lo]) * t };
  };
  /** point on the line `q` units to the left (+) / right (-) of the centre line at arc length s */
  const side = (s: number, q: number) => {
    const a = pos(s - 1.2);
    const b = pos(s + 1.2);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const p = pos(s);
    return { x: p.x + -tz * q, z: p.z + tx * q };
  };
  return { total, pos, side };
}

type Centerline = ReturnType<typeof centerline>;

/** One barrier line (closed loop) sampled every STEP units, with the arc length along it. */
type Side = { px: Float64Array; pz: Float64Array; cum: Float64Array; m: number; len: number; total: number };

function buildSide(cl: Centerline, sgn: number, offset: number): Side {
  const m = Math.ceil(cl.total / STEP);
  const px = new Float64Array(m + 1);
  const pz = new Float64Array(m + 1);
  const cum = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) {
    const p = cl.side((i / m) * cl.total, offset * sgn);
    px[i] = p.x;
    pz[i] = p.z;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  return { px, pz, cum, m, len: cum[m], total: cl.total };
}

/** Point at arc length c (0..len) along the barrier line, plus the matching centre-line arc length. */
function sideAt(sd: Side, c: number) {
  const { px, pz, cum, m, total } = sd;
  let lo = 0;
  let hi = m;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= c) lo = mid;
    else hi = mid;
  }
  const seg = cum[lo + 1] - cum[lo];
  const t = seg > 0 ? (c - cum[lo]) / seg : 0;
  return { x: px[lo] + (px[lo + 1] - px[lo]) * t, z: pz[lo] + (pz[lo + 1] - pz[lo]) * t, s: ((lo + t) / m) * total };
}

function moduleCount(sd: Side) {
  return Math.max(8, Math.round(sd.len / (RAIL_MODULE_LENGTH * RAIL_SCALE)));
}

export function layoutRails(field: TrackField, offset = RAIL_OFFSET): RailSeg[] {
  const cl = centerline(field);
  const out: RailSeg[] = [];
  for (const sgn of [1, -1]) {
    const sd = buildSide(cl, sgn, offset);
    const count = moduleCount(sd);
    const L = sd.len / count;
    for (let k = 0; k < count; k++) {
      const A = sideAt(sd, k * L);
      const B = sideAt(sd, Math.min((k + 1) * L, sd.len - 1e-6));
      const x = (A.x + B.x) / 2;
      const z = (A.z + B.z) / 2;
      // the opening on the inside of the main straight: no barrier there
      const c = cl.pos((A.s + B.s) / 2);
      if (inInfieldGap(c.x, c.z) && field.inside(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(-(B.z - A.z), B.x - A.x), len: Math.hypot(B.x - A.x, B.z - A.z) });
    }
  }
  return out;
}

export type RailMeshData = { positions: number[]; normals: number[]; indices: number[] };

/**
 * The visible barrier as one merged mesh with every module bent along the barrier line.
 * `rail` is one straight module (local +x along the barrier, +y up, +z to the left), `ground(x, z)` the terrain height.
 */
export function buildBentRails(
  field: TrackField,
  rail: RailMeshData,
  ground: (x: number, z: number) => number,
  offset = RAIL_OFFSET
) {
  const cl = centerline(field);
  const nv = rail.positions.length / 3;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const TAN = 0.6; // half window for the tangent: smooth direction, not the direction of one tiny sample step

  for (const sgn of [1, -1]) {
    const sd = buildSide(cl, sgn, offset);
    const count = moduleCount(sd);
    const L = sd.len / count;
    const kx = L / RAIL_MODULE_LENGTH; // the module is stretched / squeezed a little to fit its slot
    const wrap = (c: number) => ((c % sd.len) + sd.len) % sd.len;

    for (let k = 0; k < count; k++) {
      const A = sideAt(sd, k * L);
      const B = sideAt(sd, Math.min((k + 1) * L, sd.len - 1e-6));
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      const c0 = cl.pos((A.s + B.s) / 2);
      if (inInfieldGap(c0.x, c0.z) && field.inside(mx, mz)) continue;

      const cc = (k + 0.5) * L;
      const base = positions.length / 3;
      for (let v = 0; v < nv; v++) {
        const lx = rail.positions[v * 3];
        const ly = rail.positions[v * 3 + 1];
        const lz = rail.positions[v * 3 + 2];
        const c = wrap(cc + lx * kx);
        const p = sideAt(sd, c);
        const q = sideAt(sd, wrap(c + TAN));
        const r = sideAt(sd, wrap(c - TAN));
        let tx = q.x - r.x;
        let tz = q.z - r.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // left normal, same as local +z of the straight module
        const nx = -tz;
        const nz = tx;
        positions.push(p.x + nx * lz * RAIL_SCALE, ground(p.x, p.z) + ly * RAIL_SCALE, p.z + nz * lz * RAIL_SCALE);

        const ax = rail.normals[v * 3];
        const ay = rail.normals[v * 3 + 1];
        const az = rail.normals[v * 3 + 2];
        normals.push(tx * ax + nx * az, ay, tz * ax + nz * az);
      }
      for (let i = 0; i < rail.indices.length; i++) indices.push(rail.indices[i] + base);
    }
  }
  return { positions, normals, indices };
}

/** Where the pushable cones stand: one row across the mouth of the opening. */
export function coneLayout(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const z = INFIELD_GAP.z - offsetToMouth();
  let i = 0;
  for (let x = INFIELD_GAP.x0 + 1.5; x <= INFIELD_GAP.x1 - 1.5; x += 3.4) {
    // tiny deterministic wobble so the row doesn't look machine-made
    const w = Math.sin(i * 12.9898) * 0.5;
    out.push({ x: x + w * 0.4, z: z + w, yaw: i * 0.9 });
    i++;
  }
  return out;
}

function offsetToMouth() {
  return RAIL_OFFSET + 0.6;
}

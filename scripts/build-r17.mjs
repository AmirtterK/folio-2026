#!/usr/bin/env node
/**
 * build-r17.mjs: turns the single-mesh Renault R17 GLB into a game-ready car.
 *
 *   node scripts/build-r17.mjs [input.glb] [output.glb]
 *
 * The source is ONE merged mesh (one white material, no normals, no textures) whose rear wheels are
 * separate pieces but whose front wheels are fused into the body. This script:
 *   1. cuts all four wheels out of the mesh by geometry (a cylinder around each axle),
 *   2. splits every wheel into tire + rim, and the body into paint / glass / trim / lamp / tail / chrome,
 *   3. moves everything into the toy car's coordinate system (forward = +Z, ground at y = 0, scaled so the
 *      wheelbase is 2.4 like ToyCarSmoke), with each wheel's origin ON its axle so it spins in place,
 *   4. computes creased smooth normals (the source has none),
 *   5. writes a GLB:   R17 > Body
 *                           > Steer_FL > Wheel_FL      (steering pivot, then spinning wheel)
 *                           > Steer_FR > Wheel_FR
 *                           > Wheel_RL
 *                           > Wheel_RR
 * No dependencies: it reads and writes the GLB container itself.
 */
import fs from "node:fs";
import path from "node:path";

const IN = process.argv[2] ?? "scripts/r17/model.glb";
const OUT = process.argv[3] ?? "public/models/r17.glb";

/* ---------------- constants measured from the source model (metres, source axes) ---------------- */
// In the source file the car's FRONT is -X, its width is Z and up is +Y.
const AX_FRONT = -0.5887;       // front axle x
const AX_REAR = 0.55079;        // rear axle x
const AX_Y = -0.15147;          // axle height
const RADIUS = 0.1511;          // tire radius
const WZ0 = 0.2697, WZ1 = 0.3935; // wheel z extent on the +z side (mirrored for -z)
const TOL_R = 0.007;            // radial slack: the tread sits a little outside the nominal radius
const TOL_Z = 0.004;            // axial slack
const WHEELBASE_TARGET = 2.4;   // ToyCarSmoke's WHEEL_Z * 2
const SCALE = WHEELBASE_TARGET / (AX_REAR - AX_FRONT);
const CREASE_DEG = 38;          // normals are smoothed across edges flatter than this
const WELL_R = 0.186;           // body faces within this radius of an axle are wheel-well liner
const TIRE_RIM_SPLIT = 0.10;    // wheel faces beyond this radius are rubber, inside is rim/hub

// body segmentation (source axes)
const BELT = 0.098;             // window sill height (just above the flat shoulder ledge at y~0.09, so the ledge stays paint)
const WINDSHIELD = { x0: -0.41, x1: -0.105, y0: 0.112, z: 0.36 };
const HATCH_GLASS = { x0: 0.495, x1: 0.835, y0: 0.105, z: 0.36 };
const SIDE_GLASS_X = [-0.43, 0.86];

/* ---------------- GLB reading ---------------- */
function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}
function readAccessor(json, bin, idx) {
  const a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
  const stride = bv.byteStride || n * size;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o) }[a.componentType];
  const out = a.componentType === 5126 ? new Float64Array(a.count * n) : new Uint32Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get(base + i * stride + k * size);
  return out;
}

/* ---------------- load source ---------------- */
console.log(`reading ${IN}`);
const { json: sj, bin: sbin } = readGLB(fs.readFileSync(IN));
if (sj.meshes.length !== 1 || sj.meshes[0].primitives.length !== 1)
  console.warn("warning: expected exactly one mesh/primitive; using the first primitive only");
const prim = sj.meshes[0].primitives[0];
const P = readAccessor(sj, sbin, prim.attributes.POSITION);          // vertices, source axes
const IDX = prim.indices != null ? readAccessor(sj, sbin, prim.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
const nV = P.length / 3, nF = IDX.length / 3;
console.log(`  ${nV} vertices, ${nF} triangles`);

/* ---------------- per-face geometry ---------------- */
const FN = new Float64Array(nF * 3);   // unnormalised face normals (length = 2 * area)
const FU = new Float64Array(nF * 3);   // unit face normals
const FC = new Float64Array(nF * 3);   // centroids
for (let f = 0; f < nF; f++) {
  const a = IDX[f * 3] * 3, b = IDX[f * 3 + 1] * 3, c = IDX[f * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1e-30;
  FN[f * 3] = nx; FN[f * 3 + 1] = ny; FN[f * 3 + 2] = nz;
  FU[f * 3] = nx / l; FU[f * 3 + 1] = ny / l; FU[f * 3 + 2] = nz / l;
  FC[f * 3] = (P[a] + P[b] + P[c]) / 3; FC[f * 3 + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; FC[f * 3 + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
}

/* ---------------- 1. find the wheels ---------------- */
// wheel ids: 0 FL, 1 FR, 2 RL, 3 RR.   L = car-left = source +Z (after the rotation below it becomes +X)
const WHEELS = [
  { name: "FL", ax: AX_FRONT, zc: (WZ0 + WZ1) / 2, z0: WZ0, z1: WZ1 },
  { name: "FR", ax: AX_FRONT, zc: -(WZ0 + WZ1) / 2, z0: -WZ1, z1: -WZ0 },
  { name: "RL", ax: AX_REAR, zc: (WZ0 + WZ1) / 2, z0: WZ0, z1: WZ1 },
  { name: "RR", ax: AX_REAR, zc: -(WZ0 + WZ1) / 2, z0: -WZ1, z1: -WZ0 },
];
const wheelOfFace = new Int8Array(nF).fill(-1);
WHEELS.forEach((w, wi) => {
  const inside = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    inside[v] = Math.hypot(x - w.ax, y - AX_Y) <= RADIUS + TOL_R && z >= w.z0 - TOL_Z && z <= w.z1 + TOL_Z ? 1 : 0;
  }
  for (let f = 0; f < nF; f++) {
    if (wheelOfFace[f] >= 0) continue;
    if (inside[IDX[f * 3]] + inside[IDX[f * 3 + 1]] + inside[IDX[f * 3 + 2]] >= 1) wheelOfFace[f] = wi;
  }
});
const wheelCounts = WHEELS.map((_, i) => wheelOfFace.reduce((n, v) => n + (v === i), 0));
console.log(`  wheel faces: ${WHEELS.map((w, i) => `${w.name}=${wheelCounts[i]}`).join("  ")}`);
if (wheelCounts.some((c) => c < 25000 || c > 36000)) throw new Error("wheel extraction looks wrong; are the constants right for this file?");

/* ---------------- 2. materials ---------------- */
// vertex -> faces (CSR)
const deg = new Uint32Array(nV + 1);
for (let i = 0; i < IDX.length; i++) deg[IDX[i] + 1]++;
for (let v = 0; v < nV; v++) deg[v + 1] += deg[v];
const fill = deg.slice(0, nV), vf = new Uint32Array(IDX.length);
for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) vf[fill[IDX[f * 3 + k]]++] = f;

// Classification uses SMOOTHED face normals: the scan is noisy, and thresholding raw per-triangle normals
// gives sawtooth material borders (black zigzags along the shoulder, sills and window frames).
let SN = Float64Array.from(FU);
for (let pass = 0; pass < 3; pass++) {
  const out = new Float64Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 3; k++) {
      const v = IDX[f * 3 + k];
      for (let i = deg[v]; i < deg[v + 1]; i++) { const g = vf[i]; sx += SN[g * 3]; sy += SN[g * 3 + 1]; sz += SN[g * 3 + 2]; }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    out[f * 3] = sx / l; out[f * 3 + 1] = sy / l; out[f * 3 + 2] = sz / l;
  }
  SN = out;
}
const MATS = ["paint", "glass", "trim", "lamp", "tail", "chrome", "tire", "rim"];
const M = Object.fromEntries(MATS.map((m, i) => [m, i]));
const matOfFace = new Int8Array(nF);
for (let f = 0; f < nF; f++) {
  const cx = FC[f * 3], cy = FC[f * 3 + 1], cz = FC[f * 3 + 2];
  const nx = SN[f * 3], ny = SN[f * 3 + 1];
  const w = wheelOfFace[f];
  if (w >= 0) {
    matOfFace[f] = Math.hypot(cx - WHEELS[w].ax, cy - AX_Y) >= TIRE_RIM_SPLIT ? M.tire : M.rim;
    continue;
  }
  let m = M.paint;
  const az = Math.abs(cz);
  // wheel-well liner: whatever is left of the body right around an axle (inner wall + arch ceiling) is dark
  if (az > 0.2 && az < 0.388 && (Math.hypot(cx - AX_FRONT, cy - AX_Y) < WELL_R || Math.hypot(cx - AX_REAR, cy - AX_Y) < WELL_R)) {
    matOfFace[f] = M.trim;
    continue;
  }
  // greenhouse: everything above the sill that is not roof-flat is glass (A/B/C pillars come out dark, on purpose)
  if (cy > BELT && ny < 0.8 && cx > SIDE_GLASS_X[0] && cx < SIDE_GLASS_X[1]) m = M.glass;
  // the shallow windscreen and the fastback glass are steeper than "roof" but flatter than 0.8
  if (cx > WINDSHIELD.x0 && cx < WINDSHIELD.x1 && cy > WINDSHIELD.y0 && az < WINDSHIELD.z && ny > 0.5 && ny < 0.97) m = M.glass;
  if (cx > HATCH_GLASS.x0 && cx < HATCH_GLASS.x1 && cy > HATCH_GLASS.y0 && az < HATCH_GLASS.z && ny > 0.5 && ny < 0.97) m = M.glass;
  // underside, wheel-arch ceilings (but not the downward-facing lip of the sill step on the outer body side)
  if (ny < -0.55 && !(az > 0.38 && cy > -0.2)) m = M.trim;
  // front fascia: lamps outside, grille inside
  if (cx < -0.90 && nx < -0.3 && az < 0.35 && cy > -0.065 && cy < 0.03) m = az > 0.155 ? M.lamp : M.trim;
  // tail light bars
  if (cx > 0.88 && nx > 0.3 && az > 0.09 && az < 0.335 && cy > -0.03 && cy < 0.02) m = M.tail;
  // front bumper blades
  if (cx < -0.88 && cy > -0.18 && cy < -0.115 && az < 0.40 && ny > -0.55) m = M.chrome;
  matOfFace[f] = m;
}
// Paint / glass / trim borders are NOT taken from per-triangle labels (that follows the scan's mesh and looks
// hand-painted). Instead every vertex gets a smooth class score, the scores are relaxed across the surface so the
// borders become clean curves, and triangles that straddle a border are CUT along it (see emitBodyFace below).
function classifyPoint(cx, cy, cz, nx, ny) {
  const az = Math.abs(cz);
  if (az > 0.2 && az < 0.388 && (Math.hypot(cx - AX_FRONT, cy - AX_Y) < WELL_R || Math.hypot(cx - AX_REAR, cy - AX_Y) < WELL_R)) return M.trim;
  let m = M.paint;
  if (cy > BELT && ny < 0.8 && cx > SIDE_GLASS_X[0] && cx < SIDE_GLASS_X[1]) m = M.glass;
  if (cx > WINDSHIELD.x0 && cx < WINDSHIELD.x1 && cy > WINDSHIELD.y0 && az < WINDSHIELD.z && ny > 0.5 && ny < 0.97) m = M.glass;
  if (cx > HATCH_GLASS.x0 && cx < HATCH_GLASS.x1 && cy > HATCH_GLASS.y0 && az < HATCH_GLASS.z && ny > 0.5 && ny < 0.97) m = M.glass;
  if (ny < -0.55 && !(az > 0.38 && cy > -0.2)) m = M.trim;
  return m;
}
const NCLS = 3; // 0 paint, 1 glass, 2 trim
const VN = new Float64Array(nV * 3);
const bodyVert = new Uint8Array(nV);
for (let v = 0; v < nV; v++) {
  let sx = 0, sy = 0, sz = 0;
  for (let i = deg[v]; i < deg[v + 1]; i++) {
    const g = vf[i];
    if (wheelOfFace[g] >= 0) continue;
    bodyVert[v] = 1; sx += SN[g * 3]; sy += SN[g * 3 + 1]; sz += SN[g * 3 + 2];
  }
  const l = Math.hypot(sx, sy, sz) || 1;
  VN[v * 3] = sx / l; VN[v * 3 + 1] = sy / l; VN[v * 3 + 2] = sz / l;
}
let S = new Float32Array(nV * NCLS);
for (let v = 0; v < nV; v++) if (bodyVert[v]) S[v * NCLS + classifyPoint(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], VN[v * 3], VN[v * 3 + 1])] = 1;
const RELAX_ITERS = 14, RELAX_KEEP = 0.35;
for (let it = 0; it < RELAX_ITERS; it++) {
  const out = new Float32Array(nV * NCLS);
  for (let v = 0; v < nV; v++) {
    if (!bodyVert[v]) continue;
    let a0 = 0, a1 = 0, a2 = 0, n = 0;
    for (let i = deg[v]; i < deg[v + 1]; i++) {
      const g = vf[i];
      if (wheelOfFace[g] >= 0) continue;
      for (let k = 0; k < 3; k++) {
        const u = IDX[g * 3 + k];
        if (u === v) continue;
        a0 += S[u * NCLS]; a1 += S[u * NCLS + 1]; a2 += S[u * NCLS + 2]; n++;
      }
    }
    if (!n) { out[v * NCLS] = S[v * NCLS]; out[v * NCLS + 1] = S[v * NCLS + 1]; out[v * NCLS + 2] = S[v * NCLS + 2]; continue; }
    out[v * NCLS] = RELAX_KEEP * S[v * NCLS] + (1 - RELAX_KEEP) * a0 / n;
    out[v * NCLS + 1] = RELAX_KEEP * S[v * NCLS + 1] + (1 - RELAX_KEEP) * a1 / n;
    out[v * NCLS + 2] = RELAX_KEEP * S[v * NCLS + 2] + (1 - RELAX_KEEP) * a2 / n;
  }
  S = out;
}
const VL = new Uint8Array(nV);
for (let v = 0; v < nV; v++) {
  let b = 0;
  for (let c = 1; c < NCLS; c++) if (S[v * NCLS + c] > S[v * NCLS + b]) b = c;
  VL[v] = b;
}
{
  const c = new Array(MATS.length).fill(0);
  for (let f = 0; f < nF; f++) c[matOfFace[f]]++;
  console.log("  faces per material: " + MATS.map((m, i) => `${m}=${c[i]}`).join("  "));
}

/* ---------------- 3. creased smooth normals ---------------- */
const COS = Math.cos((CREASE_DEG * Math.PI) / 180);
function cornerNormal(f, v, out) {
  let sx = 0, sy = 0, sz = 0;
  const ux = FU[f * 3], uy = FU[f * 3 + 1], uz = FU[f * 3 + 2];
  for (let i = deg[v]; i < deg[v + 1]; i++) {
    const g = vf[i];
    if (ux * FU[g * 3] + uy * FU[g * 3 + 1] + uz * FU[g * 3 + 2] > COS) { sx += FN[g * 3]; sy += FN[g * 3 + 1]; sz += FN[g * 3 + 2]; }
  }
  const l = Math.hypot(sx, sy, sz) || 1;
  out[0] = sx / l; out[1] = sy / l; out[2] = sz / l;
}

/* ---------------- 4. transform to car space ---------------- */
// source (x, y, z)  ->  car (z, y, -x), then scale; ground (tire bottom) at y = 0.
// This is a proper rotation about Y by +90 degrees, so triangle winding is preserved.
const GROUND_Y = AX_Y - RADIUS;
const toCar = (x, y, z) => [z * SCALE, (y - GROUND_Y) * SCALE, -x * SCALE];
const nToCar = (x, y, z) => [z, y, -x];

/* ---------------- 5. build primitives ---------------- */
function cornerOf(f, k) {
  const v = IDX[f * 3 + k], tmp = [0, 0, 0];
  cornerNormal(f, v, tmp);
  return { x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2], nx: tmp[0], ny: tmp[1], nz: tmp[2],
    key: `${v}|${Math.round(tmp[0] * 40)}|${Math.round(tmp[1] * 40)}|${Math.round(tmp[2] * 40)}` };
}
function lerpCorner(a, b, t) {
  let nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t, nz = a.nz + (b.nz - a.nz) * t;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, nx: nx / l, ny: ny / l, nz: nz / l, key: null };
}
function buildFromTris(tris, origin /* source-space point subtracted first, or null */) {
  const key = new Map();
  const pos = [], nor = [], idx = [];
  let uniq = 0;
  for (const tri of tris) {
    for (const c of tri) {
      const qk = c.key ?? `u${uniq++}`;
      let id = key.get(qk);
      if (id === undefined) {
        id = pos.length / 3; key.set(qk, id);
        const p = origin ? [(c.z - origin[2]) * SCALE, (c.y - origin[1]) * SCALE, -(c.x - origin[0]) * SCALE] : toCar(c.x, c.y, c.z);
        pos.push(p[0], p[1], p[2]);
        const n = nToCar(c.nx, c.ny, c.nz);
        nor.push(n[0], n[1], n[2]);
      }
      idx.push(id);
    }
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint32Array.from(idx) };
}
function buildPrimitive(faceList, origin) {
  return buildFromTris(faceList.map((f) => [cornerOf(f, 0), cornerOf(f, 1), cornerOf(f, 2)]), origin);
}

// Body triangles by material. Paint / glass / trim come from the relaxed vertex scores; a triangle that straddles a
// border is cut along the point where the two scores cross. Then the lamps, grille, bumper bar and tail lights are
// laid on top as exact analytic shapes (rounded boxes / ellipses measured from the model): triangles near their
// outline are subdivided and cut along the true outline, so the edges are mathematically clean.
const BODY_MATS = [M.paint, M.glass, M.trim, M.lamp, M.tail, M.chrome];
const TRI = Object.fromEntries(BODY_MATS.map((m) => [m, []]));
const fan = (poly, into) => { for (let i = 1; i + 1 < poly.length; i++) into.push([poly[0], poly[i], poly[i + 1]]); };
for (let f = 0; f < nF; f++) {
  if (wheelOfFace[f] >= 0) continue;
  const c = [cornerOf(f, 0), cornerOf(f, 1), cornerOf(f, 2)];
  const vs = [IDX[f * 3], IDX[f * 3 + 1], IDX[f * 3 + 2]];
  const lab = vs.map((v) => VL[v]);
  if (lab[0] === lab[1] && lab[1] === lab[2]) { TRI[lab[0]].push(c); continue; }
  const set = [...new Set(lab)];
  if (set.length === 3) {
    let best = 0, bs = -1;
    for (let k = 0; k < NCLS; k++) { const s = vs.reduce((a, v) => a + S[v * NCLS + k], 0); if (s > bs) { bs = s; best = k; } }
    TRI[best].push(c); continue;
  }
  const [A, B] = set;
  const fv = vs.map((v) => S[v * NCLS + A] - S[v * NCLS + B]);
  const polyA = [], polyB = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    (fv[i] >= 0 ? polyA : polyB).push(c[i]);
    if ((fv[i] >= 0) !== (fv[j] >= 0)) {
      const p = lerpCorner(c[i], c[j], fv[i] / (fv[i] - fv[j]));
      polyA.push(p); polyB.push(p);
    }
  }
  if (polyA.length >= 3) fan(polyA, TRI[A]);
  if (polyB.length >= 3) fan(polyB, TRI[B]);
}

/* ---- analytic layers (source axes: front = -x, width = z, up = y; shapes are mirrored with |z|) ---- */
// signed distance (negative inside) to a rounded box and to an ellipse in the (u, v) plane
const sdBox = (u, v, cu, cv, hu, hv, r) => {
  const qx = Math.abs(u - cu) - hu + r, qy = Math.abs(v - cv) - hv + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdEllipse = (u, v, cu, cv, a, b) => (Math.hypot((u - cu) / a, (v - cv) / b) - 1) * Math.min(a, b);
const FRONT_X = -0.84, REAR_X = 0.86; // shapes only exist on the front / rear faces of the car
const front = (sd) => (x, y, z) => -Math.max(sd(Math.abs(z), y), x - FRONT_X);
const rear = (sd) => (x, y, z) => -Math.max(sd(Math.abs(z), y), REAR_X - x);
const LAYERS = [
  // headlight units: black housing, then the round lens and the indicator block inside it
  { mat: M.trim,   g: front((u, v) => sdBox(u, v, 0.252, -0.022, 0.104, 0.040, 0.022)) },
  { mat: M.lamp,   g: front((u, v) => sdEllipse(u, v, 0.304, -0.0215, 0.044, 0.034)) },
  { mat: M.lamp,   g: front((u, v) => sdBox(u, v, 0.205, -0.022, 0.045, 0.032, 0.006)) },
  // grille
  { mat: M.trim,   g: front((u, v) => sdBox(u, v, 0, -0.024, 0.147, 0.038, 0.010)) },
  // front bumper bar
  { mat: M.chrome, g: front((u, v) => sdBox(u, v, 0, -0.1465, 0.395, 0.0285, 0.010)) },
  // tail light bars and their end blocks
  { mat: M.tail,   g: rear((u, v) => sdBox(u, v, 0.2265, -0.002, 0.1185, 0.017, 0.004)) },
  { mat: M.tail,   g: rear((u, v) => sdBox(u, v, 0.093, -0.002, 0.012, 0.0185, 0.004)) },
];
const RES = 0.0025; // outline resolution (source units): triangles touching an outline are subdivided to about this
const edgeLen = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function subdivide(t) {
  const [a, b, c] = t, ab = lerpCorner(a, b, 0.5), bc = lerpCorner(b, c, 0.5), ca = lerpCorner(c, a, 0.5);
  return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
}
function clipInto(t, g, mat, oldMat, out) {
  const gv = t.map((c) => g(c.x, c.y, c.z));
  if (gv.every((v) => v >= 0)) { out.push({ t, m: mat }); return; }
  if (gv.every((v) => v < 0)) { out.push({ t, m: oldMat }); return; }
  const pin = [], pout = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    (gv[i] >= 0 ? pin : pout).push(t[i]);
    if ((gv[i] >= 0) !== (gv[j] >= 0)) {
      const p = lerpCorner(t[i], t[j], gv[i] / (gv[i] - gv[j]));
      pin.push(p); pout.push(p);
    }
  }
  const ti = [], to = [];
  if (pin.length >= 3) fan(pin, ti);
  if (pout.length >= 3) fan(pout, to);
  for (const x of ti) out.push({ t: x, m: mat });
  for (const x of to) out.push({ t: x, m: oldMat });
}
function applyLayer(items, L) {
  const out = [];
  const refine = (t, m, depth) => {
    const gv = t.map((c) => L.g(c.x, c.y, c.z));
    const me = Math.max(edgeLen(t[0], t[1]), edgeLen(t[1], t[2]), edgeLen(t[2], t[0]));
    if (gv.every((v) => v > me)) { out.push({ t, m: L.mat }); return; }
    if (gv.every((v) => v < -me)) { out.push({ t, m }); return; }
    if (depth > 0 && me > RES) { for (const s of subdivide(t)) refine(s, m, depth - 1); return; }
    clipInto(t, L.g, L.mat, m, out);
  };
  for (const it of items) {
    if (it.m === M.glass) { out.push(it); continue; }
    refine(it.t, it.m, 3);
  }
  return out;
}
let items = [];
for (const m of [M.paint, M.glass, M.trim]) for (const t of TRI[m]) items.push({ t, m });
for (const L of LAYERS) items = applyLayer(items, L);
for (const m of BODY_MATS) TRI[m] = [];
for (const it of items) TRI[it.m].push(it.t);

const bodyPrims = [], wheelPrims = WHEELS.map(() => []);
for (const m of BODY_MATS) if (TRI[m].length) bodyPrims.push({ mat: m, ...buildFromTris(TRI[m], null) });
WHEELS.forEach((w, wi) => {
  for (const m of [M.tire, M.rim]) {
    const fl = []; for (let f = 0; f < nF; f++) if (wheelOfFace[f] === wi && matOfFace[f] === m) fl.push(f);
    if (fl.length) wheelPrims[wi].push({ mat: m, ...buildPrimitive(fl, [w.ax, AX_Y, w.zc]) });
  }
});

/* ---------------- 6. write GLB ---------------- */
const MATERIAL_DEFS = {
  paint:  { baseColorFactor: [0.93, 0.38, 0.08, 1], metallicFactor: 0.25, roughnessFactor: 0.35 },
  glass:  { baseColorFactor: [0.03, 0.045, 0.07, 1], metallicFactor: 0.6, roughnessFactor: 0.08 },
  trim:   { baseColorFactor: [0.035, 0.035, 0.04, 1], metallicFactor: 0.1, roughnessFactor: 0.65 },
  lamp:   { baseColorFactor: [0.95, 0.92, 0.78, 1], metallicFactor: 0.2, roughnessFactor: 0.15 },
  tail:   { baseColorFactor: [0.62, 0.04, 0.04, 1], metallicFactor: 0.1, roughnessFactor: 0.3 },
  chrome: { baseColorFactor: [0.86, 0.86, 0.9, 1], metallicFactor: 1, roughnessFactor: 0.14 },
  tire:   { baseColorFactor: [0.025, 0.025, 0.03, 1], metallicFactor: 0, roughnessFactor: 0.92 },
  rim:    { baseColorFactor: [0.72, 0.72, 0.76, 1], metallicFactor: 1, roughnessFactor: 0.28 },
};
const chunks = [], accessors = [], bufferViews = [];
let byteLen = 0;
function addBuffer(typed, target) {
  const pad = (4 - (byteLen % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLen += pad; }
  const view = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: view.length, target });
  chunks.push(view); byteLen += view.length;
  return bufferViews.length - 1;
}
function addPrimitive(p) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
  const aPos = accessors.push({ bufferView: addBuffer(p.pos, 34962), componentType: 5126, count: p.pos.length / 3, type: "VEC3", min: mn, max: mx }) - 1;
  const aNor = accessors.push({ bufferView: addBuffer(p.nor, 34962), componentType: 5126, count: p.nor.length / 3, type: "VEC3" }) - 1;
  const aIdx = accessors.push({ bufferView: addBuffer(p.idx, 34963), componentType: 5125, count: p.idx.length, type: "SCALAR" }) - 1;
  return { attributes: { POSITION: aPos, NORMAL: aNor }, indices: aIdx, material: p.mat, mode: 4 };
}
const meshes = [
  { name: "Body", primitives: bodyPrims.map(addPrimitive) },
  ...WHEELS.map((w, i) => ({ name: `Wheel_${w.name}_mesh`, primitives: wheelPrims[i].map(addPrimitive) })),
];
const axleCar = WHEELS.map((w) => toCar(w.ax, AX_Y, w.zc));
const round = (a) => a.map((v) => +v.toFixed(5));
const nodes = [
  { name: "R17", children: [1, 2, 3, 4, 5], extras: { forward: "+Z", up: "+Y", scale: SCALE, wheelRadius: RADIUS * SCALE, wheelbase: WHEELBASE_TARGET,
      frontAxleZ: axleCar[0][2], rearAxleZ: axleCar[2][2], wheelCenterX: axleCar[0][0], length: 1.899 * SCALE, width: 0.861 * SCALE, height: 0.602 * SCALE } },
  { name: "Body", mesh: 0 },
  { name: "Steer_FL", translation: round(axleCar[0]), children: [6] },
  { name: "Steer_FR", translation: round(axleCar[1]), children: [7] },
  { name: "Wheel_RL", mesh: 3, translation: round(axleCar[2]) },
  { name: "Wheel_RR", mesh: 4, translation: round(axleCar[3]) },
  { name: "Wheel_FL", mesh: 1 },
  { name: "Wheel_FR", mesh: 2 },
];
const gltf = {
  asset: { version: "2.0", generator: "build-r17.mjs" },
  scene: 0, scenes: [{ nodes: [0] }], nodes, meshes,
  materials: MATS.map((n) => ({ name: n, pbrMetallicRoughness: MATERIAL_DEFS[n], doubleSided: false })),
  accessors, bufferViews, buffers: [{ byteLength: byteLen }],
};
let jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
let binBuf = Buffer.concat(chunks);
binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, ch(jsonBuf.length, 0x4e4f534a), jsonBuf, ch(binBuf.length, 0x004e4942), binBuf]));
console.log(`wrote ${OUT}  (${(total / 1048576).toFixed(1)} MB)`);
console.log(`  scale ${SCALE.toFixed(4)}  wheel radius ${(RADIUS * SCALE).toFixed(4)}  front axle z ${axleCar[0][2].toFixed(3)}  rear axle z ${axleCar[2][2].toFixed(3)}  wheel x +-${Math.abs(axleCar[0][0]).toFixed(3)}`);

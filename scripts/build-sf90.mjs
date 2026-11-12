#!/usr/bin/env node
/**
 * build-sf90.mjs: turns the Draco-compressed Ferrari F1 (SF90) GLB into a game-ready car for FolioCar.
 *
 *   node scripts/build-sf90.mjs [input.glb] [output.glb]
 *
 * Needs (dev only):  npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf meshoptimizer
 *
 * The source is 89 meshes in a deep node tree (rotated / scaled / mirrored nodes), Draco-compressed, with the four wheels
 * as separate tire + rim + decal nodes. This script:
 *   1. decodes Draco and bakes every node's world transform into the vertices (mirrored nodes get their winding fixed),
 *   2. moves the car into the toy car's coordinate system (forward = +Z, ground at y = 0, scaled so the wheelbase is 2.4
 *      like FolioCar, wheelbase centred on the origin),
 *   3. cuts the wheels out (tire + rim + sidewall decals) with each wheel's origin ON its axle so it spins in place,
 *   4. merges the rest of the car into one Body mesh (one primitive per material) and simplifies the heavy scan-like geometry,
 *   5. writes a GLB:   SF90 > Body
 *                           > Steer_FL > Wheel_FL      (steering pivot, then spinning wheel)
 *                           > Steer_FR > Wheel_FR
 *                           > Wheel_RL
 *                           > Wheel_RR
 * The original textures and materials (livery, decals, clearcoat) are kept.
 *
 * Model credit: "Ferrari F1 2019" by vecarz (https://sketchfab.com/heynic), CC-BY-4.0.
 */
import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";

const IN = process.argv[2] ?? "scripts/sf90/sf90.glb";
const OUT = process.argv[3] ?? "public/models/sf90.glb";
const WHEELBASE_TARGET = 2.4; // FolioCar's WHEEL_Z * 2
const SIMPLIFY_RATIO = 0.28;  // fraction of triangles to keep (the source is 650k triangles)
const SIMPLIFY_ERROR = 0.0012; // max error, relative to the mesh size

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
console.log(`reading ${IN}`);
const doc = await io.read(IN);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

/* ---------------- 4x4 / 3x3 helpers (column-major, like glTF) ---------------- */
const det3 = (m) =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
function invTranspose3(m) {
  // returns the inverse-transpose of the upper-left 3x3 as a row-major 9-array applied as n' = N * n
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  const det = a * A + b * B + c * C || 1;
  // cofactor matrix / det is the inverse-transpose
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

/* ---------------- 1. collect every mesh primitive with its world transform ---------------- */
const parts = [];
function walk(node, ancestors) {
  const chain = [...ancestors, node.getName()];
  const mesh = node.getMesh();
  if (mesh) {
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) parts.push({ prim, wm, chain });
  }
  for (const c of node.listChildren()) walk(c, chain);
}
for (const n of scene.listChildren()) walk(n, []);
console.log(`  ${parts.length} primitives`);

const V = [0, 0, 0];
function bake(part) {
  const { prim, wm } = part;
  const posA = prim.getAttribute("POSITION"), norA = prim.getAttribute("NORMAL");
  const uvA = prim.getAttribute("TEXCOORD_0"), tanA = prim.getAttribute("TANGENT");
  const n = posA.getCount();
  const pos = new Float64Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), tan = new Float32Array(n * 4);
  const N = invTranspose3(wm);
  const flip = det3(wm) < 0;
  const e = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    posA.getElement(i, V);
    const x = V[0], y = V[1], z = V[2];
    pos[i * 3] = wm[0] * x + wm[4] * y + wm[8] * z + wm[12];
    pos[i * 3 + 1] = wm[1] * x + wm[5] * y + wm[9] * z + wm[13];
    pos[i * 3 + 2] = wm[2] * x + wm[6] * y + wm[10] * z + wm[14];
    if (norA) {
      norA.getElement(i, V);
      let nx = N[0] * V[0] + N[1] * V[1] + N[2] * V[2], ny = N[3] * V[0] + N[4] * V[1] + N[5] * V[2], nz = N[6] * V[0] + N[7] * V[1] + N[8] * V[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
    }
    if (uvA) { uvA.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1]; }
    if (tanA) {
      tanA.getElement(i, e);
      let tx = wm[0] * e[0] + wm[4] * e[1] + wm[8] * e[2], ty = wm[1] * e[0] + wm[5] * e[1] + wm[9] * e[2], tz = wm[2] * e[0] + wm[6] * e[1] + wm[10] * e[2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tan[i * 4] = tx / l; tan[i * 4 + 1] = ty / l; tan[i * 4 + 2] = tz / l; tan[i * 4 + 3] = (e[3] || 1) * (flip ? -1 : 1);
    } else tan[i * 4 + 3] = 1;
  }
  const ia = prim.getIndices();
  const idx = ia ? Uint32Array.from(ia.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
  if (flip) for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return { pos, nor, uv, tan, idx, mat: prim.getMaterial() };
}
const baked = parts.map((p) => ({ ...p, ...bake(p) }));

/* ---------------- 2. measure the wheels (world space, source units) ---------------- */
const isWheelPart = (p) => p.chain.some((nm) => /^(Tire|Rim|Decal Tire)/.test(nm));
const isTire = (p) => p.chain.some((nm) => /^Tire/.test(nm));
const bboxOf = (p) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
  return { mn, mx, c: mn.map((v, k) => (v + mx[k]) / 2), s: mx.map((v, k) => v - mn[k]) };
};
const tires = baked.filter(isTire).map((p) => ({ p, b: bboxOf(p) }));
if (tires.length !== 4) throw new Error(`expected 4 tire parts, found ${tires.length}`);
const zFront = Math.max(...tires.map((t) => t.b.c[2])), zRear = Math.min(...tires.map((t) => t.b.c[2]));
const zMid = (zFront + zRear) / 2;
const SCALE = WHEELBASE_TARGET / (zFront - zRear);
const radius = tires[0].b.s[1] / 2;
const groundY = tires[0].b.c[1] - radius;
// 0 FL (+x front), 1 FR (-x front), 2 RL, 3 RR: the car's front is +Z, its left is +X
const wheelIndex = (c) => (c[2] > zMid ? 0 : 2) + (c[0] > 0 ? 0 : 1);
const NAMES = ["FL", "FR", "RL", "RR"];
const axle = [0, 1, 2, 3].map((w) => tires.find((t) => wheelIndex(t.b.c) === w)?.b.c);
if (axle.some((a) => !a)) throw new Error("could not match all four wheels");
console.log(`  scale ${SCALE.toFixed(4)}  wheel radius ${(radius * SCALE).toFixed(4)}  wheelbase centre z ${zMid.toFixed(3)}`);

/* ---------------- 3. group by wheel / body, then by material ---------------- */
const groups = { body: [], 0: [], 1: [], 2: [], 3: [] };
for (const p of baked) {
  if (!isWheelPart(p)) { groups.body.push(p); continue; }
  groups[wheelIndex(bboxOf(p).c)].push(p);
}
console.log("  parts: body " + groups.body.length + "  wheels " + [0, 1, 2, 3].map((w) => groups[w].length).join("/"));

// to car space; origin = [ox, oy, oz] is subtracted first (source units) and the result scaled
function merge(list, origin) {
  const byMat = new Map();
  for (const p of list) {
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p);
  }
  const out = [];
  for (const [mat, ps] of byMat) {
    const nv = ps.reduce((a, p) => a + p.pos.length / 3, 0), ni = ps.reduce((a, p) => a + p.idx.length, 0);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), tan = new Float32Array(nv * 4), idx = new Uint32Array(ni);
    let vo = 0, io2 = 0;
    for (const p of ps) {
      const n = p.pos.length / 3;
      for (let i = 0; i < n; i++) {
        pos[(vo + i) * 3] = (p.pos[i * 3] - origin[0]) * SCALE;
        pos[(vo + i) * 3 + 1] = (p.pos[i * 3 + 1] - origin[1]) * SCALE;
        pos[(vo + i) * 3 + 2] = (p.pos[i * 3 + 2] - origin[2]) * SCALE;
      }
      nor.set(p.nor, vo * 3); uv.set(p.uv, vo * 2); tan.set(p.tan, vo * 4);
      for (let i = 0; i < p.idx.length; i++) idx[io2 + i] = p.idx[i] + vo;
      vo += n; io2 += p.idx.length;
    }
    out.push({ mat, pos, nor, uv, tan, idx });
  }
  return out;
}

/* ---------------- 4. rebuild the scene in the same document (materials, textures and extensions stay as they are) ---------------- */
const originBody = [0, groundY, zMid];
const bodyPrims = merge(groups.body, originBody);
const wheelPrims = [0, 1, 2, 3].map((w) => merge(groups[w], axle[w]));

// the geometry is written uncompressed, so the Draco extension is no longer needed
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_draco_mesh_compression") ext.dispose();
// throw the old node tree, meshes and accessors away
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
for (const a of root.listAccessors()) a.dispose();
for (const sc of root.listScenes()) for (const c of sc.listChildren()) sc.removeChild(c);

const buffer = root.listBuffers()[0] ?? doc.createBuffer();
const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
function makeMesh(name, prims) {
  const mesh = doc.createMesh(name);
  for (const p of prims) {
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", acc(p.pos, "VEC3"))
      .setAttribute("NORMAL", acc(p.nor, "VEC3"))
      .setAttribute("TEXCOORD_0", acc(p.uv, "VEC2"))
      .setAttribute("TANGENT", acc(p.tan, "VEC4"))
      .setIndices(acc(p.idx, "SCALAR"))
      .setMaterial(p.mat);
    mesh.addPrimitive(prim);
  }
  return mesh;
}
const toCar = (c) => [(c[0] - originBody[0]) * SCALE, (c[1] - originBody[1]) * SCALE, (c[2] - originBody[2]) * SCALE];
const car = doc.createNode("SF90").setExtras({
  forward: "+Z", up: "+Y", scale: SCALE, wheelRadius: radius * SCALE, wheelbase: WHEELBASE_TARGET,
  wheelCenterX: Math.abs(toCar(axle[0])[0]),
});
car.addChild(doc.createNode("Body").setMesh(makeMesh("Body", bodyPrims)));
NAMES.forEach((nm, w) => {
  const wheel = doc.createNode(`Wheel_${nm}`).setMesh(makeMesh(`Wheel_${nm}`, wheelPrims[w]));
  if (w < 2) {
    const pivot = doc.createNode(`Steer_${nm}`).setTranslation(toCar(axle[w]));
    pivot.addChild(wheel);
    car.addChild(pivot);
  } else {
    wheel.setTranslation(toCar(axle[w]));
    car.addChild(wheel);
  }
});
scene.addChild(car);

/* ---------------- 5. weld + simplify (the source is a 650k triangle model) ---------------- */
await MeshoptSimplifier.ready;
const before = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR, lockBorder: true }),
  dedup(),
  prune(),
);
const after = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
console.log(`  triangles ${before} -> ${after}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
console.log(`wrote ${OUT}  (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
const ax = axle.map(toCar);
console.log(`  front axle z ${ax[0][2].toFixed(3)}  rear axle z ${ax[2][2].toFixed(3)}  wheel x ${ax.map((a) => a[0].toFixed(3)).join(" / ")}  axle y ${ax[0][1].toFixed(3)}`);

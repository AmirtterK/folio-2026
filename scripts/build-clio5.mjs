#!/usr/bin/env node
/**
 * build-clio5.mjs: turns the Sketchfab "2020 Renault Clio" (Clio 5, one blue car cut into ~90 meshes with flat colours and no
 * part names) into a game-ready car for FolioCar.
 *
 *   node scripts/build-clio5.mjs [input.glb] [output.glb]
 *
 * The source meshes are arbitrary chunks of triangles (every chunk spans the whole car), so parts are found by connected
 * pieces instead of by node. This script:
 *   1. bakes every node's world transform into the vertices,
 *   2. welds the vertices and splits the car into connected pieces,
 *   3. finds the four tyres, then every piece that sits inside a wheel (tyre, rim, brake disc ...) and pulls it out of the body,
 *   4. turns the car around (the model's front is at z = 0; FolioCar wants front = +Z, left = +X, ground y = 0, wheelbase 2.4),
 *   5. paints: the blue body white, the tyres black, the rear lamp lenses red,
 *   6. builds the left wheels as a mirror image of the right ones (the source left rims got a different, darker material),
 *   7. writes a GLB:  Clio > Body
 *                          > Steer_FL > Wheel_FL     (steering pivot, then spinning wheel: tyre + rim + disc)
 *                          > Steer_FR > Wheel_FR
 *                          > Wheel_RL
 *                          > Wheel_RR
 *      simplified and Meshopt-compressed (three's loader decodes it through drei's useGLTF).
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, simplify, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

const IN = process.argv[2] ?? "C:/Users/LENOVO/Downloads/2020_renault_clio.glb";
const OUT = process.argv[3] ?? "public/models/renault_clio_5.glb";
const WHEELBASE_TARGET = 2.4;
const BODY_WHITE = [0.93, 0.93, 0.93, 1];
const TYRE_BLACK = [0.015, 0.015, 0.016, 1];
const TAIL_RED = [0.62, 0.02, 0.02, 1];
const RIM_SILVER = [0.66, 0.68, 0.72, 1]; // darker than the old near-white rims so they read as silver, not white
const SIMPLIFY_RATIO = Number(process.env.CLIO_SIMPLIFY ?? 0.45);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
console.log(`reading ${IN}`);
const doc = await io.read(IN);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const mat = (name) => root.listMaterials().find((m) => m.getName() === name);

/* ---------------- 1. bake world transforms into flat triangle arrays ---------------- */
const P = []; // per vertex: 3 floats position
const N = []; // 3 floats normal
const TRI = []; // 3 vertex indices per triangle
const triMat = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const posA = prim.getAttribute("POSITION"), norA = prim.getAttribute("NORMAL");
    const idxA = prim.getIndices();
    const cnt = idxA ? idxA.getCount() : posA.getCount();
    const base = P.length / 3;
    const v = [0, 0, 0];
    for (let i = 0; i < posA.getCount(); i++) {
      posA.getElement(i, v);
      P.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
      if (norA) {
        norA.getElement(i, v);
        const nx = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], ny = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], nz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        N.push(nx / l, ny / l, nz / l);
      } else N.push(0, 1, 0);
    }
    const material = prim.getMaterial();
    for (let t = 0; t < cnt; t += 3) {
      const g = (k) => base + (idxA ? idxA.getScalar(t + k) : t + k);
      TRI.push(g(0), g(1), g(2));
      triMat.push(material);
    }
  }
}
const nTri = TRI.length / 3;
console.log(`  ${nTri} triangles, ${P.length / 3} vertices`);

/* ---------------- 2. weld + connected pieces ---------------- */
const weldId = new Int32Array(P.length / 3);
{
  const map = new Map();
  for (let i = 0; i < weldId.length; i++) {
    const k = `${Math.round(P[i * 3] * 2000)},${Math.round(P[i * 3 + 1] * 2000)},${Math.round(P[i * 3 + 2] * 2000)}`;
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    weldId[i] = id;
  }
}
let nWeld = 0;
for (let i = 0; i < weldId.length; i++) if (weldId[i] >= nWeld) nWeld = weldId[i] + 1;
const par = Int32Array.from({ length: nWeld }, (_, i) => i);
const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
for (let t = 0; t < nTri; t++) {
  const a = find(weldId[TRI[t * 3]]);
  for (const k of [1, 2]) { const b = find(weldId[TRI[t * 3 + k]]); if (b !== a) par[b] = a; }
}
const pieces = new Map();
const triPiece = new Int32Array(nTri);
for (let t = 0; t < nTri; t++) {
  const c = find(weldId[TRI[t * 3]]);
  let o = pieces.get(c);
  if (!o) pieces.set(c, (o = { id: c, tris: [], mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity], mats: new Set() }));
  o.tris.push(t);
  o.mats.add(triMat[t].getName());
  for (let k = 0; k < 3; k++) {
    const vi = TRI[t * 3 + k];
    for (let a = 0; a < 3; a++) { o.mn[a] = Math.min(o.mn[a], P[vi * 3 + a]); o.mx[a] = Math.max(o.mx[a], P[vi * 3 + a]); }
  }
  triPiece[t] = c;
}
const list = [...pieces.values()];
for (const o of list) { o.c = o.mn.map((a, k) => (a + o.mx[k]) / 2); o.s = o.mn.map((a, k) => o.mx[k] - a); }
console.log(`  ${list.length} connected pieces`);

/* ---------------- 3. wheels ---------------- */
const tyres = list.filter((o) => o.mats.size === 1 && o.mats.has("Color_M07") && o.tris.length > 800 && o.tris.length < 1300 && o.mn[1] < 0.05 && o.s[1] > 0.5 && o.s[1] < 0.7 && o.s[0] < 0.3);
if (tyres.length !== 4) throw new Error(`expected 4 tyres, found ${tyres.length}`);
const carX = tyres.reduce((a, o) => a + o.c[0], 0) / 4;
const zMid = tyres.reduce((a, o) => a + o.c[2], 0) / 4;
const groundY = Math.min(...tyres.map((o) => o.mn[1]));
// model frame: the front of the car is at z = 0 (small z) and its RIGHT side is x > carX
const slot = (o) => (o.c[2] < zMid ? "F" : "R") + (o.c[0] > carX ? "R" : "L");
const biggest = list.reduce((a, o) => (o.tris.length > a.tris.length ? o : a), list[0]);
const wheelPieces = new Map(); // slot -> { tyre, pieces }
for (const ty of tyres) {
  const mine = list.filter((o) => o !== biggest && Math.abs(o.c[0] - ty.c[0]) < 0.16 && Math.hypot(o.c[1] - ty.c[1], o.c[2] - ty.c[2]) < 0.3 && o.s[1] < 0.7 && o.s[2] < 0.7);
  wheelPieces.set(slot(ty), { tyre: ty, pieces: mine });
}
console.log(`  wheels: ${[...wheelPieces].map(([s, w]) => `${s}=${w.pieces.length} pieces/${w.pieces.reduce((a, o) => a + o.tris.length, 0)} tris`).join("  ")}`);
const inWheel = new Set([...wheelPieces.values()].flatMap((w) => w.pieces.map((o) => o.id)));

/* ---------------- 4. into FolioCar space (front +Z, left +X, ground y = 0, wheelbase 2.4) ---------------- */
const zFront = (wheelPieces.get("FR").tyre.c[2] + wheelPieces.get("FL").tyre.c[2]) / 2;
const zRear = (wheelPieces.get("RR").tyre.c[2] + wheelPieces.get("RL").tyre.c[2]) / 2;
const SCALE = WHEELBASE_TARGET / (zRear - zFront);
const radius = (wheelPieces.get("FR").tyre.s[1] / 2) * SCALE;
// a half-turn about Y: x' = -(x - carX), z' = -(z - zMid); the model's right side becomes -x, its left +x
const toCar = (x, y, z) => [-(x - carX) * SCALE, (y - groundY) * SCALE, -(z - zMid) * SCALE];
const wheelX = Math.abs(toCar(...wheelPieces.get("FR").tyre.c)[0]);
const wheelY = toCar(...wheelPieces.get("FR").tyre.c)[1];
const frontZ = toCar(...wheelPieces.get("FR").tyre.c)[2];
const rearZ = toCar(...wheelPieces.get("RR").tyre.c)[2];
console.log(`  scale ${SCALE.toFixed(4)}  wheel radius ${radius.toFixed(4)}  wheel x ${wheelX.toFixed(4)}  wheel y ${wheelY.toFixed(4)}  axles z ${frontZ.toFixed(3)} / ${rearZ.toFixed(3)}`);

/* ---------------- 5. paint ---------------- */
const blueMat = mat("Color_I08");
blueMat.setName("body").setBaseColorFactor(BODY_WHITE).setMetallicFactor(0).setRoughnessFactor(0.3);
const tyreMat = doc.createMaterial("tyre").setBaseColorFactor(TYRE_BLACK).setMetallicFactor(0).setRoughnessFactor(0.92);
const rimMat = doc.createMaterial("rim").setBaseColorFactor(RIM_SILVER).setMetallicFactor(0.4).setRoughnessFactor(0.28); // partly metallic: fully metallic reads black without an environment map
const isRimMat = (m) => m.getName().startsWith("Color_M01"); // the near-white material of the source's alloy rims (only used on wheel pieces here)
const tailMat = doc.createMaterial("tail_lens").setBaseColorFactor(TAIL_RED).setMetallicFactor(0).setRoughnessFactor(0.15);
const lensSrc = mat("auto_7"); // grey lamp / mirror lens material of the source
const isRearLens = (t) => {
  if (triMat[t] !== lensSrc) return false;
  let z = 0, y = 0;
  for (let k = 0; k < 3; k++) { z += P[TRI[t * 3 + k] * 3 + 2]; y += P[TRI[t * 3 + k] * 3 + 1]; }
  return z / 3 > 3.5 && y / 3 > 0.8;
};

{
  const cnt = new Map();
  for (const w of wheelPieces.values()) for (const o of w.pieces) for (const t of o.tris) { const n = o === w.tyre ? "(tyre)" : isRimMat(triMat[t]) ? "(rim -> silver)" : triMat[t].getName(); cnt.set(n, (cnt.get(n) ?? 0) + 1); }
  console.log(`  wheel materials (triangles): ${[...cnt].map(([n, c]) => `${n}=${c}`).join(", ")}`);
}

/* ---------------- builders ---------------- */
function build(triList, { origin, mirror }) {
  const byMat = new Map();
  for (const { t, m } of triList) {
    let g = byMat.get(m);
    if (!g) byMat.set(m, (g = { pos: [], nor: [], idx: [] }));
    const tri = [TRI[t * 3], TRI[t * 3 + 1], TRI[t * 3 + 2]];
    if (mirror) [tri[1], tri[2]] = [tri[2], tri[1]];
    for (const vi of tri) {
      const [x, y, z] = origin(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
      const nx = -N[vi * 3], ny = N[vi * 3 + 1], nz = -N[vi * 3 + 2];
      g.idx.push(g.pos.length / 3);
      g.pos.push(mirror ? -x : x, y, z);
      g.nor.push(mirror ? -nx : nx, ny, nz);
    }
  }
  return byMat;
}

const bodyTris = [];
for (let t = 0; t < nTri; t++) {
  if (inWheel.has(triPiece[t])) continue;
  const m = triMat[t] === blueMat ? blueMat : isRearLens(t) ? tailMat : triMat[t];
  bodyTris.push({ t, m });
}
const bodyGroups = build(bodyTris, { origin: toCar, mirror: false });

// the wheels are built from the model's RIGHT wheels (proper alloy rims); the left ones are their mirror images
const wheelGroups = {};
for (const row of ["F", "R"]) {
  const w = wheelPieces.get(row + "R");
  const c = w.tyre.c;
  const trisW = [];
  for (const o of w.pieces) for (const t of o.tris) trisW.push({ t, m: o === w.tyre ? tyreMat : isRimMat(triMat[t]) ? rimMat : triMat[t] });
  const local = (x, y, z) => [-(x - c[0]) * SCALE, (y - c[1]) * SCALE, -(z - c[2]) * SCALE];
  wheelGroups[row + "R"] = build(trisW, { origin: local, mirror: false });
  wheelGroups[row + "L"] = build(trisW, { origin: local, mirror: true });
}

/* measurements for FolioCar.tsx: tail lamp lens, tail pipe */
const bbox = (arr) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); } return { mn, mx }; };
const lens = bodyGroups.get(tailMat);
if (lens) {
  for (const sgn of [1, -1]) {
    const pts = [];
    for (let i = 0; i < lens.pos.length; i += 3) if (Math.sign(lens.pos[i]) === sgn) pts.push(lens.pos[i], lens.pos[i + 1], lens.pos[i + 2]);
    const b = bbox(pts);
    console.log(`  tail lens ${sgn > 0 ? "left (+x)" : "right (-x)"}: x ${b.mn[0].toFixed(3)}..${b.mx[0].toFixed(3)}  y ${b.mn[1].toFixed(3)}..${b.mx[1].toFixed(3)}  z ${b.mn[2].toFixed(3)}..${b.mx[2].toFixed(3)}  centre (${((b.mn[0] + b.mx[0]) / 2).toFixed(3)}, ${((b.mn[1] + b.mx[1]) / 2).toFixed(3)})`);
  }
}
const pipe = list.filter((o) => o.c[2] > 3.8 && o.c[1] < 0.45 && o.c[0] < carX - 0.3 && o.c[0] > carX - 0.7 && o.s[2] < 0.5 && o.s[1] < 0.2 && o.tris.length > 100 && o !== biggest && !inWheel.has(o.id));
if (pipe.length) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const o of pipe) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], o.mn[k]); mx[k] = Math.max(mx[k], o.mx[k]); }
  const a = toCar(mn[0], mn[1], mn[2]), b = toCar(mx[0], mx[1], mx[2]);
  console.log(`  tail pipe (${pipe.length} pieces): x ${Math.min(a[0], b[0]).toFixed(3)}..${Math.max(a[0], b[0]).toFixed(3)}  y ${a[1].toFixed(3)}..${b[1].toFixed(3)}  z ${Math.min(a[2], b[2]).toFixed(3)}..${Math.max(a[2], b[2]).toFixed(3)}`);
}
{
  const b = bbox(bodyGroups.get(blueMat).pos);
  console.log(`  body paint extent: x ${b.mn[0].toFixed(3)}..${b.mx[0].toFixed(3)}  y ${b.mn[1].toFixed(3)}..${b.mx[1].toFixed(3)}  z ${b.mn[2].toFixed(3)}..${b.mx[2].toFixed(3)}`);
}

/* ---------------- 6. rebuild the scene ---------------- */
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
for (const a of root.listAccessors()) a.dispose();
for (const sc of root.listScenes()) for (const c of sc.listChildren()) sc.removeChild(c);
const buffer = root.listBuffers()[0] ?? doc.createBuffer();
const acc = (arr, type, Ctor) => doc.createAccessor().setArray(Ctor.from(arr)).setType(type).setBuffer(buffer);
const meshFrom = (name, groups) => {
  const mesh = doc.createMesh(name);
  for (const [m, g] of groups) {
    mesh.addPrimitive(
      doc.createPrimitive()
        .setAttribute("POSITION", acc(g.pos, "VEC3", Float32Array))
        .setAttribute("NORMAL", acc(g.nor, "VEC3", Float32Array))
        .setIndices(acc(g.idx, "SCALAR", Uint32Array))
        .setMaterial(m)
    );
  }
  return mesh;
};

const car = doc.createNode("Clio").setExtras({ forward: "+Z", up: "+Y", scale: SCALE, wheelRadius: radius, wheelbase: WHEELBASE_TARGET, wheelCenterX: wheelX });
car.addChild(doc.createNode("Body").setMesh(meshFrom("Body", bodyGroups)));
// FL / RL are on the car's left (+x); FR / RR on the right (-x)
for (const name of ["FL", "FR", "RL", "RR"]) {
  const wheel = doc.createNode(`Wheel_${name}`).setMesh(meshFrom(`Wheel_${name}`, wheelGroups[name]));
  const c = [name[1] === "L" ? wheelX : -wheelX, wheelY, name[0] === "F" ? frontZ : rearZ];
  if (name[0] === "F") {
    const pivot = doc.createNode(`Steer_${name}`).setTranslation(c);
    pivot.addChild(wheel);
    car.addChild(pivot);
  } else {
    wheel.setTranslation(c);
    car.addChild(wheel);
  }
}
scene.addChild(car);

await doc.transform(prune());
await doc.transform(weld(), dedup(), prune());
const countTris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
const before = countTris();
if (SIMPLIFY_RATIO < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: 0.0015, lockBorder: false }));
const after = countTris();
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
console.log(`wrote ${OUT}  (${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB)  triangles ${before} -> ${after}`);

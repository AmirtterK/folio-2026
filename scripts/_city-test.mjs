import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import ts from "typescript";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

const root = process.cwd();
const out = process.env.TEMP + "\\citytest";
fs.mkdirSync(out, { recursive: true });

// transpile the two pure modules
for (const f of ["trackCollision", "cityLayout"]) {
  let src = fs.readFileSync(path.join(root, "components", f + ".ts"), "utf8");
  src = src.replace(/@\/components\/trackCollision/g, "./trackCollision.mjs");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  fs.writeFileSync(path.join(out, f + ".mjs"), js);
}
const tc = await import("file:///" + out.replace(/\\/g, "/") + "/trackCollision.mjs");
const cl = await import("file:///" + out.replace(/\\/g, "/") + "/cityLayout.mjs");

// track centre line (same points + curve as buildMonzaGeometry)
const rt = fs.readFileSync(path.join(root, "components", "RacingTrack.tsx"), "utf8");
const block = rt.slice(rt.indexOf("const points = ["), rt.indexOf("const curve = new THREE.CatmullRomCurve3"));
const pts = [...block.matchAll(/new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g)].map((m) => new THREE.Vector3(+m[1], +m[2], +m[3]));
const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
const sp = curve.getSpacedPoints(480).slice(0, 480);
const field = new tc.TrackField(sp.map((p) => ({ x: p.x, z: p.z })));
console.log("track points", pts.length, "samples", sp.length);

// model dims
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const dims = {};
for (const d of cl.SOURCES) {
  const doc = await io.read(path.join(root, "public/models/examples", d.file));
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const size = b.max.map((m, i) => m - b.min[i]);
  const quarter = size[2] > size[0] * 1.15;
  const s0 = d.length / Math.max(size[0], size[2]);
  dims[d.id] = { rawHeight: size[1], quarter, s0, w0: (quarter ? size[2] : size[0]) * s0, d0: (quarter ? size[0] : size[2]) * s0 };
  console.log(d.id.padEnd(8), "raw", size.map((n) => n.toFixed(1)).join("x"), "-> w", dims[d.id].w0.toFixed(1), "d", dims[d.id].d0.toFixed(1), "h", (size[1] * s0).toFixed(1));
}

const t0 = Date.now();
const placed = cl.layoutCity(field, dims);
console.log("layout ms", Date.now() - t0, "buildings", placed.length);
const counts = {};
placed.forEach((p) => (counts[p.src] = (counts[p.src] ?? 0) + 1));
console.log("per model", counts);

// 1. do buildings intrude into the drivable corridor?
let bad = 0;
for (const p of placed) {
  const c = Math.cos(p.box.yaw), s = Math.sin(p.box.yaw);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 4; j++) {
    const lx = (i / 5 - 1) * p.box.hw, lz = (j / 2 - 1) * p.box.hd;
    const x = p.box.x + c * lx + s * lz, z = p.box.z - s * lx + c * lz;
    const m = field.nearest(x, z);
    if (field.inside(x, z) || m.d < tc.TRACK_WALL_DISTANCE - 0.01) bad++;
  }
}
console.log("footprint points inside corridor/infield:", bad);

// 2. gaps along the wall
const gaps = cl.wallGaps(field, placed, 1.5);
console.log("uncovered wall samples (1.5 apart):", gaps.length);

// 3. wall integrity: drive a circle outward from every track sample along the outward normal, expect a push
tc.setTrackCorridor(field);
let leaks = 0, tested = 0;
for (let i = 0; i < 480; i += 2) {
  const a = sp[i], b = sp[(i + 1) % 480];
  const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
  for (const sgn of [-1, 1]) {
    const nx = (-tz / l) * sgn, nz = (tx / l) * sgn;
    const x = a.x + nx * 40, z = a.z + nz * 40; // far outside on this side
    if (field.inside(x, z)) continue; // that's the infield side
    tested++;
    const hit = tc.worldCollide(x, z, 1.2);
    if (!hit || field.nearest(x + hit[0], z + hit[1]).d > tc.TRACK_WALL_DISTANCE) { if (!hit) leaks++; }
  }
}
console.log("wall: tested", tested, "points 40 units out, not pushed:", leaks);
// start grid and some infield points must be free
for (const [x, z] of [[30.15, 57.15], [-18, 38], [8, 40], [6, 42], [-52, 28], [60, 43]]) console.log("free at", x, z, "=", tc.worldCollide(x, z, 1.2) === null);

// raster map
const W = 1200, H = 800, sc = 3.1, ox = 600, oz = 330; // px = ox + x*sc, py = oz + z*sc
const img = Buffer.alloc(W * H * 3, 24);
const put = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const k = (y * W + x) * 3; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; };
const colors = { cyber: [220, 70, 200], future: [80, 200, 220], modern: [120, 140, 255], tower: [240, 200, 80], chicago: [220, 120, 70], asian: [230, 90, 90], neon: [255, 60, 220] };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const wx = (x - ox) / sc, wz = (y - oz) / sc;
  const m = field.nearest(wx, wz);
  if (m.d < 7) put(x, y, [90, 90, 95]);
  else if (field.inside(wx, wz)) put(x, y, [40, 55, 40]);
  else if (m.d < tc.TRACK_WALL_DISTANCE) put(x, y, [60, 60, 40]);
}
for (const p of placed) {
  const c = Math.cos(p.box.yaw), s = Math.sin(p.box.yaw);
  for (let i = -p.box.hw; i <= p.box.hw; i += 0.3) for (let j = -p.box.hd; j <= p.box.hd; j += 0.3) {
    const x = p.box.x + c * i + s * j, z = p.box.z - s * i + c * j;
    const edge = Math.abs(j) > p.box.hd - 0.5;
    const col = colors[p.src];
    put(ox + x * sc, oz + z * sc, j > p.box.hd - 0.8 ? [255, 255, 255] : col);
  }
}
// png
const crc = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = 0xffffffff; for (const v of b) c = t[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(path.join(out, "city.png"), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("map ->", path.join(out, "city.png"));

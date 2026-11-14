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


const results = [];
const N = Number(process.env.SEEDS || 150);
for (let seed = 1; seed <= N; seed++) {
  const placed = cl.layoutCity(field, dims, seed);
  const counts = {};
  placed.forEach((p) => (counts[p.src] = (counts[p.src] ?? 0) + 1));
  // anything inside the corridor/infield? (must be zero)
  let bad = 0;
  for (const p of placed) {
    const c = Math.cos(p.box.yaw), sn = Math.sin(p.box.yaw);
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) {
      const lx = (i / 3 - 1) * p.box.hw, lz = (j - 1) * p.box.hd;
      const x = p.box.x + c * lx + sn * lz, z = p.box.z - sn * lx + c * lz;
      if (field.inside(x, z) || field.nearest(x, z).d < tc.TRACK_WALL_DISTANCE - 0.01) bad++;
    }
  }
  const gaps = cl.wallGaps(field, placed, 1.5).length;
  results.push({ seed, n: placed.length, gaps, bad, counts });
}
const ok = results.filter((r) => r.bad === 0 && (r.counts.neon ?? 0) >= 2 && (r.counts.neon ?? 0) <= 5);
ok.sort((a, b) => a.gaps - b.gaps);
console.log("scanned", N, "seeds,", ok.length, "valid with 2-5 neon rows");
for (const r of ok.slice(0, 8)) console.log("seed", String(r.seed).padStart(4), "gaps", String(r.gaps).padStart(3), "buildings", r.n, JSON.stringify(r.counts));
const all = results.map((r) => r.gaps).sort((a, b) => a - b);
console.log("gaps over all seeds: min", all[0], "median", all[all.length >> 1], "max", all[all.length - 1]);

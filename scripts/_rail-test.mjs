import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as THREE from "three";
const root = process.cwd();
const out = process.env.TEMP + "\\railtest";
fs.mkdirSync(out, { recursive: true });
for (const f of ["trackCollision", "railLayout"]) {
  let src = fs.readFileSync(path.join(root, "components", f + ".ts"), "utf8");
  src = src.replace(/@\/components\/trackCollision/g, "./trackCollision.mjs");
  fs.writeFileSync(path.join(out, f + ".mjs"), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const tc = await import("file:///" + out.replace(/\\/g, "/") + "/trackCollision.mjs");
const rl = await import("file:///" + out.replace(/\\/g, "/") + "/railLayout.mjs");
const rt = fs.readFileSync(path.join(root, "components", "RacingTrack.tsx"), "utf8");
const block = rt.slice(rt.indexOf("const points = ["), rt.indexOf("const curve = new THREE.CatmullRomCurve3"));
const pts = [...block.matchAll(/new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g)].map((m) => new THREE.Vector3(+m[1], +m[2], +m[3]));
const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
const sp = curve.getSpacedPoints(480).slice(0, 480);
const field = new tc.TrackField(sp.map((p) => ({ x: p.x, z: p.z })));
tc.setTrackCorridor(field); tc.setTrackRail(field);

const segs = rl.layoutRails(field);
console.log("rail modules", segs.length, "len min/max", Math.min(...segs.map(s=>s.len)).toFixed(2), Math.max(...segs.map(s=>s.len)).toFixed(2));
const inGap = segs.filter(s => s.x > tc.INFIELD_GAP.x0 && s.x < tc.INFIELD_GAP.x1 && Math.abs(s.z - 57.15) < 14);
console.log("modules near the opening:", inGap.length, "(z values:", [...new Set(inGap.map(s => Math.round(s.z)))].join(","), ") -> should only be the outer side z~64");
const cones = rl.coneLayout(); console.log("cones", cones.length, "x", cones[0].x.toFixed(1), "..", cones.at(-1).x.toFixed(1), "z", cones[0].z.toFixed(2));

// drive a car (r = 1.2) outward from every track sample, both sides, with the push-out applied each step
let escapedRoad = 0, tested = 0, throughGap = 0;
for (let i = 0; i < 480; i += 2) {
  const a = sp[i], b = sp[(i + 1) % 480], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
  for (const sgn of [-1, 1]) {
    const nx = (-tz / l) * sgn, nz = (tx / l) * sgn;
    let x = a.x, z = a.z;
    for (let k = 0; k < 90; k++) { // 0.4 units per frame (a bit faster than top speed)
      x += nx * 0.4; z += nz * 0.4;
      const h = tc.worldCollide(x, z, 1.2);
      if (h) { x += h[0]; z += h[1]; }
    }
    tested++;
    const m = field.nearest(x, z);
    const inside = field.inside(x, z);
    const viaGap = inside && tc.inInfieldGap(a.x, a.z);
    if (m.d > 7.4 && !viaGap) escapedRoad++;
    if (m.d > 7.4 && viaGap) throughGap++;
  }
}
console.log("probes", tested, "| ended outside the barrier (not via the opening):", escapedRoad, "| went through the opening:", throughGap);

// infield must stay free once you are in it, and the cone mouth must be open for the car
for (const [x, z] of [[40, 40], [20, 38], [-30, 15], [0, 45], [60, 42]]) console.log("infield free at", x, z, "=", tc.worldCollide(x, z, 1.2) === null || tc.worldCollide(x, z, 1.2));
// drive straight into the opening from the road: z 57 -> 40 at x = 38
let x = 38, z = 57.15, hit = 0;
for (let k = 0; k < 60; k++) { z -= 0.4; const h = tc.worldCollide(x, z, 1.2); if (h) { hit++; console.log("  blocked at z", z.toFixed(2), "push", h.map(v => v.toFixed(2)).join(","), "inside", field.inside(x, z), "d", field.nearest(x, z).d.toFixed(2)); x += h[0]; z += h[1]; } }
console.log("drive into the opening at x=38: ended z =", z.toFixed(1), "blocked frames", hit);
// same but at x = 80 (outside the opening) must be stopped
x = 80; z = 57.15; for (let k = 0; k < 60; k++) { z -= 0.4; const h = tc.worldCollide(x, z, 1.2); if (h) { x += h[0]; z += h[1]; } }
console.log("drive at the barrier at x=80: ended z =", z.toFixed(1), "(road edge ~50.15)");

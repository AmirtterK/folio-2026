/**
 * Prepares the city models for use as many repeated instances:
 *  - merges meshes that share a material (draw calls), welds + simplifies the heavy ones (triangles),
 *  - shrinks textures to WebP (download size + GPU memory),
 *  - cuts the row of neon houses out of stylized_neon_japanese_city.glb (drops the road, lamps, poles, wires, cones).
 * Originals are copied to scripts/_orig_models/ the first time.
 *
 * usage: node scripts/optimize-city-models.mjs [path to stylized_neon_japanese_city.glb]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune, weld, simplify, textureCompress, getBounds } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

await MeshoptSimplifier.ready;
const DIR = "public/models/examples/";
const ORIG = "scripts/_orig_models/";
fs.mkdirSync(ORIG, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const stats = (doc) => {
  let prims = 0, tris = 0;
  doc.getRoot().listMeshes().forEach((m) => m.listPrimitives().forEach((p) => {
    prims++; const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3;
  }));
  return `${prims} prims, ${Math.round(tris)} tris, ${doc.getRoot().listTextures().length} tex`;
};

async function optimise(doc, { ratio = 1, tex = 512 }) {
  const steps = [dedup(), flatten(), join(), prune()];
  if (ratio < 1) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.03 }), prune());
  steps.push(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 80 }), prune());
  await doc.transform(...steps);
}

const MODELS = [
  { file: "cyberpunk_sci_fi_building.glb", ratio: 0.12, tex: 512 },
  { file: "futuristic_low_poly_building.glb", ratio: 0.4, tex: 512 },
  { file: "modern_night_building.glb", ratio: 1, tex: 512 },
  { file: "game_ready_city_buildings.glb", ratio: 1, tex: 256 },
  { file: "realistic_chicago_buildings.glb", ratio: 0.7, tex: 512 },
  { file: "asian_themed_low_poly_night_city_buildings.glb", ratio: 1, tex: 512 },
];

for (const m of MODELS) {
  const src = DIR + m.file;
  const bak = ORIG + m.file;
  if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);
  const doc = await io.read(bak); // always start from the original, so the script can be re-run
  const before = stats(doc);
  await optimise(doc, m);
  await io.write(src, doc);
  console.log(m.file.padEnd(46), before, "->", stats(doc), "|", (fs.statSync(bak).size / 1e6).toFixed(2), "->", (fs.statSync(src).size / 1e6).toFixed(2), "MB");
}

// ---- the neon house row ----
const neonSrc = process.argv[2] || "C:/Users/LENOVO/Downloads/stylized_neon_japanese_city.glb";
if (fs.existsSync(neonSrc)) {
  const doc = await io.read(neonSrc);
  const scene = doc.getRoot().listScenes()[0];
  const DROP = /^(Plane|StreetLight|telegraph|Traffic|Electrical|Metal|Cone)/;
  let kept = 0, dropped = 0;
  const visit = (n) => {
    const nm = n.getName();
    if (/_\d+$/.test(nm) || /^(Cube|Build|Sign|Another|Luxuries|Cylinder|Plane|above)/.test(nm)) {
      let drop = DROP.test(nm);
      if (!drop) { try { const b = getBounds(n); drop = (b.min[2] + b.max[2]) / 2 > 11; } catch { drop = true; } }
      if (drop) { n.dispose(); dropped++; } else kept++;
      return;
    }
    n.listChildren().forEach(visit);
  };
  scene.listChildren().forEach(visit);
  console.log("neon row: kept", kept, "dropped", dropped);
  await doc.transform(prune());
  const before = stats(doc);
  await optimise(doc, { ratio: 1, tex: 512 });
  const b = getBounds(doc.getRoot().listScenes()[0]);
  console.log("neon row bounds min", b.min.map((v) => v.toFixed(1)).join(","), "max", b.max.map((v) => v.toFixed(1)).join(","));
  await io.write(DIR + "neon_row.glb", doc);
  console.log("neon_row.glb", before, "->", stats(doc), (fs.statSync(DIR + "neon_row.glb").size / 1e6).toFixed(2), "MB");
}

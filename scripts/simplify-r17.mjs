#!/usr/bin/env node
/**
 * simplify-r17.mjs: makes a light copy of the Renault R17 for real-time use.
 *
 *   node scripts/simplify-r17.mjs [ratio] [error]
 *
 * Input:  scripts/r17/r17.full-backup.glb   (the full 579k-triangle car built by build-r17.mjs; never overwritten)
 * Output: public/models/r17.glb             (what the game loads)
 *
 * Node names (R17 > Body / Steer_* / Wheel_*) and material names are untouched, so ToyCarSmoke keeps working.
 * Mesh borders are locked so the paint / glass / trim parts never open cracks between each other.
 * To go back to the full car:  copy scripts/r17/r17.full-backup.glb over public/models/r17.glb
 */
import { NodeIO } from "@gltf-transform/core";
import { weld, simplify, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import fs from "node:fs";

const RATIO = Number(process.argv[2] ?? 0.12); // keep this fraction of the triangles
const ERROR = Number(process.argv[3] ?? 0.004); // max deviation, as a fraction of each mesh's size
const IN = "scripts/r17/r17.full-backup.glb";
const OUT = "public/models/r17.glb";

const count = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .reduce(
      (n, m) =>
        n +
        m.listPrimitives().reduce((k, p) => {
          const idx = p.getIndices();
          return k + (idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3;
        }, 0),
      0
    );

await MeshoptSimplifier.ready;
const io = new NodeIO();
const doc = await io.read(IN);
const before = count(doc);

await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR, lockBorder: true }),
  prune()
);

await io.write(OUT, doc);
const after = count(doc);
console.log(`triangles ${before} -> ${after}  (${((after / before) * 100).toFixed(1)}%)`);
console.log(`file ${(fs.statSync(IN).size / 1048576).toFixed(1)} MB -> ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
for (const m of doc.getRoot().listMeshes()) {
  const t = m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  console.log(`  ${m.getName().padEnd(16)} ${t}`);
}

/**
 * Optimises the Sketchfab building models for use as repeated props:
 * merges every static mesh that shares a material into one primitive (hundreds of draw calls -> a handful),
 * de-duplicates accessors/textures, prunes unused data, and converts .gltf (+ .bin + textures) to a single .glb.
 *
 * usage: node scripts/optimize-building-glb.mjs <input .gltf|.glb> <output .glb>
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune } from "@gltf-transform/functions";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/optimize-building-glb.mjs <input> <output.glb>");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const count = () => {
  const r = doc.getRoot();
  let prims = 0;
  r.listMeshes().forEach((m) => (prims += m.listPrimitives().length));
  return `${r.listNodes().length} nodes, ${prims} primitives, ${r.listMaterials().length} materials`;
};
console.log("before:", count());
await doc.transform(dedup(), flatten(), join(), prune());
console.log("after: ", count());
await io.write(output, doc);
console.log("wrote", output);

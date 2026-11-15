/**
 * EXPERIMENT: writes compressed copies of every model the scene uses into public/models-opt/ (same relative paths as
 * public/models/). The originals are never modified or deleted.
 *
 * Per model: dedup + prune, textures -> WebP capped at MAX_TEX px, then mesh quantization + Meshopt compression
 * (loaded by three's GLTFLoader through the Meshopt decoder, which drei's useGLTF enables by default).
 * Node names, hierarchy and materials are left alone, so the cars' named parts keep working.
 *
 * usage: node scripts/optimize-all-models.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import draco3d from "draco3dgltf";

const SRC = "public/models/";
const OUT = "public/models-opt/";
const MAX_TEX = 1024;

const FILES = [
  "sf90.glb",
  "ferrari_f599.glb",
  "porsche_panamera.glb",
  "corvette_stingray.glb",
  "nissan_silvia_s15.glb",
  // coffeemat.glb and gmail_mailbox.glb are left out on purpose: coffeemat only shrinks ~6% (and its bounds came out wrong), gmail is
  // already Draco-compressed (1.2 MB) and Meshopt makes it bigger
  "examples/cyberpunk_sci_fi_building.glb",
  "examples/futuristic_low_poly_building.glb",
  "examples/modern_night_building.glb",
  "examples/game_ready_city_buildings.glb",
  "examples/realistic_chicago_buildings.glb",
  "examples/asian_themed_low_poly_night_city_buildings.glb",
  "examples/neon_row.glb",
  "examples/linkedin.glb",
  "examples/ricoh_printer.glb",
  "examples/low_poly_tire_fixed.glb",
  "examples/simple_collection_of_low_poly_street_lights.glb",
];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });

const mb = (n) => (n / 1e6).toFixed(2);
let totalBefore = 0;
let totalAfter = 0;

for (const rel of FILES) {
  const src = SRC + rel;
  const dst = OUT + rel;
  if (!fs.existsSync(src)) {
    console.log("missing, skipped:", rel);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    const doc = await io.read(src);
    // a Draco-compressed source (gmail_mailbox.glb) is written uncompressed first, then compressed with Meshopt
    doc.getRoot().listExtensionsUsed().filter((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME).forEach((e) => e.dispose());
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }), // keepLeaves: never drop empty/named nodes the code might look up by name
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [MAX_TEX, MAX_TEX], quality: 85 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    await io.write(dst, doc);
    const b = fs.statSync(src).size;
    const a = fs.statSync(dst).size;
    totalBefore += b;
    totalAfter += a;
    console.log(rel.padEnd(58), mb(b).padStart(6), "->", mb(a).padStart(6), "MB");
  } catch (e) {
    console.log("FAILED:", rel, "-", e.message);
  }
}
console.log("-".repeat(80));
console.log("total".padEnd(58), mb(totalBefore).padStart(6), "->", mb(totalAfter).padStart(6), "MB");

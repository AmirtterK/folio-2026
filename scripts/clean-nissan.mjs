import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

const SRC = "C:/Users/LENOVO/Downloads/custom_nissan_silvia_s15.glb";
const OUT = "public/models/nissan_silvia_s15.glb";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

console.log("extensions:", root.listExtensionsUsed().map((e) => e.extensionName).join(", ") || "(none)");
console.log("nodes:", root.listNodes().length);

for (const name of ["Spoiler", "Hood Stock"]) {
  const matches = root.listNodes().filter((n) => n.getName() === name);
  console.log(`removing "${name}":`, matches.length);
  for (const node of matches) node.dispose();
}

await prune(doc);
await io.write(OUT, doc);

const check = await io.read(OUT);
const remaining = check
  .getRoot()
  .listNodes()
  .map((n) => n.getName())
  .filter((n) => n === "Spoiler" || n === "Hood Stock");
console.log("remaining floating nodes:", remaining.length);

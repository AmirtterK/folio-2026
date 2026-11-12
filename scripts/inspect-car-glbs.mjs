import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as THREE from "three";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const files = process.argv.slice(2);
const fmt = (v) => (v ? Array.from(v).map((n) => +n.toFixed(3)).join(", ") : "");

function accessorBounds(accessor) {
  if (!accessor) return null;
  try {
    const min = accessor.getMin();
    const max = accessor.getMax();
    if (min && max) return { min: Array.from(min), max: Array.from(max) };
  } catch {}
  const arr = accessor.getArray();
  if (!arr) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = arr[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

for (const file of files) {
  console.log("\n==================================================");
  console.log(file);
  console.log("==================================================");
  const doc = await io.read(file);
  const root = doc.getRoot();

  for (const tex of root.listTextures()) {
    console.log(`TEXTURE ${tex.getName() || "(unnamed)"} uri=${tex.getURI() || "(embedded)"}`);
  }

  const walk = (node, depth, parentMatrix) => {
    const pad = "  ".repeat(depth);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.getTranslation()),
      new THREE.Quaternion().fromArray(node.getRotation()),
      new THREE.Vector3().fromArray(node.getScale())
    );
    const world = parentMatrix.clone().multiply(local);
    const origin = new THREE.Vector3().setFromMatrixPosition(world);
    const mesh = node.getMesh();
    console.log(
      `${pad}NODE ${node.getName() || "(unnamed)"} worldOrigin=[${fmt(origin.toArray())}]${mesh ? ` mesh=${mesh.getName() || "(unnamed)"}` : ""}`
    );
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        const b = accessorBounds(pos);
        let worldMin = null;
        let worldMax = null;
        let center = null;
        let size = null;
        if (b) {
          const mn = new THREE.Vector3().fromArray(b.min);
          const mx = new THREE.Vector3().fromArray(b.max);
          worldMin = new THREE.Vector3(Infinity, Infinity, Infinity);
          worldMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
          for (let i = 0; i < 8; i++) {
            const p = new THREE.Vector3(
              i & 1 ? mx.x : mn.x,
              i & 2 ? mx.y : mn.y,
              i & 4 ? mx.z : mn.z
            ).applyMatrix4(world);
            worldMin.min(p);
            worldMax.max(p);
          }
          center = worldMin.clone().add(worldMax).multiplyScalar(0.5);
          size = worldMax.clone().sub(worldMin);
        }
        console.log(
          `${pad}  PRIM mat=${prim.getMaterial()?.getName() || "(none)"} verts=${pos?.getCount() ?? 0} center=[${fmt(center?.toArray())}] size=[${fmt(size?.toArray())}]`
        );
      }
    }
    for (const child of node.listChildren()) walk(child, depth + 1, world);
  };

  for (const scene of root.listScenes()) {
    console.log(`SCENE ${scene.getName() || "(unnamed)"}`);
    for (const node of scene.listChildren()) walk(node, 1, new THREE.Matrix4());
  }
}

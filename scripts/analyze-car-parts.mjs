import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = process.argv.slice(2);

function componentsOf(positions, indices) {
  const n = positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < indices.length; i += 3) {
    union(indices[i], indices[i + 1]);
    union(indices[i], indices[i + 1]);
    union(indices[i + 1], indices[i + 2]);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()];
}

for (const file of files) {
  console.log("\n==================================================");
  console.log(file);
  const doc = await io.read(file);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute("POSITION");
      const idxAcc = prim.getIndices();
      if (!posAcc) continue;
      const positions = posAcc.getArray();
      const indices = idxAcc ? idxAcc.getArray() : Array.from({ length: posAcc.getCount() }, (_, i) => i);
      const groups = componentsOf(positions, indices);
      const rows = [];
      for (const group of groups) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const i of group) {
          const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        rows.push({
          verts: group.length,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          cz: (minZ + maxZ) / 2,
          sx: maxX - minX,
          sy: maxY - minY,
          sz: maxZ - minZ,
          minX, maxX, minY, maxY, minZ, maxZ,
        });
      }
      rows.sort((a, b) => a.cz - b.cz);
      console.log(`MESH ${mesh.getName()} prim ${prim.getMaterial()?.getName()} verts=${posAcc.getCount()} comps=${rows.length}`);
      for (const r of rows) {
        const fmt = (v) => v.toFixed(3);
        console.log(
          `  comp v=${String(r.verts).padStart(5)} c=[${fmt(r.cx)},${fmt(r.cy)},${fmt(r.cz)}] size=[${fmt(r.sx)},${fmt(r.sy)},${fmt(r.sz)}] x=[${fmt(r.minX)},${fmt(r.maxX)}] y=[${fmt(r.minY)},${fmt(r.maxY)}] z=[${fmt(r.minZ)},${fmt(r.maxZ)}]`
        );
      }
    }
  }
}

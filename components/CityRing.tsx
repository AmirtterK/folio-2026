"use client";

/**
 * CityRing: a continuous wall of buildings right behind the track barrier, all the way round the outside of
 * the circuit (the infield stays open). Together with the barrier and the corridor in trackCollision.ts it seals
 * the circuit: the car can't leave it, and the buildings stand flush against the edge of where it can drive.
 *
 * Where each building goes (and why the models are mixed the way they are) is in cityLayout.ts.
 * The Rapier colliders here only keep the pushable logos and tyres from rolling away; the car itself is stopped by
 * the barrier / corridor wall (trackCollision.ts).
 *
 * Performance: nothing here is cloned per building. Every mesh of every model is baked once into the model's own
 * centred frame and then drawn with InstancedMesh, split into spatial chunks so the ones outside the camera view
 * are culled. Mirrored copies use a pre-mirrored geometry (a negative scale would turn instanced faces inside out).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { groundHeight } from "@/components/Terrain";
import { usePhysics, isWorldFreed } from "@/components/PhysicsProvider";
import type { TrackField } from "@/components/trackCollision";
import { SOURCES, layoutCity } from "@/components/cityLayout";
import { setOcclusionBoxes, clearOcclusionBoxes } from "@/components/cameraOcclusion";
import type { CityPlacement, ModelDims, SourceDef, SourceId } from "@/components/cityLayout";

const MODELS = "/models/examples/";

/** One constant array so the preload and the component share a single cache entry (useGLTF keys on the whole list). */
const MODEL_URLS = SOURCES.map((d) => MODELS + d.file);

/** Side of a culling chunk in world units. Bigger = fewer draw calls, smaller = more culling. */
const CELL = 90;
/** Models with more primitives than this are not mirrored and not split into chunks (either would multiply their draw calls). */
const MIRROR_MAX_PRIMS = 6;

type Part = { geometry: THREE.BufferGeometry; mirrored: THREE.BufferGeometry | null; material: THREE.Material };
type Prepared = { parts: Part[]; dims: ModelDims; mirrorable: boolean };

/** Swap two vertices of every triangle so the faces point the other way. */
function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index;
  if (idx) {
    const a = idx.array as unknown as Uint16Array | Uint32Array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  } else {
    const n = g.getAttribute("position").count;
    const a = new Uint32Array(n);
    for (let i = 0; i + 2 < n; i += 3) {
      a[i] = i;
      a[i + 1] = i + 2;
      a[i + 2] = i + 1;
    }
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
}

/** A copy of `g` mirrored across the plane x = 0 (or z = 0), with the winding fixed so it still faces outward. */
function mirrorGeometry(g: THREE.BufferGeometry, axis: "x" | "z"): THREE.BufferGeometry {
  const m = g.clone();
  for (const name of ["position", "normal"]) {
    const a = m.getAttribute(name);
    if (!a) continue;
    for (let i = 0; i < a.count; i++) {
      if (axis === "x") a.setX(i, -a.getX(i));
      else a.setZ(i, -a.getZ(i));
    }
    a.needsUpdate = true;
  }
  flipWinding(m);
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

/**
 * Centre the model on x/z, stand it on y = 0 and bake every mesh into that frame. The footprint maths is the same
 * as before (see cityLayout.ts): `s0` scales the longest side to the model's `length`.
 */
function prepare(scene: THREE.Object3D, def: SourceDef): Prepared {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const base = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);

  const quarter = size.z > size.x * 1.15;
  const s0 = def.length / Math.max(size.x, size.z, 1e-3);

  const parts: Part[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const full = new THREE.Matrix4().multiplyMatrices(base, mesh.matrixWorld);
    const g = mesh.geometry.clone();
    g.applyMatrix4(full);
    if (full.determinant() < 0) flipWinding(g); // a negatively scaled node: keep the faces pointing outward
    g.computeBoundingBox();
    g.computeBoundingSphere();
    parts.push({ geometry: g, mirrored: null, material: mat });
  });

  const mirrorable = parts.length <= MIRROR_MAX_PRIMS;
  if (mirrorable) for (const p of parts) p.mirrored = mirrorGeometry(p.geometry, quarter ? "z" : "x");

  return {
    parts,
    mirrorable,
    dims: {
      rawHeight: size.y,
      quarter,
      s0,
      w0: (quarter ? size.z : size.x) * s0,
      d0: (quarter ? size.x : size.z) * s0,
    },
  };
}

/** One InstancedMesh: one primitive of one model, for the buildings of one culling chunk. */
function InstancedPart({
  geometry,
  material,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere(); // so the whole chunk can be frustum-culled
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={false} receiveShadow={false} />;
}

type Chunk = { key: string; src: SourceId; mirrored: boolean; matrices: THREE.Matrix4[] };

export default function CityRing({ field }: { field: TrackField }) {
  const gltfs = useGLTF(MODEL_URLS) as unknown as { scene: THREE.Object3D }[];
  const { world } = usePhysics();

  const prepared = useMemo(() => {
    const out = {} as Record<SourceId, Prepared>;
    SOURCES.forEach((d, i) => {
      out[d.id] = prepare(gltfs[i].scene, d);
    });
    return out;
  }, [gltfs]);

  // the baked geometries are ours (clones), so we free them; the materials belong to the cached glTF
  useEffect(
    () => () => {
      Object.values(prepared).forEach((p) =>
        p.parts.forEach((part) => {
          part.geometry.dispose();
          part.mirrored?.dispose();
        })
      );
    },
    [prepared]
  );

  const placements = useMemo(() => {
    const dims = {} as Record<SourceId, ModelDims>;
    SOURCES.forEach((d) => (dims[d.id] = prepared[d.id].dims));
    const list = layoutCity(field, dims);
    const counts: Record<string, number> = {};
    list.forEach((p) => (counts[p.src] = (counts[p.src] ?? 0) + 1));
    console.info(`[city] ${list.length} buildings around the track`, counts);
    return list;
  }, [field, prepared]);

  const chunks = useMemo(() => {
    const map = new Map<string, Chunk>();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const p of placements as CityPlacement[]) {
      const prep = prepared[p.src];
      const mirrored = p.mirror === -1 && prep.mirrorable;
      // few-primitive models are chunked by region so the chunks out of view get culled; the many-primitive ones
      // (cyberpunk, neon, future) are one set each, because their draw calls would multiply with every chunk
      const cx = prep.mirrorable ? Math.floor(p.x / CELL) : 0;
      const cz = prep.mirrorable ? Math.floor(p.z / CELL) : 0;
      const key = `${p.src}|${mirrored ? "m" : "n"}|${cx}|${cz}`;
      let ch = map.get(key);
      if (!ch) map.set(key, (ch = { key, src: p.src, mirrored, matrices: [] }));
      // same transform as before: position, turn to face the track, quarter turn for long models, size and height stretch
      pos.set(p.x, groundHeight(p.x, p.z), p.z);
      quat.setFromAxisAngle(up, p.yaw + (p.quarter ? Math.PI / 2 : 0));
      scale.set(p.sx, p.sy, p.sx);
      ch.matrices.push(new THREE.Matrix4().compose(pos, quat, scale));
    }
    const list = [...map.values()];
    let draws = 0;
    list.forEach((c) => (draws += prepared[c.src].parts.length));
    console.info(`[city] ${list.length} chunks, ${draws} instanced draws in total (only the chunks in view are drawn)`);
    return list;
  }, [placements, prepared]);

  // the camera uses the building boxes to stay out of them (see cameraOcclusion.ts)
  useEffect(() => {
    const list = (placements as CityPlacement[]).map((p) => ({
      x: p.x,
      y: groundHeight(p.x, p.z),
      z: p.z,
      hw: p.box.hw,
      hd: p.box.hd,
      h: p.h,
      yaw: p.yaw,
    }));
    setOcclusionBoxes(list);
    return () => clearOcclusionBoxes(list);
  }, [placements]);

  // the pushable logos and tyres can't roll out through the buildings (one fixed body, one collider per building)
  useEffect(() => {
    if (!world || isWorldFreed(world)) return;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const p of placements) {
      const half = Math.min(p.h, 14) / 2;
      const y = groundHeight(p.x, p.z);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.box.hw, half, p.box.hd)
          .setTranslation(p.x, y + half, p.z)
          .setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) }),
        body
      );
    }
    return () => {
      if (isWorldFreed(world)) return;
      try {
        world.removeRigidBody(body);
      } catch {}
    };
  }, [world, placements]);

  return (
    <group>
      {chunks.map((c) =>
        prepared[c.src].parts.map((part, i) => (
          <InstancedPart
            key={`${c.key}|${i}`}
            geometry={c.mirrored && part.mirrored ? part.mirrored : part.geometry}
            material={part.material}
            matrices={c.matrices}
          />
        ))
      )}
    </group>
  );
}

useGLTF.preload(MODEL_URLS);

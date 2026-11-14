"use client";

/**
 * Track furniture from the street model: the crash barrier along both edges of the road (one InstancedMesh, so
 * the whole lap costs a single draw call) and the pushable traffic cones in the opening to the infield.
 *
 * Collision: the car is stopped by `worldCollide` in trackCollision.ts (thin wall along the barrier line, open at
 * INFIELD_GAP). The Rapier colliders here only keep the pushable logos, tyres and cones from rolling through it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { groundHeight } from "@/components/Terrain";
import { usePhysics, isWorldFreed } from "@/components/PhysicsProvider";
import type { TrackField } from "@/components/trackCollision";
import { RAIL_MODULE_LENGTH, RAIL_SCALE, coneLayout, layoutRails } from "@/components/railLayout";
import railData from "@/components/trackAssets/rail.json";
import coneData from "@/components/trackAssets/cone.json";

/* ---------- barrier ---------- */

export function TrackRails({ field }: { field: TrackField }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { world } = usePhysics();
  const segs = useMemo(() => layoutRails(field), [field]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(railData.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(railData.normals, 3));
    g.setIndex(railData.indices);
    g.computeBoundingSphere();
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(0.5, 0.5, 0.52, THREE.LinearSRGBColorSpace),
        roughness: 0.5,
        metalness: 0.25,
        side: THREE.DoubleSide,
      }),
    []
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    segs.forEach((g, i) => {
      q.setFromAxisAngle(up, g.yaw);
      p.set(g.x, groundHeight(g.x, g.z), g.z);
      s.set(g.len / RAIL_MODULE_LENGTH, RAIL_SCALE, RAIL_SCALE);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = segs.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [segs]);

  // fixed colliders so the pushable props can't be shoved through the barrier
  useEffect(() => {
    if (!world || isWorldFreed(world)) return;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const half = (railData.height * RAIL_SCALE) / 2;
    for (const g of segs) {
      const y = groundHeight(g.x, g.z) + half;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(g.len / 2, half, 0.12)
          .setTranslation(g.x, y, g.z)
          .setRotation({ x: 0, y: Math.sin(g.yaw / 2), z: 0, w: Math.cos(g.yaw / 2) }),
        body
      );
    }
    return () => {
      if (isWorldFreed(world)) return;
      try {
        world.removeRigidBody(body);
      } catch {}
    };
  }, [world, segs]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(1, segs.length)]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    />
  );
}

/* ---------- pushable traffic cones ---------- */

const CONE_H: number = coneData.height;
const CONE_R: number = coneData.radius;

function PushableCone({
  x,
  z,
  yaw,
  geometry,
  material,
}: {
  x: number;
  z: number;
  yaw: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) {
  const outer = useRef<THREE.Group>(null);
  const tiltRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<RAPIER.RigidBody | null>(null);
  const { world } = usePhysics();
  const st = useRef({ fallen: false, tilt: 0, ax: 0, az: 1, axis: new THREE.Vector3(1, 0, 0), q: new THREE.Quaternion() });

  useEffect(() => {
    if (!world || isWorldFreed(world)) return;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, groundHeight(x, z) + CONE_H / 2, z)
        .setLinearDamping(3.2)
        .setAngularDamping(4)
    );
    body.setEnabledRotations(false, true, false, true);
    body.setEnabledTranslations(true, false, true, true); // slides on the ground, never sinks or floats
    world.createCollider(RAPIER.ColliderDesc.cylinder(CONE_H / 2, CONE_R * 0.85).setDensity(0.8), body);
    bodyRef.current = body;
    return () => {
      const b = bodyRef.current;
      bodyRef.current = null;
      if (b && !isWorldFreed(world)) {
        try {
          world.removeRigidBody(b);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const g = outer.current;
    const tg = tiltRef.current;
    if (!body || !g || !tg) return;
    if (isWorldFreed(world)) {
      bodyRef.current = null;
      return;
    }
    const t = body.translation();
    g.position.set(t.x, groundHeight(t.x, t.z) + CONE_H / 2, t.z);

    const s = st.current;
    const lv = body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (!s.fallen && speed > 2.2) {
      // knocked hard enough: it tips over away from whatever hit it and stays lying down
      s.fallen = true;
      s.ax = lv.x / speed;
      s.az = lv.z / speed;
      s.axis.set(s.az, 0, -s.ax);
    }
    const target = s.fallen ? Math.PI / 2 : 0;
    s.tilt += (target - s.tilt) * (1 - Math.exp(-11 * Math.min(delta, 0.05)));
    s.q.setFromAxisAngle(s.axis, s.tilt);
    tg.quaternion.copy(s.q);
    tg.position.set(0, -CONE_H / 2 + CONE_R * Math.sin(s.tilt), 0);
  });

  return (
    <group ref={outer} position={[x, groundHeight(x, z) + CONE_H / 2, z]}>
      <group ref={tiltRef} position={[0, -CONE_H / 2, 0]}>
        <mesh geometry={geometry} material={material} rotation={[0, yaw, 0]} />
      </group>
    </group>
  );
}

export function TrackCones() {
  const cones = useMemo(() => coneLayout(), []);

  // red body + white band merged into one mesh with vertex colours, so each cone is one draw call
  const geometry = useMemo(() => {
    const parts = [
      { d: coneData.body, color: new THREE.Color().setRGB(0.8, 0.02, 0.0, THREE.LinearSRGBColorSpace) },
      { d: coneData.band, color: new THREE.Color().setRGB(0.85, 0.85, 0.85, THREE.LinearSRGBColorSpace) },
    ];
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (const { d, color } of parts) {
      const base = pos.length / 3;
      pos.push(...d.positions);
      nor.push(...d.normals);
      for (let i = 0; i < d.positions.length / 3; i++) col.push(color.r, color.g, color.b);
      for (const k of d.indices) idx.push(k + base);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }, []);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }),
    []
  );

  return (
    <group>
      {cones.map((c, i) => (
        <PushableCone key={i} x={c.x} z={c.z} yaw={c.yaw} geometry={geometry} material={material} />
      ))}
    </group>
  );
}

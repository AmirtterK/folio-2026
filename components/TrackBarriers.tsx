"use client";

import { useMemo, useRef, useLayoutEffect } from "react";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";

/** Smooth perimeter control points enclosing the circuit, infield and outfield jump hills */
export const BARRIER_POINTS = [
  new THREE.Vector3(145, 0, 0),
  new THREE.Vector3(142, 0, 35),
  new THREE.Vector3(132, 0, 65),
  new THREE.Vector3(112, 0, 84),
  new THREE.Vector3(65, 0, 90),
  new THREE.Vector3(0, 0, 90),
  new THREE.Vector3(-65, 0, 90),
  new THREE.Vector3(-112, 0, 84),
  new THREE.Vector3(-132, 0, 65),
  new THREE.Vector3(-144, 0, 35),
  new THREE.Vector3(-146, 0, 0),
  new THREE.Vector3(-144, 0, -35),
  new THREE.Vector3(-132, 0, -65),
  new THREE.Vector3(-112, 0, -82),
  new THREE.Vector3(-65, 0, -88),
  new THREE.Vector3(0, 0, -88),
  new THREE.Vector3(65, 0, -88),
  new THREE.Vector3(112, 0, -82),
  new THREE.Vector3(132, 0, -65),
  new THREE.Vector3(142, 0, -35),
];

export type BarrierSegment = {
  x: number;
  y: number;
  z: number;
  rotY: number;
  len: number;
  color: THREE.Color;
};

const NUM_SEGMENTS = 200;

export function getBarrierSegments(): BarrierSegment[] {
  const curve = new THREE.CatmullRomCurve3(BARRIER_POINTS, true, "centripetal", 0.5);
  const pts = curve.getSpacedPoints(NUM_SEGMENTS);
  const segments: BarrierSegment[] = [];

  const red = new THREE.Color("#e11d48");
  const white = new THREE.Color("#f8fafc");

  for (let i = 0; i < NUM_SEGMENTS; i++) {
    const p = pts[i];
    const nextP = pts[(i + 1) % NUM_SEGMENTS];
    const dx = nextP.x - p.x;
    const dz = nextP.z - p.z;
    const len = Math.hypot(dx, dz);
    const rotY = Math.atan2(dx, dz);
    const y = groundHeight(p.x, p.z);

    // Alternating red and white sections (4 segments red, 4 segments white)
    const color = Math.floor(i / 3) % 2 === 0 ? red : white;

    segments.push({
      x: (p.x + nextP.x) * 0.5,
      y: y + 0.55,
      z: (p.z + nextP.z) * 0.5,
      rotY,
      len,
      color,
    });
  }

  return segments;
}

export function TrackBarriers() {
  const segments = useMemo(() => getBarrierSegments(), []);

  const railsRef = useRef<THREE.InstancedMesh>(null);
  const postsRef = useRef<THREE.InstancedMesh>(null);

  const railGeo = useMemo(() => new THREE.BoxGeometry(0.18, 0.65, 1), []);
  const postGeo = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), []);

  const railMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.45,
        metalness: 0.35,
      }),
    []
  );

  const postMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#27272a", // Dark galvanized post
        roughness: 0.65,
        metalness: 0.5,
      }),
    []
  );

  useLayoutEffect(() => {
    if (!railsRef.current || !postsRef.current) return;
    const dummy = new THREE.Object3D();

    segments.forEach((s, i) => {
      // Horizontal rail
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.scale.set(1, 1, s.len);
      dummy.updateMatrix();
      railsRef.current!.setMatrixAt(i, dummy.matrix);
      railsRef.current!.setColorAt(i, s.color);

      // Support post
      dummy.position.set(s.x, s.y - 0.05, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postsRef.current!.setMatrixAt(i, dummy.matrix);
    });

    railsRef.current.instanceMatrix.needsUpdate = true;
    if (railsRef.current.instanceColor) railsRef.current.instanceColor.needsUpdate = true;
    postsRef.current.instanceMatrix.needsUpdate = true;
  }, [segments]);

  return (
    <group>
      <instancedMesh
        ref={railsRef}
        args={[railGeo, railMat, segments.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={postsRef}
        args={[postGeo, postMat, segments.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
    </group>
  );
}

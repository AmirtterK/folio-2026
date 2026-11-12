"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";
import { KNIGHT_POS } from "@/components/landmarkConfig";
import HolographicMaterial, { type HolographicMaterialProps } from "@/components/HolographicMaterial";
import HologramBase, { HOLO_COLOR, LANDMARK_BASE_SIZE } from "@/components/HologramBase";

export { KNIGHT_POS };

type ChessKnightProps = {
  /** Night mode uses additive (glowing) blending; in daylight it falls back to normal blending so it stays visible. */
  night?: boolean;
  hologram?: HolographicMaterialProps;
};

const KNIGHT_SCALE = 1.25; // the piece is ~2.1 high, so about 2.6 world units on its base

/**
 * Holographic chess knight standing on the shared hologram plinth (see HologramBase), set on the road like
 * the achievement trophy. It is solid: Terrain registers it as a collider (see KNIGHT_POS in landmarkConfig).
 *
 * Piece: base + neck are a revolved profile (LatheGeometry), the head is an extruded 2D horse-head outline.
 * The piece faces +X in its own space; KNIGHT_POS.yaw turns it toward the oncoming cars.
 */
export default function ChessKnight({ night = true, hologram }: ChessKnightProps) {
  const spinRef = useRef<THREE.Group>(null);

  const y = groundHeight(KNIGHT_POS.x, KNIGHT_POS.z);

  const geos = useMemo(() => {
    // revolved base + body (x = radius, y = height)
    const profile = [
      [0.0, 0.0],
      [0.64, 0.0],
      [0.68, 0.04],
      [0.68, 0.14],
      [0.62, 0.2],
      [0.52, 0.24],
      [0.44, 0.28],
      [0.5, 0.32],
      [0.5, 0.37],
      [0.42, 0.42],
      [0.38, 0.5],
      [0.36, 0.62],
      [0.34, 0.74],
      [0.0, 0.74],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const body = new THREE.LatheGeometry(profile, 64);

    // horse head: 2D outline (x = forward, y = up), extruded with a bevel
    const pts: [number, number][] = [
      [-0.32, 0.0],
      [-0.36, 0.3],
      [-0.32, 0.62],
      [-0.24, 0.9],
      [-0.16, 1.1],
      [-0.12, 1.28],
      [-0.02, 1.36],
      [0.06, 1.2],
      [0.2, 1.08],
      [0.4, 0.88],
      [0.58, 0.66],
      [0.66, 0.52],
      [0.6, 0.4],
      [0.42, 0.42],
      [0.22, 0.46],
      [0.14, 0.34],
      [0.26, 0.16],
      [0.34, 0.0],
    ];
    const curve = new THREE.CatmullRomCurve3(
      pts.map(([x, h]) => new THREE.Vector3(x, h, 0)),
      true,
      "centripetal"
    );
    const outline = curve.getPoints(120).map((p) => new THREE.Vector2(p.x, p.y));
    const depth = 0.28;
    const head = new THREE.ExtrudeGeometry(new THREE.Shape(outline), {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.05,
      bevelSegments: 6,
      curveSegments: 48,
    });
    head.translate(0, 0, -depth / 2);
    head.computeVertexNormals();

    return {
      body,
      head,
      eye: new THREE.SphereGeometry(0.035, 16, 16),
      nostril: new THREE.SphereGeometry(0.022, 12, 12),
    };
  }, []);

  const eyeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), []);

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      eyeMat.dispose();
    },
    [geos, eyeMat]
  );

  useFrame((state) => {
    // slow turntable spin around the plinth, starting from the oncoming-car heading
    if (spinRef.current) spinRef.current.rotation.y = KNIGHT_POS.yaw + state.clock.elapsedTime * 0.5;
  });

  const holo = { hologramColor: HOLO_COLOR, hologramBrightness: 1.3, scanlineSize: 8, enableAdditive: night, ...hologram };

  return (
    <group position={[KNIGHT_POS.x, y, KNIGHT_POS.z]}>
      <HologramBase night={night} size={LANDMARK_BASE_SIZE} lightY={1.45}>
        {/* the knight, turning slowly */}
        <group ref={spinRef} scale={KNIGHT_SCALE}>
          <mesh geometry={geos.body}>
            <HolographicMaterial {...holo} />
          </mesh>
          <group position={[0, 0.7, 0]}>
            <mesh geometry={geos.head}>
              <HolographicMaterial {...holo} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} geometry={geos.eye} material={eyeMat} position={[0.3, 0.82, side * 0.2]} />
            ))}
            {[-1, 1].map((side) => (
              <mesh key={`n${side}`} geometry={geos.nostril} material={eyeMat} position={[0.62, 0.52, side * 0.14]} />
            ))}
          </group>
        </group>
      </HologramBase>
    </group>
  );
}

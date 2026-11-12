"use client";

import { useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/FolioCar";
import HolographicMaterial from "@/components/HolographicMaterial";
import { HOLO_COLOR } from "@/components/HologramBase";

type CarLoadingHologramProps = {
  /** The car's pose, so the orb sits exactly where the car will appear. */
  pose: MutableRefObject<CarPose>;
  visible?: boolean;
  night?: boolean;
};

/**
 * Holographic orb shown at the car's spawn point while a car model downloads.
 * It follows the pose ref and is swapped out for the real car once its GLB has mounted.
 */
export default function CarLoadingHologram({ pose, visible = true, night = true }: CarLoadingHologramProps) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    const g = group.current;
    if (g) {
      const p = pose.current;
      g.position.set(p.x, p.y + 1.3 + Math.sin(t * 1.7) * 0.07, p.z);
    }

    if (core.current) {
      core.current.rotation.y = t * 0.9;
      core.current.rotation.x = Math.sin(t * 0.6) * 0.35;
      core.current.scale.setScalar(0.94 + Math.sin(t * 3.1) * 0.06);
    }

    if (ringA.current) {
      ringA.current.rotation.z = t * 1.3;
      ringA.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.8) * 0.35;
    }
    if (ringB.current) {
      ringB.current.rotation.y = t * 0.9;
      ringB.current.rotation.x = Math.PI / 2.6;
    }
    if (ringC.current) {
      ringC.current.rotation.x = t * 0.7;
      ringC.current.rotation.y = Math.PI / 3;
    }
  });

  return (
    <group ref={group} visible={visible}>
      <pointLight color={HOLO_COLOR} intensity={night ? 26 : 9} distance={10} decay={2} />

      <group ref={core}>
        <mesh>
          <icosahedronGeometry args={[0.62, 1]} />
          <HolographicMaterial
            hologramColor={HOLO_COLOR}
            hologramBrightness={1.6}
            scanlineSize={8}
            enableAdditive={night}
          />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.3, 0]} />
          <meshBasicMaterial
            color="#eefdff"
            transparent
            opacity={0.45}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      {[
        { ref: ringA, r: 1.02, tube: 0.012 },
        { ref: ringB, r: 0.84, tube: 0.009 },
        { ref: ringC, r: 1.18, tube: 0.007 },
      ].map(({ ref, r, tube }, i) => (
        <mesh key={i} ref={ref}>
          <torusGeometry args={[r, tube, 8, 72]} />
          <meshBasicMaterial
            color={HOLO_COLOR}
            transparent
            opacity={0.7 - i * 0.15}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

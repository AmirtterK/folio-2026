"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

type LogoObstacleProps = {
  position: [number, number, number];
  color: string;
  label: string;
};

/** A simple 3D slab displaying a brand color + label, used as a drivable-into obstacle. */
export default function LogoObstacle({ position, color, label }: LogoObstacleProps) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.15;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.6, 1.6, 0.4]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
      </mesh>
      {/* label plane */}
    </group>
  );
}

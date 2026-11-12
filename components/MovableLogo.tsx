"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import type { ReactNode } from "react";
import type { CarPose } from "@/components/FolioCar";
import { groundHeight } from "@/components/Terrain";

type MovableLogoProps = {
  position: [number, number, number];
  pose: MutableRefObject<CarPose>;
  id: string;
  velocities: MutableRefObject<Record<string, THREE.Vector3>>;
  children: ReactNode;
};

export default function MovableLogo({ position, pose, id, velocities, children }: MovableLogoProps) {
  const ref = useRef<THREE.Group>(null);
  const base = useRef(new THREE.Vector3(position[0], groundHeight(position[0], position[2]) + 2.5, position[2]));

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const v = velocities.current[id] || new THREE.Vector3();
    velocities.current[id] = v;

    const car = pose.current;
    const dx = g.position.x - car.x;
    const dz = g.position.z - car.z;
    const dist = Math.hypot(dx, dz);
    const radius = 4.0;
    if (dist < radius && dist > 0.01) {
      const push = (radius - dist) * 40 + Math.abs(car.speed) * 3;
      v.x += (dx / dist) * push * dt;
      v.z += (dz / dist) * push * dt;
    }

    g.position.x += v.x * dt;
    g.position.z += v.z * dt;
    v.x *= 0.8;
    v.z *= 0.8;

    const sx = base.current.x - g.position.x;
    const sz = base.current.z - g.position.z;
    g.position.x += sx * 0.005;
    g.position.z += sz * 0.005;

    g.position.y = groundHeight(g.position.x, g.position.z) + 2.5;
    g.rotation.y += 0.3 * dt;
  });

  return (
    <group ref={ref} position={[position[0], groundHeight(position[0], position[2]) + 2.5, position[2]]} scale={1.0}>
      {children}
    </group>
  );
}

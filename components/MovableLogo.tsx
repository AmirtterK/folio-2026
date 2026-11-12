"use client";

import { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import RAPIER from "@dimforge/rapier3d-compat";
import type { ReactNode } from "react";
import { groundHeight } from "@/components/Terrain";
import { usePhysics } from "@/components/PhysicsProvider";

type MovableLogoProps = {
  position: [number, number, number];
  children: ReactNode;
};

export default function MovableLogo({ position, children }: MovableLogoProps) {
  const ref = useRef<THREE.Group>(null);
  const bodyRef = useRef<RAPIER.RigidBody | null>(null);
  const { world, registerLogo, unregisterLogo } = usePhysics();
  const idRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!world) return;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], groundHeight(position[0], position[2]) + 2.0, position[2])
        .setLinearDamping(2.5)
        .setAngularDamping(2.0)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.5, 0.5), body);
    bodyRef.current = body;
    registerLogo(idRef.current, body);
    return () => {
      if (bodyRef.current) {
        world.removeRigidBody(bodyRef.current);
        bodyRef.current = null;
      }
      unregisterLogo(idRef.current);
    };
  }, [world, position, registerLogo, unregisterLogo]);

  useFrame(() => {
    const body = bodyRef.current;
    const g = ref.current;
    if (!body || !g) return;
    const t = body.translation();
    const r = body.rotation();
    g.position.set(t.x, t.y, t.z);
    g.quaternion.set(r.x, r.y, r.z, r.w);
  });

  return (
    <group ref={ref} position={[position[0], groundHeight(position[0], position[2]) + 2.0, position[2]]}>
      {children}
    </group>
  );
}

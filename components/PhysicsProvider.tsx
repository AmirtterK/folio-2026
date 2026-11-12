"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/FolioCar";

type PhysicsCtx = {
  world: RAPIER.World | null;
  carBody: RAPIER.RigidBody | null;
  registerLogo: (id: string, body: RAPIER.RigidBody) => void;
  unregisterLogo: (id: string) => void;
  logoBodies: MutableRefObject<Map<string, RAPIER.RigidBody>>;
};

const PhysicsContext = createContext<PhysicsCtx>({
  world: null,
  carBody: null,
  registerLogo: () => {},
  unregisterLogo: () => {},
  logoBodies: { current: new Map() },
});

export function usePhysics() {
  return useContext(PhysicsContext);
}

export function PhysicsProvider({
  pose,
  children,
}: {
  pose: MutableRefObject<CarPose>;
  children: React.ReactNode;
}) {
  const worldRef = useRef<RAPIER.World | null>(null);
  const carBodyRef = useRef<RAPIER.RigidBody | null>(null);
  const logoBodiesRef = useRef<Map<string, RAPIER.RigidBody>>(new Map());
  const readyRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await RAPIER.init();
      if (!mounted) return;
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      worldRef.current = world;

      // car kinematic body
      const carBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.5, 2.0), carBody);
      carBodyRef.current = carBody;

      readyRef.current = true;
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useFrame(() => {
    const world = worldRef.current;
    const carBody = carBodyRef.current;
    if (!world || !carBody || !readyRef.current) return;

    // sync car body to pose
    const p = pose.current;
    carBody.setNextKinematicTranslation({ x: p.x, y: 0.5, z: p.z });
    carBody.setNextKinematicRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) });

    world.step();

    // sync logo bodies back to their meshes is handled by MovableLogo reading body translation
  });

  const ctx: PhysicsCtx = {
    world: worldRef.current,
    carBody: carBodyRef.current,
    registerLogo: (id, body) => logoBodiesRef.current.set(id, body),
    unregisterLogo: (id) => logoBodiesRef.current.delete(id),
    logoBodies: logoBodiesRef,
  };

  return <PhysicsContext.Provider value={ctx}>{children}</PhysicsContext.Provider>;
}

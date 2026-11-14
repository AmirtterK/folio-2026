"use client";

import { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import RAPIER from "@dimforge/rapier3d-compat";
import type { ReactNode } from "react";
import { groundHeight } from "@/components/Terrain";
import { usePhysics, isWorldFreed } from "@/components/PhysicsProvider";

// How the logos fall after a crash throws them up. World gravity is 0, so it is done by hand here.
// Slow, floaty gravity: a launched logo hangs for a few seconds, then drifts back down and lands softly.
const LOGO_GRAVITY = 4.5; // m/s^2 (~0.45 g)
const LOGO_MAX_FALL = 5; // m/s: fastest they ever fall (slow descent)
const LOGO_MAX_RISE = 14; // m/s: cap on how hard a crash can throw them upward
const LOGO_AIR_DRAG = 0.35; // 1/s: light drag on vertical motion so the throw stays floaty
const LOGO_SLIDE_DAMP = 2.5; // 1/s: horizontal friction (same value that used to be Rapier's linear damping)

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
    if (!world || isWorldFreed(world)) return;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], groundHeight(position[0], position[2]) + 2.0, position[2])
        .setLinearDamping(0) // damped by hand in useFrame: floaty vertically, grippy horizontally
        .setAngularDamping(2.0)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.5, 0.5), body);
    bodyRef.current = body;
    registerLogo(idRef.current, body);
    return () => {
      const b = bodyRef.current;
      bodyRef.current = null;
      // the provider frees the world before its children clean up: never touch a freed world (it traps the WASM)
      if (b && !isWorldFreed(world)) {
        try {
          world.removeRigidBody(b);
        } catch {
          /* world already gone */
        }
      }
      unregisterLogo(idRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const g = ref.current;
    if (!body || !g) return;
    if (isWorldFreed(world)) {
      bodyRef.current = null; // body belongs to a freed world (HMR / remount): stop touching it
      return;
    }
    const t = body.translation();
    const r = body.rotation();
    // constant slow fall (low gravity, frame-rate independent): thrown-up logos hang, then sink back down
    const dt = Math.min(delta, 0.05);
    const v = body.linvel();
    const vy = THREE.MathUtils.clamp((v.y - LOGO_GRAVITY * dt) * Math.exp(-LOGO_AIR_DRAG * dt), -LOGO_MAX_FALL, LOGO_MAX_RISE);
    const slide = Math.exp(-LOGO_SLIDE_DAMP * dt);
    body.setLinvel({ x: v.x * slide, y: vy, z: v.z * slide }, true);
    // clamp to terrain surface so they don't fall through
    const ground = groundHeight(t.x, t.z) + 2.0;
    if (t.y < ground) {
      body.setTranslation({ x: t.x, y: ground, z: t.z }, true);
      body.setLinvel({ x: body.linvel().x, y: 0, z: body.linvel().z }, true);
    }
    const tt = body.translation();
    const rr = body.rotation();
    g.position.set(tt.x, tt.y, tt.z);
    g.quaternion.set(rr.x, rr.y, rr.z, rr.w);
  });

  return (
    <group ref={ref} position={[position[0], groundHeight(position[0], position[2]) + 2.0, position[2]]}>
      {children}
    </group>
  );
}

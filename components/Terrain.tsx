"use client";

/**
 * Terrain: flat paved ground (no hills/trees/obstacles).
 * Exports keep the same API used by the car/camera/scene.
 */

import { useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { CarPose } from "@/components/FolioCar";
import { worldCollide } from "@/components/trackCollision";

const BASE = 0.02; // flat ground height

export function getTerrain() {
  return {
    height: (_x: number, _z: number) => BASE,
    grip: (_x: number, _z: number) => 0.55, // paving grip
    collide: worldCollide,
  };
}

export const groundHeight = (_x: number, _z: number) => BASE;
export const groundGrip = (_x: number, _z: number) => 0.55;
/** Solid things the car can't drive through: the invisible wall behind the track and the street lamps (see trackCollision.ts). */
export const groundCollide = (x: number, z: number, r: number): [number, number] | null => worldCollide(x, z, r);

export const TERRAIN_BOUNDS = {
  minX: -220,
  maxX: 220,
  minZ: -170,
  maxZ: 170,
};

/** Paving stones from the street model. One 1024px tile covers PAVING_TILE world units. */
const PAVING_TILE = 7.7;

function createPavingTexture(): THREE.Texture {
  const tex = new THREE.TextureLoader().load("/models/track/paving.jpg");
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(520 / PAVING_TILE, 420 / PAVING_TILE);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export function Terrain({ pose: _pose, radius: _radius = Infinity }: { pose?: MutableRefObject<CarPose>; radius?: number }) {
  const paving = useMemo(() => createPavingTexture(), []);

  return (
    <group>
      {/* paved ground (slightly below track surface to avoid z-fighting) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[520, 420]} />
        <meshStandardMaterial map={paving} roughness={0.9} metalness={0} color="#d6d6e0" />
      </mesh>
    </group>
  );
}

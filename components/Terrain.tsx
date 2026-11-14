"use client";

/**
 * Terrain: flat gravel ground (no hills/trees/obstacles).
 * Exports keep the same API used by the car/camera/scene.
 */

import { useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { CarPose } from "@/components/FolioCar";

const BASE = 0.02; // flat ground height

export function getTerrain() {
  return {
    height: (_x: number, _z: number) => BASE,
    grip: (_x: number, _z: number) => 0.55, // gravel-like grip
    collide: (_x: number, _z: number, _r: number): [number, number] | null => null,
  };
}

export const groundHeight = (_x: number, _z: number) => BASE;
export const groundGrip = (_x: number, _z: number) => 0.55;
export const groundCollide = (_x: number, _z: number, _r: number): [number, number] | null => null;

export const TERRAIN_BOUNDS = {
  minX: -220,
  maxX: 220,
  minZ: -170,
  maxZ: 170,
};

function createGravelTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8f8878";
  ctx.fillRect(0, 0, size, size);

  // speckled gravel
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.2;
    const t = 110 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${t}, ${t - 8}, ${t - 18}, ${0.25 + Math.random() * 0.45})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // larger pebbles
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 5;
    const t = 140 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${t}, ${t - 10}, ${t - 20}, 0.7)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Terrain({ pose: _pose, radius: _radius = Infinity }: { pose?: MutableRefObject<CarPose>; radius?: number }) {
  const gravel = useMemo(() => createGravelTexture(), []);

  return (
    <group>
      {/* flat gravel ground (slightly below track surface to avoid z-fighting) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[520, 420]} />
        <meshStandardMaterial map={gravel} roughness={1} metalness={0} color="#b8ae9a" />
      </mesh>
    </group>
  );
}

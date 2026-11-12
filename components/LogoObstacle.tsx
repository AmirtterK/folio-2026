import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/FolioCar";
import { groundHeight } from "@/components/Terrain";

type LogoObstacleProps = {
  position: [number, number, number];
  color: string;
  label?: string;
  pose: MutableRefObject<CarPose>;
  id: string;
  velocities: MutableRefObject<Record<string, THREE.Vector3>>;
};

export default function LogoObstacle({ position, color, label = "", pose, id, velocities }: LogoObstacleProps) {
  const ref = useRef<THREE.Group>(null);
  const base = useRef(new THREE.Vector3(position[0], groundHeight(position[0], position[2]) + 0.8, position[2]));

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
    const radius = 3.0;
    if (dist < radius && dist > 0.01) {
      const push = (radius - dist) * 14;
      v.x += (dx / dist) * push * dt;
      v.z += (dz / dist) * push * dt;
    }

    g.position.x += v.x * dt;
    g.position.z += v.z * dt;
    v.x *= 0.92;
    v.z *= 0.92;

    const sx = base.current.x - g.position.x;
    const sz = base.current.z - g.position.z;
    g.position.x += sx * 0.02;
    g.position.z += sz * 0.02;

    g.position.y = groundHeight(g.position.x, g.position.z) + 0.8;
    g.rotation.y += 0.3 * dt;
  });

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#000";
    ctx.font = "bold 120px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.charAt(0) || "?", 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [color, label]);

  return (
    <group ref={ref} position={[position[0], groundHeight(position[0], position[2]) + 0.8, position[2]]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.4, 2.4, 0.6]} />
        <meshStandardMaterial map={texture} roughness={0.3} metalness={0.2} />
      </mesh>
    </group>
  );
}

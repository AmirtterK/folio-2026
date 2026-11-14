// components/DiplomaLandmark.tsx
"use client";
import * as THREE from "three";
import { useMemo, useRef, useState } from "react";
import type { Group } from "three";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { DIPLOMA_POS, KEY_PROMPT_OFFSET_FROM_HOLOGRAM } from "@/components/landmarkConfig";
import HoloText from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";
import { DIPLOMA_LINES } from "@/components/landmarkProjects";

const HEIGHT = 2.88;  // diploma height in world units (+20%)
const THICK = 0.192;   // slab thickness (+20%)
const HOVER_LIFT = 2.2; // hover height above ground
const BOB_AMP = 0.18;   // levitation amplitude

type DiplomaLandmarkProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  night?: boolean;
  touch?: boolean;
  /** Temporary debug rotation override (radians) */
  debugRotation?: { x: number; y: number; z: number };
  /** Optional debug override for key prompt position (x,y,z) */
  promptPosition?: [number, number, number];
};

export default function DiplomaLandmark({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
  debugRotation,
  promptPosition,
}: DiplomaLandmarkProps) {
  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);
  const groupRef = useRef<Group>(null);
  const tex = useTexture("/images/diploma.jpg");
  const baseY = groundHeight(DIPLOMA_POS.x, DIPLOMA_POS.z) + HOVER_LIFT;

  const { w, h } = useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace; // older three: tex.encoding = THREE.sRGBEncoding
    tex.anisotropy = 16;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    const img = tex.image as HTMLImageElement;
    return { w: HEIGHT * (img.width / img.height), h: HEIGHT };
  }, [tex]);

  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: "#e8dcc4", roughness: 0.8 });
    const back = new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.9 });
    const front = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z (back)
    return [edge, edge, edge, edge, front, back];
  }, [tex]);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 1.6) * BOB_AMP;
    }
    const p = pose.current;
    if (p) {
      const dist = Math.hypot(p.x - DIPLOMA_POS.x, p.z - DIPLOMA_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  const rot = debugRotation ?? { x: 0, y: (Math.PI * 50) / 180, z: 0 };

  const holoAnchor: [number, number, number] = [w * 0.6 + 1.8, -1.0, 0.0];
  const promptPos: [number, number, number] = promptPosition ?? [
    holoAnchor[0] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[0],
    holoAnchor[1] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[1],
    holoAnchor[2] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[2],
  ];
  const textY = promptPos[1] - (0.9 + DIPLOMA_LINES.length * 0.16);
  const mobileVertical = !!touch && typeof window !== "undefined" && window.innerHeight > window.innerWidth;
  const textPos: [number, number, number] = mobileVertical ? [0, promptPos[1] - 0.8, 0] : [promptPos[0], textY, promptPos[2]];

  return (
    <group ref={groupRef} position={[DIPLOMA_POS.x, baseY, DIPLOMA_POS.z]}>
      {/* Rotated diploma model + hit area */}
      <group rotation={[rot.x, rot.y, rot.z]}>
        <mesh
          position={[0, 0, 0]}
          userData={{ landmark: "diploma" }}
          onClick={(e) => {
            if (isNear && !inspecting) {
              e.stopPropagation();
              onInspectToggle(true);
            }
          }}
        >
          <boxGeometry args={[Math.max(w + 0.8, 2.6), h + 0.8, 1.0]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh
          position={[0, 0, 0]}
          material={materials}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[w, h, THICK]} />
        </mesh>
      </group>

      {/* Text/prompt in world-aligned space (bobs with diploma) so it stays next to it, not behind */}
      <group position={textPos}>
        <HoloText lines={DIPLOMA_LINES} active={inspecting} night={night} mobile={touch} />
      </group>
      <HoloKeyPrompt
        active={isNear}
        visible={!inspecting}
        onActivate={() => onInspectToggle(true)}
        position={promptPos}
        night={night}
        touch={touch}
      />
    </group>
  );
}

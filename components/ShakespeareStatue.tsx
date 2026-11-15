"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { modelUrl } from "@/components/modelUrl";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { SHAKESPEARE_POS } from "@/components/landmarkConfig";
import HoloText from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";
import { SHAKESPEARE_LINES } from "@/components/landmarkProjects";
import { boxCircles, setCircleColliders, clearCircleColliders } from "@/components/trackCollision";

export { SHAKESPEARE_POS };

/**
 * The statue is 1.06 wide, 0.97 deep and 1.42 high (a seated Shakespeare on a bench). At 2.6x it is about 2.8 x 2.5 x 3.7
 * world units, a bit bigger than the printer. The depth feeds SHAKESPEARE_POS.z in landmarkConfig.ts (back of the bench
 * against the crash barrier), so change both together.
 */
const SHAKESPEARE_SCALE = 2.6;

type ShakespeareStatueProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  night?: boolean;
  touch?: boolean;
};

/**
 * Solid stone statue on the ground, like the printer and the mailbox: no hologram base. Only the writing is holographic.
 * It sits with its back to the south barrier (see SHAKESPEARE_POS) facing +z, so the normal inspect camera sees his
 * front and the text floats to the right of the statue.
 */
export default function ShakespeareStatue({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
}: ShakespeareStatueProps) {
  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);
  const y = groundHeight(SHAKESPEARE_POS.x, SHAKESPEARE_POS.z);

  const { scene } = useGLTF(modelUrl("/models/examples/william_shakespeare_statue.glb"));
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    // scale + rotation first, then centre on XZ and sit on the ground
    clone.scale.setScalar(SHAKESPEARE_SCALE);
    clone.rotation.set(0, SHAKESPEARE_POS.yaw, 0); // front (+z in the file) turned away from the barrier
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const fp = box.getSize(new THREE.Vector3());
    clone.userData.footprint = { x: fp.x, z: fp.z }; // for the solid collider below
    const center = new THREE.Vector3();
    box.getCenter(center);
    if (isFinite(box.min.y)) {
      clone.position.x -= center.x;
      clone.position.z -= center.z;
      clone.position.y -= box.min.y;
    }
    return clone;
  }, [scene]);

  // solid: the car can't drive through it
  useEffect(() => {
    const fp = model.userData.footprint as { x: number; z: number } | undefined;
    if (!fp) return;
    setCircleColliders("landmark-shakespeare", boxCircles(SHAKESPEARE_POS.x, SHAKESPEARE_POS.z, fp.x, fp.z));
    return () => clearCircleColliders("landmark-shakespeare");
  }, [model]);

  useFrame(() => {
    const p = pose.current;
    if (p) {
      const dist = Math.hypot(p.x - SHAKESPEARE_POS.x, p.z - SHAKESPEARE_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  // The inspect camera stands straight in front of the statue (+z of him, looking along -z; see makeFront in
  // FolioScene.tsx), so screen-right is world +x: the prompt and the writing float to his right. Text and prompt
  // billboard to the camera, so they face the viewer head-on.
  const promptPos: [number, number, number] = [2.4, 3.6, 0.6];
  const mobileVertical = !!touch && typeof window !== "undefined" && window.innerHeight > window.innerWidth;
  const textPos: [number, number, number] = mobileVertical ? [0, 2.6, 1.6] : [5.2, 1.0, 0.8];

  return (
    <group position={[SHAKESPEARE_POS.x, y, SHAKESPEARE_POS.z]}>
      {/* Interaction hit area around the statue */}
      <mesh
        position={[0, 2.0, 0]}
        userData={{ landmark: "shakespeare" }}
        onClick={(e) => {
          if (isNear && !inspecting) {
            e.stopPropagation();
            onInspectToggle(true);
          }
        }}
      >
        <sphereGeometry args={[3.2, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Plain statue model, grounded and centred, no hologram base */}
      <primitive object={model} />

      {/* Warm light in front of the statue (the side that faces the infield), so he isn't lost in the dark */}
      <pointLight
        position={[Math.sin(SHAKESPEARE_POS.yaw) * 4, 6.5, Math.cos(SHAKESPEARE_POS.yaw) * 4]}
        color="#ffe6c0"
        intensity={night ? 320 : 80}
        distance={26}
        decay={2}
      />

      {/* Inspect UI: holographic writing revealed beside the statue, key prompt above it */}
      <group position={textPos}>
        <HoloText lines={SHAKESPEARE_LINES} active={inspecting} night={night} mobile={touch} />
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

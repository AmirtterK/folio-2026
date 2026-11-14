"use client";

import { useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { GMAIL_POS } from "@/components/landmarkConfig";
import HoloText from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";
import { GMAIL_LINES } from "@/components/landmarkProjects";

export { GMAIL_POS };

type GmailInteractiveProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  night?: boolean;
  touch?: boolean;
};

export default function GmailInteractive({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
}: GmailInteractiveProps) {
  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);
  const y = groundHeight(GMAIL_POS.x, GMAIL_POS.z);

  const { scene } = useGLTF("/models/examples/gmail_mailbox.glb");
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    // Apply scale + rotation, then center on XZ and sit on the ground
    clone.scale.setScalar(1.2);
    clone.rotation.set(0, (Math.PI * 50) / 180, 0);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    if (isFinite(box.min.y)) {
      clone.position.x -= center.x;
      clone.position.z -= center.z;
      clone.position.y -= box.min.y;
    }
    return clone;
  }, [scene]);

  useFrame(() => {
    const p = pose.current;
    if (p) {
      const dist = Math.hypot(p.x - GMAIL_POS.x, p.z - GMAIL_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  return (
    <group position={[GMAIL_POS.x, y, GMAIL_POS.z]}>
      <mesh
        position={[0, 1.6, 0]}
        userData={{ landmark: "gmail" }}
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

      {/* Plain mailbox model, grounded/centered above the terrain */}
      <primitive object={model} />

      <group position={[2.6, 0.5, 0]}>
        <HoloText lines={GMAIL_LINES} active={inspecting} night={night} mobile={touch} />
      </group>
      <HoloKeyPrompt
        active={isNear}
        visible={!inspecting}
        onActivate={() => onInspectToggle(true)}
        position={[1.6, 2.2, 0]}
        night={night}
        touch={touch}
      />
    </group>
  );
}

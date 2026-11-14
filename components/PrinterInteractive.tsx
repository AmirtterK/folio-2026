"use client";

import { useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { PRINTER_POS, KEY_PROMPT_OFFSET_FROM_HOLOGRAM } from "@/components/landmarkConfig";
import HoloText from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";
import { PRINTER_LINES } from "@/components/landmarkProjects";

export { PRINTER_POS };

type PrinterInteractiveProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  night?: boolean;
  touch?: boolean;
};

export default function PrinterInteractive({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
}: PrinterInteractiveProps) {
  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);
  const y = groundHeight(PRINTER_POS.x, PRINTER_POS.z);

  const { scene } = useGLTF("/models/examples/ricoh_printer.glb");
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
    clone.scale.setScalar(3.0);
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
      const dist = Math.hypot(p.x - PRINTER_POS.x, p.z - PRINTER_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  const holoAnchor: [number, number, number] = [2.6, 0.5, 0];
  const promptPos: [number, number, number] = [
    holoAnchor[0] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[0],
    holoAnchor[1] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[1],
    holoAnchor[2] + KEY_PROMPT_OFFSET_FROM_HOLOGRAM[2],
  ];
  const textY = promptPos[1] - (0.7 + PRINTER_LINES.length * 0.16);

  return (
    <group position={[PRINTER_POS.x, y, PRINTER_POS.z]}>
      {/* Interaction hit area next to the model */}
      <mesh
        position={[0, 2.0, 0]}
        userData={{ landmark: "printer" }}
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

      {/* Plain printer model (2.5x, grounded/centered), no hologram base */}
      <primitive object={model} />

      {/* Inspect UI: prompt + text/link (interaction logic), text revealed at key position */}
      <group position={[promptPos[0], textY, promptPos[2]]}>
        <HoloText lines={PRINTER_LINES} active={inspecting} night={night} mobile={touch} />
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

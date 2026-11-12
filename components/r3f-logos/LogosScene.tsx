"use client";

import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Float, OrbitControls } from "@react-three/drei";
import type { ComponentType } from "react";
import * as Logos from "./index";
import type { LogoProps } from "./ExtrudedSvg";

const ENTRIES = Object.entries(Logos).filter(([name]) => name.endsWith("Logo")) as [
  string,
  ComponentType<LogoProps>
][];

const COLS = 6;
const GAP = 3;

export default function LogosScene() {
  const rows = Math.ceil(ENTRIES.length / COLS);
  return (
    <div style={{ width: "100%", height: "100vh", background: "#0b0b0c" }}>
      <Canvas shadows camera={{ position: [0, 0, 22], fov: 40 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 8]} intensity={2.2} castShadow />
        <Environment preset="city" />

        {ENTRIES.map(([name, Logo], i) => {
          const x = ((i % COLS) - (COLS - 1) / 2) * GAP;
          const y = (-Math.floor(i / COLS) + (rows - 1) / 2) * GAP;
          return (
            <Float key={name} speed={1.4} rotationIntensity={0.35} floatIntensity={0.5}>
              <Logo position={[x, y, 0]} size={2} />
            </Float>
          );
        })}

        <ContactShadows position={[0, -((rows * GAP) / 2) - 0.5, 0]} opacity={0.35} blur={2.5} scale={30} />
        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}

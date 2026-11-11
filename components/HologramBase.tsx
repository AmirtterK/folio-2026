"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export const HOLO_COLOR = "#5ec8ff";
/** Height of the top of the plinth; children are placed on it. */
export const PLINTH_TOP = 0.245;

/** Radar ping on the asphalt: rings leave the plinth, spread out, fade, then start again. */
const PING_COUNT = 3;
const PING_PERIOD = 3.2; // seconds for one ring to go out and fade
const PING_PEAK = 0.55;

/** Light the hologram throws (physical units, like the trophy's key light) */
const LIGHT_NIGHT = 22;
const LIGHT_DAY = 6;
const LIGHT_RANGE = 10;

type HologramBaseProps = {
  /** Night uses the full glow; in daylight the light is much dimmer. */
  night?: boolean;
  /** Width multiplier of the plinth (1 = 1.1 units). */
  size?: number;
  /** Radius where the radar rings start / are fully faded. Defaults follow the plinth size. */
  ringStart?: number;
  ringEnd?: number;
  /** Height of the light above the plinth top. */
  lightY?: number;
  /** Whatever stands on the plinth (placed at its top). */
  children?: ReactNode;
};

/**
 * Shared stand for the hologram landmarks: black plinth with gold trim, radar-ping rings on the asphalt
 * and a pulsing blue point light. Put it inside a group positioned on the ground.
 */
export default function HologramBase({
  night = true,
  size = 1,
  ringStart,
  ringEnd = 4.0,
  lightY = 1.7,
  children,
}: HologramBaseProps) {
  const pingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const r0 = ringStart ?? 0.75 * size;

  const geos = useMemo(
    () => ({
      plinth: new THREE.BoxGeometry(1.1, 0.16, 1.1),
      plinthTrim: new THREE.BoxGeometry(1.14, 0.03, 1.14),
      plinthTop: new THREE.BoxGeometry(0.96, 0.06, 0.96),
      // unit-radius thin ring, scaled outward each frame for the radar ping
      ping: new THREE.RingGeometry(0.94, 1, 96),
    }),
    []
  );

  const mats = useMemo(
    () => ({
      plinth: new THREE.MeshStandardMaterial({ color: "#101116", roughness: 0.25, metalness: 0.35 }),
      trim: new THREE.MeshStandardMaterial({
        color: "#f2b630",
        emissive: new THREE.Color("#8a4b08"),
        emissiveIntensity: 0.3,
        roughness: 0.28,
        metalness: 0.8,
      }),
      // one material per ring so each can fade on its own
      pings: Array.from(
        { length: PING_COUNT },
        () =>
          new THREE.MeshBasicMaterial({
            color: HOLO_COLOR,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          })
      ),
    }),
    []
  );

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      [mats.plinth, mats.trim, ...mats.pings].forEach((m) => m.dispose());
    },
    [geos, mats]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // light from the projector: brightest as a ping leaves, then eases off, with the same tiny flicker as the hologram
    if (lightRef.current) {
      const sincePing = (t / (PING_PERIOD / PING_COUNT)) % 1;
      let flick = 1 - 0.07 * Math.abs(Math.sin(t * 47) * Math.sin(t * 13));
      if (Math.sin(t * 3.1) > 0.985) flick *= 0.8;
      lightRef.current.intensity = (night ? LIGHT_NIGHT : LIGHT_DAY) * (0.8 + 0.2 * (1 - sincePing)) * flick;
    }

    // radar ping: each ring goes out from the plinth, fades, and restarts; rings are staggered
    for (let i = 0; i < PING_COUNT; i++) {
      const ring = pingRefs.current[i];
      if (!ring) continue;
      const p = (((t / PING_PERIOD + i / PING_COUNT) % 1) + 1) % 1; // 0 (just emitted) -> 1 (gone)
      const s = r0 + (ringEnd - r0) * (1 - Math.pow(1 - p, 2)); // fast out, slows as it spreads
      ring.scale.set(s, s, 1);
      const fadeIn = Math.min(1, p / 0.08); // no pop at the start
      const fadeOut = Math.pow(1 - p, 1.6);
      mats.pings[i].opacity = PING_PEAK * fadeIn * fadeOut;
    }
  });

  return (
    <group>
      {/* radar ping rings on the asphalt */}
      {mats.pings.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            pingRefs.current[i] = el;
          }}
          geometry={geos.ping}
          material={m}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.04 + i * 0.002, 0]}
          renderOrder={2}
        />
      ))}

      {/* cool blue light cast by the hologram onto the road and nearby cars */}
      <pointLight
        ref={lightRef}
        position={[0, PLINTH_TOP + lightY, 0]}
        color={HOLO_COLOR}
        intensity={LIGHT_NIGHT}
        distance={LIGHT_RANGE}
        decay={2}
      />

      {/* black plinth with gold trim */}
      <group scale={[size, 1, size]}>
        <mesh geometry={geos.plinth} material={mats.plinth} position={[0, 0.08, 0]} castShadow receiveShadow />
        <mesh geometry={geos.plinthTrim} material={mats.trim} position={[0, 0.17, 0]} />
        <mesh geometry={geos.plinthTop} material={mats.plinth} position={[0, 0.215, 0]} />
      </group>

      {/* the hologram itself */}
      <group position={[0, PLINTH_TOP, 0]}>{children}</group>
    </group>
  );
}

"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export const HOLO_COLOR = "#5ec8ff";
/** Height of the projector's top dish at size 1 (where the hologram / trophy stands); it grows a little with `size`. */
export const PLINTH_TOP = 0.75;
/** Radius of the projector's foot at size 1. */
export const PLINTH_RADIUS = 0.44;
/** Standard footprint of every landmark projector, so all the holograms sit on the same base. */
export const LANDMARK_BASE_SIZE = 2.1;

/** World height of the projector dish for a given base size (children are placed here). */
export const hologramBaseTop = (size = LANDMARK_BASE_SIZE) => PLINTH_TOP * (1 + (size - 1) * 0.4);

/** Radar ping on the asphalt: rings leave the projector, spread out, fade, then start again. */
const PING_COUNT = 3;
const PING_PERIOD = 3.2; // seconds for one ring to go out and fade
const PING_PEAK = 0.55;

/** Light the hologram throws (physical units, like the trophy's key light) */
const LIGHT_NIGHT = 22;
const LIGHT_DAY = 6;
const LIGHT_RANGE = 10;

const SLIT_COUNT = 8;
const BODY_PROFILE: [number, number][] = [
  // foot flange
  [0, 0],
  [0.44, 0],
  [0.44, 0.03],
  [0.41, 0.05],
  [0.41, 0.09],
  // step into the slim column
  [0.36, 0.1],
  [0.34, 0.14],
  [0.33, 0.6],
  // flare out into the projector dish
  [0.35, 0.66],
  [0.4, 0.71],
  [0.44, 0.73],
  [0.44, 0.77],
  [0.405, 0.77],
  [0.38, PLINTH_TOP],
  [0, PLINTH_TOP],
];

type HologramBaseProps = {
  /** Night uses the full glow; in daylight the light is much dimmer. */
  night?: boolean;
  /** Width multiplier of the projector; defaults to the shared landmark size (1.85 wide, 1.08 high). */
  size?: number;
  /** Radius where the radar rings start / are fully faded. Defaults follow the projector size. */
  ringStart?: number;
  ringEnd?: number;
  /** Height of the light above the projector top. */
  lightY?: number;
  /** Radar-ping rings on the asphalt (default on). */
  pings?: boolean;
  /** Blue point light thrown by the hologram (default on). */
  light?: boolean;
  /** Faint projector beam rising from the dish (default on). */
  beam?: boolean;
  /** Height of the projector beam above the dish. */
  beamHeight?: number;
  /** Whatever stands on / floats above the projector (placed at its top). */
  children?: ReactNode;
};

/** Vertical fade for the projector beam: bright at the dish, gone at the top. */
function createBeamGradient(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,0.65)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Shared hologram projector for the landmarks: a slim, tall round pedestal in black metal with gold rings,
 * glowing blue light slits, and a glowing emitter dish on top, plus radar-ping rings on the asphalt, a pulsing
 * blue point light and a faint beam. Put it inside a group positioned on the ground.
 */
export default function HologramBase({
  night = true,
  size = LANDMARK_BASE_SIZE,
  ringStart,
  ringEnd = 4.0,
  lightY = 1.7,
  pings = true,
  light = true,
  beam = true,
  beamHeight = 1.6,
  children,
}: HologramBaseProps) {
  const pingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const r0 = ringStart ?? (PLINTH_RADIUS + 0.03) * size;
  // the projector widens with `size` and gets a little taller, so a big piece still sits on a sensible-looking base
  const sy = 1 + (size - 1) * 0.4;
  const top = hologramBaseTop(size);

  const geos = useMemo(() => {
    const ring = (r: number, t: number) => new THREE.TorusGeometry(r, t, 8, 72);
    return {
      body: new THREE.LatheGeometry(BODY_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)), 72),
      goldRing: ring(0.357, 0.012),
      lipRing: ring(0.405, 0.01),
      footGlow: ring(0.412, 0.009),
      bandGlow: ring(0.337, 0.009),
      emitterRing: ring(0.3, 0.01),
      emitterDisc: new THREE.CircleGeometry(0.3, 64),
      slit: new THREE.BoxGeometry(0.014, 0.3, 0.05),
      // unit-radius thin ring, scaled outward each frame for the radar ping
      ping: new THREE.RingGeometry(0.94, 1, 96),
    };
  }, []);

  const beamGeo = useMemo(
    () => new THREE.CylinderGeometry(0.46 * size, 0.3 * size, beamHeight, 56, 1, true),
    [size, beamHeight]
  );

  const mats = useMemo(
    () => ({
      plinth: new THREE.MeshStandardMaterial({ color: "#14161c", roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }),
      trim: new THREE.MeshStandardMaterial({
        color: "#f2b630",
        emissive: new THREE.Color("#8a4b08"),
        emissiveIntensity: 0.3,
        roughness: 0.28,
        metalness: 0.8,
      }),
      glow: new THREE.MeshBasicMaterial({ color: HOLO_COLOR, toneMapped: false }),
      emitter: new THREE.MeshBasicMaterial({
        color: HOLO_COLOR,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
      beam: new THREE.MeshBasicMaterial({
        map: createBeamGradient(),
        color: HOLO_COLOR,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
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
      [mats.plinth, mats.trim, mats.glow, mats.emitter, ...mats.pings].forEach((m) => m.dispose());
      mats.beam.map?.dispose();
      mats.beam.dispose();
    },
    [geos, mats]
  );

  useEffect(() => () => beamGeo.dispose(), [beamGeo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // the same tiny flicker as the hologram: constant jitter plus an occasional brief dip
    let flick = 1 - 0.07 * Math.abs(Math.sin(t * 47) * Math.sin(t * 13));
    if (Math.sin(t * 3.1) > 0.985) flick *= 0.8;

    // emitter dish breathes, the beam follows it
    mats.emitter.opacity = (0.42 + 0.16 * Math.sin(t * 2.2)) * flick;
    mats.beam.opacity = (night ? 0.2 : 0.12) * (0.85 + 0.15 * Math.sin(t * 2.2)) * flick;

    // light from the projector: brightest as a ping leaves, then eases off
    if (lightRef.current) {
      const sincePing = (t / (PING_PERIOD / PING_COUNT)) % 1;
      lightRef.current.intensity = (night ? LIGHT_NIGHT : LIGHT_DAY) * (0.8 + 0.2 * (1 - sincePing)) * flick;
    }

    // radar ping: each ring goes out from the projector, fades, and restarts; rings are staggered
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

  const flat: [number, number, number] = [Math.PI / 2, 0, 0];

  return (
    <group>
      {/* radar ping rings on the asphalt */}
      {pings &&
        mats.pings.map((m, i) => (
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
      {light && (
        <pointLight
          ref={lightRef}
          position={[0, top + lightY, 0]}
          color={HOLO_COLOR}
          intensity={LIGHT_NIGHT}
          distance={LIGHT_RANGE}
          decay={2}
        />
      )}

      {/* the projector: round black pedestal, gold rings, blue light slits, glowing emitter dish */}
      <group scale={[size, sy, size]}>
        <mesh geometry={geos.body} material={mats.plinth} castShadow receiveShadow />

        <mesh geometry={geos.footGlow} material={mats.glow} position={[0, 0.07, 0]} rotation={flat} />
        <mesh geometry={geos.goldRing} material={mats.trim} position={[0, 0.105, 0]} rotation={flat} />
        <mesh geometry={geos.bandGlow} material={mats.glow} position={[0, 0.56, 0]} rotation={flat} />
        <mesh geometry={geos.goldRing} material={mats.trim} position={[0, 0.66, 0]} rotation={flat} />
        <mesh geometry={geos.lipRing} material={mats.trim} position={[0, 0.772, 0]} rotation={flat} />

        {/* vertical light slits around the column (offset so none sits at +x, where the trophy's lens is) */}
        {Array.from({ length: SLIT_COUNT }, (_, k) => {
          const a = ((k + 0.5) / SLIT_COUNT) * Math.PI * 2;
          return (
            <mesh
              key={k}
              geometry={geos.slit}
              material={mats.glow}
              position={[Math.cos(a) * 0.337, 0.36, Math.sin(a) * 0.337]}
              rotation={[0, -a, 0]}
            />
          );
        })}

        {/* emitter dish on top: glowing disc inside a gold ring */}
        <mesh geometry={geos.emitterDisc} material={mats.emitter} position={[0, PLINTH_TOP + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} />
        <mesh geometry={geos.emitterRing} material={mats.trim} position={[0, PLINTH_TOP + 0.002, 0]} rotation={flat} />
      </group>

      {/* faint projector beam rising out of the dish */}
      {beam && (
        <mesh geometry={beamGeo} material={mats.beam} position={[0, top + beamHeight / 2, 0]} renderOrder={1} />
      )}

      {/* the hologram itself */}
      <group position={[0, top, 0]}>{children}</group>
    </group>
  );
}

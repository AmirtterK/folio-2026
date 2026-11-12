"use client";

/**
 * PitLane: an F1-style pit lane where every garage is one portfolio project.
 *
 *   - garages line the left side of the lane (+x); the car drives along +z
 *   - each garage has a team-colored sign with the project name, a monitor on the back wall
 *     showing its description and tech, and a painted pit box on the asphalt in front of it
 *   - park in a pit box (slow down inside it) and `onActive(index)` fires; the lamp turns green
 *     and the garage lights up. Leaving the box fires `onActive(null)`.
 *
 * Use inside a <Canvas shadows>:
 *   <PitLane projects={projects} pose={pose} active={active} onActive={setActive} />
 *   <FolioCar terrain={flatGround} bounds={pitBounds(projects.length)} pose={pose} ... />
 *   <FollowCam pose={pose} />
 */

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CarPose } from "@/components/FolioCar";

export type Project = {
  title: string;
  description: string;
  live?: string;
  github?: string;
  android?: string;
  githubApp?: string;
  githubSketch?: string;
  image?: string;
  tech?: string[];
};

/* ---------- layout ---------- */

export const PIT_BOX_X = 3.0;       // where a parked car sits, across the lane
const BOX_HALF_X = 1.8;
const BOX_HALF_Z = 3.3;
const SLOT_FIRST_Z = 14;
const SLOT_SPACING = 10;
const GARAGE_FRONT_X = 6;
const GARAGE_BACK_X = 15;
const GARAGE_H = 4.2;

export const slotZ = (i: number) => SLOT_FIRST_Z + i * SLOT_SPACING;
export const flatGround = () => 0;

/** Keeps the car inside the pit lane. */
export function pitBounds(count: number) {
  return { minX: -7.8, maxX: 4.6, minZ: -20, maxZ: slotZ(Math.max(0, count - 1)) + 25 };
}

const TEAM = ["#c8102e", "#0a7f72", "#1b3a8a", "#d9660a", "#6a2c91", "#0e7490", "#8a1538", "#2f6b2f", "#a16207", "#374151"];
const FONT = "system-ui, 'Segoe UI', Arial, sans-serif";

/* ---------- canvas textures (no fonts or images to download) ---------- */

function makeTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (g.measureText(test).width > maxW && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (line && lines.length === maxLines) lines[maxLines - 1] = fitText(g, lines[maxLines - 1] + "…", maxW);
  return lines;
}

function signTexture(p: Project, i: number, color: string) {
  return makeTexture(1024, 256, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(0, 196, 1024, 60);
    g.textBaseline = "middle";

    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(120, 118, 88, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.textAlign = "center";
    g.font = `bold ${i >= 9 ? 92 : 120}px ${FONT}`;
    g.fillText(String(i + 1), 120, 124);

    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    let size = 104;
    g.font = `bold ${size}px ${FONT}`;
    while (g.measureText(p.title).width > 740 && size > 40) {
      size -= 4;
      g.font = `bold ${size}px ${FONT}`;
    }
    g.fillText(p.title, 236, 100);

    g.font = `600 36px ${FONT}`;
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.fillText(fitText(g, (p.tech ?? []).join("  •  "), 760), 236, 226);
  });
}

function screenTexture(p: Project, color: string) {
  return makeTexture(1024, 512, (g) => {
    g.fillStyle = "#0c1017";
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = color;
    g.fillRect(0, 0, 1024, 16);
    g.textBaseline = "middle";
    g.textAlign = "left";

    g.fillStyle = "#ffffff";
    let size = 76;
    g.font = `bold ${size}px ${FONT}`;
    while (g.measureText(p.title).width > 928 && size > 40) {
      size -= 4;
      g.font = `bold ${size}px ${FONT}`;
    }
    g.fillText(p.title, 48, 84);

    g.font = `32px ${FONT}`;
    g.fillStyle = "#cdd5df";
    wrap(g, p.description, 928, 6).forEach((line, k) => g.fillText(line, 48, 160 + k * 44));

    g.font = `600 28px ${FONT}`;
    let x = 48;
    for (const t of p.tech ?? []) {
      const w = g.measureText(t).width + 36;
      if (x + w > 980) break;
      roundRect(g, x, 440, w, 44, 22);
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = color;
      g.stroke();
      g.fillStyle = "#ffffff";
      g.fillText(t, x + 18, 463);
      x += w + 12;
    }
  });
}

function boxTexture() {
  return makeTexture(360, 660, (g) => {
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 14;
    g.strokeRect(10, 10, 340, 640);
    g.fillStyle = "rgba(255,255,255,0.95)";
    // corner ticks toward the garage (right side of the box)
    g.fillRect(300, 10, 50, 14);
    g.fillRect(300, 636, 50, 14);
  });
}

function bannerTexture() {
  return makeTexture(2048, 180, (g) => {
    g.fillStyle = "#14161b";
    g.fillRect(0, 0, 2048, 180);
    g.fillStyle = "#e10600";
    g.fillRect(0, 0, 2048, 14);
    g.fillRect(0, 166, 2048, 14);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `bold 84px ${FONT}`;
    g.fillText("PIT LANE   •   PARK IN A BOX TO OPEN A PROJECT", 1024, 92);
  });
}

/* ---------- small pieces ---------- */

function TireStack({ x, z, mat }: { x: number; z: number; mat: THREE.Material }) {
  return (
    <group position={[x, 0, z]}>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[0, 0.14 + k * 0.28, 0]} material={mat} castShadow>
          <cylinderGeometry args={[0.38, 0.38, 0.26, 16]} />
        </mesh>
      ))}
    </group>
  );
}

function Sun({ pose }: { pose: MutableRefObject<CarPose> }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);

  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(() => {
    const l = light.current, t = target.current;
    if (!l || !t) return;
    const p = pose.current;
    t.position.set(p.x, 0, p.z);
    l.position.set(p.x - 14, 28, p.z - 8); // from over the lane, so garage fronts are lit
  });

  return (
    <>
      <directionalLight
        ref={light}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={90}
      />
      <object3D ref={target} />
    </>
  );
}

/** One light that moves into whichever garage the car is parked at. */
function GarageLight({ active }: { active: number | null }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame((_, delta) => {
    const l = ref.current;
    if (!l) return;
    if (active !== null) l.position.set(10.5, 3.6, slotZ(active));
    l.intensity += ((active !== null ? 140 : 0) - l.intensity) * Math.min(1, delta * 6);
  });
  return <pointLight ref={ref} color="#fff1d6" intensity={0} distance={22} decay={2} />;
}

/** Watches the car and reports which pit box it is parked in. */
function PitTracker({ pose, count, onActive }: { pose: MutableRefObject<CarPose>; count: number; onActive: (i: number | null) => void }) {
  const last = useRef<number | null>(null);
  useFrame(() => {
    const p = pose.current;
    const maxSpeed = last.current !== null ? 4 : 1.5; // easier to stay than to enter, so the card doesn't flicker
    let idx: number | null = null;
    if (Math.abs(p.speed) < maxSpeed && Math.abs(p.x - PIT_BOX_X) < BOX_HALF_X + 0.5) {
      for (let i = 0; i < count; i++) {
        if (Math.abs(p.z - slotZ(i)) < BOX_HALF_Z + 0.2) { idx = i; break; }
      }
    }
    if (idx !== last.current) {
      last.current = idx;
      onActive(idx);
    }
  });
  return null;
}

/* ---------- the pit lane ---------- */

export function PitLane({
  projects, pose, active, onActive,
}: {
  projects: Project[];
  pose: MutableRefObject<CarPose>;
  active: number | null;
  onActive: (i: number | null) => void;
}) {
  const n = projects.length;
  const firstEdge = slotZ(0) - SLOT_SPACING / 2;
  const lastEdge = slotZ(n - 1) + SLOT_SPACING / 2;
  const laneZ0 = firstEdge - 45;
  const laneZ1 = lastEdge + 45;
  const laneLen = laneZ1 - laneZ0;
  const laneCz = (laneZ0 + laneZ1) / 2;
  const std = (color: string, roughness = 0.9, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

  const m = useMemo(() => {
    const flat = (color: string, factor: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor });
    return {
      grass: std("#5d9440", 1),
      asphalt: flat("#3a3b40", -1),
      asphalt2: flat("#303136", -1),
      line: flat("#f4f4f4", -2),
      yellow: flat("#f2c200", -2),
      concrete: std("#b9b9b4"),
      wall: std("#dcdcd8", 0.8),
      wallTop: std("#2b2d33"),
      dark: std("#1b1c20"),
      interior: std("#2c2e34"),
      tire: std("#141416", 0.95),
      red: std("#c8261c", 0.5),
      metal: std("#8d9096", 0.4, 0.8),
      stand: std("#2b4a8c"),
      led: new THREE.MeshBasicMaterial({ color: "#fff6d8" }),
      box: new THREE.MeshBasicMaterial({ map: boxTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      banner: new THREE.MeshBasicMaterial({ map: bannerTexture(), toneMapped: false }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slots = useMemo(
    () =>
      projects.map((p, i) => {
        const color = TEAM[i % TEAM.length];
        return {
          color,
          sign: new THREE.MeshBasicMaterial({ map: signTexture(p, i, color), toneMapped: false }),
          screen: new THREE.MeshBasicMaterial({ map: screenTexture(p, color), toneMapped: false }),
          lamp: new THREE.MeshStandardMaterial({ color: "#222222", emissive: "#ff9a1a", emissiveIntensity: 1.6 }),
          pillar: std(color, 0.6),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects]
  );

  // lamp over each box: amber normally, green while a car is parked there
  useEffect(() => {
    slots.forEach((s, i) => s.lamp.emissive.set(i === active ? "#2cff5a" : "#ff9a1a"));
  }, [slots, active]);

  const flatX: [number, number, number] = [-Math.PI / 2, 0, 0];
  const edges = Array.from({ length: n + 1 }, (_, k) => firstEdge + k * SLOT_SPACING);
  const garageLen = GARAGE_BACK_X - GARAGE_FRONT_X;

  return (
    <>
      <hemisphereLight args={["#cfe8ff", "#6b8f4e", 0.6]} />
      <Sun pose={pose} />
      <GarageLight active={active} />
      <PitTracker pose={pose} count={n} onActive={onActive} />

      {/* ground, pit lane, main straight beyond the pit wall */}
      <mesh rotation={flatX} position={[0, 0, laneCz]} receiveShadow material={m.grass}>
        <planeGeometry args={[800, 800]} />
      </mesh>
      <mesh rotation={flatX} position={[-1.5, 0.02, laneCz]} receiveShadow material={m.asphalt}>
        <planeGeometry args={[15, laneLen]} />
      </mesh>
      <mesh rotation={flatX} position={[-22.5, 0.02, laneCz]} receiveShadow material={m.asphalt2}>
        <planeGeometry args={[23, laneLen]} />
      </mesh>
      <mesh rotation={flatX} position={[-1.5, 0.03, laneCz]} material={m.line}><planeGeometry args={[0.15, laneLen]} /></mesh>
      <mesh rotation={flatX} position={[-7.7, 0.03, laneCz]} material={m.yellow}><planeGeometry args={[0.2, laneLen]} /></mesh>
      <mesh rotation={flatX} position={[-11.3, 0.03, laneCz]} material={m.line}><planeGeometry args={[0.25, laneLen]} /></mesh>
      <mesh rotation={flatX} position={[-33.7, 0.03, laneCz]} material={m.line}><planeGeometry args={[0.25, laneLen]} /></mesh>

      {/* pit wall */}
      <mesh position={[-9.3, 0.6, laneCz]} material={m.wall} castShadow receiveShadow><boxGeometry args={[0.6, 1.2, laneLen]} /></mesh>
      <mesh position={[-9.3, 1.25, laneCz]} material={m.wallTop}><boxGeometry args={[0.7, 0.1, laneLen]} /></mesh>

      {/* entry gantry with the banner */}
      <group position={[0, 0, 5]}>
        {[-8.6, 5.6].map((x) => (
          <mesh key={x} position={[x, 3.25, 0]} material={m.metal} castShadow><boxGeometry args={[0.5, 6.5, 0.5]} /></mesh>
        ))}
        <mesh position={[-1.5, 6.2, 0]} material={m.dark} castShadow><boxGeometry args={[14.7, 1.4, 0.5]} /></mesh>
        <mesh position={[-1.5, 6.2, -0.27]} rotation={[0, Math.PI, 0]} material={m.banner}><planeGeometry args={[13.4, 1.17]} /></mesh>
      </group>

      {/* grandstand across the main straight */}
      {[0, 1, 2, 3].map((t) => (
        <mesh key={t} position={[-40 - t * 2.5, (1.5 + t * 1.5) / 2, laneCz]} material={m.stand} castShadow receiveShadow>
          <boxGeometry args={[2.5, 1.5 + t * 1.5, laneLen * 0.7]} />
        </mesh>
      ))}

      {/* walls between garages */}
      {edges.map((z) => (
        <mesh key={z} position={[(GARAGE_FRONT_X + GARAGE_BACK_X) / 2 + 0.2, GARAGE_H / 2, z]} material={m.wall} castShadow receiveShadow>
          <boxGeometry args={[garageLen + 0.4, GARAGE_H, 0.4]} />
        </mesh>
      ))}

      {/* garages */}
      {slots.map((s, i) => {
        const z = slotZ(i);
        return (
          <group key={i}>
            {/* painted pit box in the lane */}
            <mesh rotation={flatX} position={[PIT_BOX_X, 0.04, z]} material={m.box}>
              <planeGeometry args={[BOX_HALF_X * 2, BOX_HALF_Z * 2]} />
            </mesh>

            {/* floor, back wall, roof */}
            <mesh position={[GARAGE_FRONT_X + garageLen / 2, 0.07, z]} material={m.concrete} receiveShadow>
              <boxGeometry args={[garageLen, 0.14, SLOT_SPACING - 0.4]} />
            </mesh>
            <mesh position={[GARAGE_BACK_X, GARAGE_H / 2, z]} material={m.interior} castShadow receiveShadow>
              <boxGeometry args={[0.3, GARAGE_H, SLOT_SPACING]} />
            </mesh>
            <mesh position={[(GARAGE_FRONT_X - 1 + GARAGE_BACK_X + 0.3) / 2, GARAGE_H + 0.15, z]} material={m.dark} castShadow>
              <boxGeometry args={[GARAGE_BACK_X + 1.3 - GARAGE_FRONT_X, 0.3, SLOT_SPACING]} />
            </mesh>

            {/* team-colored sign over the opening */}
            <mesh position={[GARAGE_FRONT_X - 1.0, 3.25, z]} material={s.pillar}>
              <boxGeometry args={[0.2, 1.95, 7.7]} />
            </mesh>
            <mesh position={[GARAGE_FRONT_X - 1.108, 3.25, z]} rotation={[0, -Math.PI / 2, 0]} material={s.sign}>
              <planeGeometry args={[7.6, 1.9]} />
            </mesh>
            {/* lamp bar under the sign */}
            <mesh position={[GARAGE_FRONT_X - 1.06, 2.1, z]} material={s.lamp}>
              <boxGeometry args={[0.12, 0.16, 7.6]} />
            </mesh>

            {/* monitor on the back wall */}
            <mesh position={[GARAGE_BACK_X - 0.2, 2.35, z]} material={m.dark}>
              <boxGeometry args={[0.12, 3.9, 7.5]} />
            </mesh>
            <mesh position={[GARAGE_BACK_X - 0.27, 2.35, z]} rotation={[0, -Math.PI / 2, 0]} material={s.screen}>
              <planeGeometry args={[7.2, 3.6]} />
            </mesh>

            {/* ceiling light strip, tires, tool chest */}
            <mesh position={[10.5, GARAGE_H - 0.05, z]} material={m.led}><boxGeometry args={[0.2, 0.08, 6]} /></mesh>
            <TireStack x={13.6} z={z + 3.9} mat={m.tire} />
            <TireStack x={12.7} z={z + 3.9} mat={m.tire} />
            <mesh position={[13.9, 0.62, z - 3.7]} material={m.red} castShadow>
              <boxGeometry args={[0.9, 1.1, 1.5]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ---------- chase camera ---------- */

export function FollowCam({ pose }: { pose: MutableRefObject<CarPose> }) {
  const camera = useThree((s) => s.camera);
  const st = useRef({
    yaw: 0,
    ready: false,
    want: new THREE.Vector3(),
    look: new THREE.Vector3(),
    aim: new THREE.Vector3(),
  });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = pose.current;
    const s = st.current;

    if (!s.ready) s.yaw = p.yaw;
    let d = p.yaw - s.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way around
    s.yaw += d * (1 - Math.exp(-2.5 * dt));   // camera swings behind the car lazily

    const dist = 8.5 + Math.min(3, Math.abs(p.speed) * 0.12);
    s.want.set(p.x - Math.sin(s.yaw) * dist, p.y + 3.6, p.z - Math.cos(s.yaw) * dist);
    s.aim.set(p.x, p.y + 1.2, p.z);

    if (!s.ready) {
      camera.position.copy(s.want);
      s.look.copy(s.aim);
      s.ready = true;
    } else {
      camera.position.lerp(s.want, 1 - Math.exp(-5 * dt));
      s.look.lerp(s.aim, 1 - Math.exp(-9 * dt));
    }
    camera.lookAt(s.look);
  });

  return null;
}

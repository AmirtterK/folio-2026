"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { TROPHY_POS } from "@/components/landmarkConfig";
import HolographicMaterial from "@/components/HolographicMaterial";
import HologramBase, { HOLO_COLOR, LANDMARK_BASE_SIZE } from "@/components/HologramBase";
import HoloText, { type HoloLineSpec } from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";

export { TROPHY_POS };

type AchievementTrophyProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  /** Night mode uses additive (glowing) blending; in daylight it falls back to normal blending so it stays visible. */
  night?: boolean;
  /** Touch devices get a tap gesture prompt instead of an Enter key. */
  touch?: boolean;
};

const HALF_PI = Math.PI / 2;
const HOLO = HOLO_COLOR; // same cyan-blue as the rest of the hologram landmarks
const SERIF = "Georgia, 'Times New Roman', serif";
const GLOW = "#8fe6ff";
const CORE = "#eefdff";

/** The cup is scaled to sit at the same visual weight as the chess knight and neural network. */
const TROPHY_SCALE = 1.25;
/** The Enter prompt floats just to the right of the cup, on the same projector. */
const PROMPT_POS: [number, number, number] = [1.5, 1.9, 0];

/** The achievement as free-floating holographic lines: diploma, rank, project and grade, then the product and link. */
const HOLO_LINES: HoloLineSpec[] = [
  {
    text: "B.Sc. Computer Science",
    size: 190,
    family: SERIF,
    italic: true,
    weight: 700,
    textWidth: 2.2,
    x: 2.05,
    y: 2.75,
    z: 0.14,
    color: CORE,
    delay: 0,
  },
  {
    text: "Université de Mostaganem  ·  2023–2026",
    size: 82,
    family: SERIF,
    italic: true,
    weight: 500,
    textWidth: 2.2,
    x: 2.05,
    y: 2.5,
    z: 0.12,
    color: GLOW,
    delay: 0.06,
  },
  {
    text: "Graduated 2nd in cohort",
    size: 76,
    family: SERIF,
    italic: true,
    weight: 600,
    textWidth: 2.0,
    x: 2.05,
    y: 2.14,
    z: 0.1,
    color: GLOW,
    delay: 0.12,
  },
  {
    text: "Best Startup Project",
    size: 130,
    family: SERIF,
    italic: true,
    weight: 600,
    textWidth: 2.0,
    x: 2.05,
    y: 1.72,
    z: 0.08,
    color: GLOW,
    delay: 0.18,
  },
  {
    text: "Final grade 19.75 / 20",
    size: 120,
    family: SERIF,
    italic: true,
    weight: 700,
    textWidth: 2.0,
    x: 2.05,
    y: 1.4,
    z: 0.06,
    color: CORE,
    delay: 0.24,
  },
  {
    text: "Krii",
    size: 260,
    family: SERIF,
    italic: true,
    weight: 700,
    textWidth: 1.0,
    x: 2.05,
    y: 0.92,
    z: 0.04,
    color: CORE,
    delay: 0.3,
  },
  {
    text: "AI-powered peer-to-peer rental marketplace",
    size: 82,
    family: SERIF,
    italic: true,
    weight: 500,
    textWidth: 2.3,
    x: 2.05,
    y: 0.49,
    z: 0.02,
    color: GLOW,
    delay: 0.36,
  },
  {
    text: "krii-website.vercel.app",
    size: 76,
    family: SERIF,
    italic: true,
    weight: 600,
    textWidth: 1.8,
    x: 2.05,
    y: 0.18,
    z: 0,
    color: GLOW,
    delay: 0.42,
    link: "https://krii-website.vercel.app",
    underline: true,
  },
];



/* ---------- Royal trophy shapes (local units, y = 0 at the top of the base) ----------
 * Proportions follow the big trophy in the reference photo: a tall slender urn,
 * about 2.1 high and only ~0.75 wide at the body, with a tapered body that is
 * widest near the top, a tall domed lid, a crown finial and tall looping handles. */

const v2 = (r: number, y: number) => new THREE.Vector2(r, y);

/** Subdivide a profile so straight runs have vertices to flute, while corners stay sharp. */
function densify(points: THREE.Vector2[], steps: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      out.push(points[i].clone().lerp(points[i + 1], s / steps));
    }
  }
  out.push(points[points.length - 1].clone());
  return out;
}

type Flute = { n: number; amp: number; y0: number; y1: number };

/** Carve vertical ribs (gadroons) into a lathe between y0 and y1. */
function flute(geo: THREE.BufferGeometry, f: Flute) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const yy = pos.getY(i);
    const z = pos.getZ(i);
    if (yy <= f.y0 || yy >= f.y1) continue;
    const t = (yy - f.y0) / (f.y1 - f.y0);
    const window = Math.sin(Math.PI * t);
    const k = 1 + f.amp * window * Math.cos(f.n * Math.atan2(z, x));
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  pos.needsUpdate = true;
}

function makeLathe(profile: THREE.Vector2[], flutes: Flute[] = []) {
  const g = new THREE.LatheGeometry(densify(profile, 5), 64);
  flutes.forEach((f) => flute(g, f));
  g.computeVertexNormals();
  return g;
}

// Stepped foot, a slim stem and a swelling knop (y 0 .. 0.40)
const FOOT_STEM_PROFILE = [
  v2(0, 0), v2(0.32, 0), v2(0.32, 0.02), v2(0.29, 0.025), v2(0.29, 0.04), v2(0.23, 0.06),
  v2(0.23, 0.08), v2(0.15, 0.11), v2(0.08, 0.15), v2(0.07, 0.22), v2(0.1, 0.23), v2(0.1, 0.25),
  v2(0.07, 0.26), v2(0.07, 0.27), v2(0.12, 0.3), v2(0.145, 0.335), v2(0.12, 0.37), v2(0.09, 0.39),
  v2(0.1, 0.4),
];

// Tall tapered body: narrow at the stem, widest just under the rim (y 0.40 .. 1.42)
const BOWL_PROFILE = [
  v2(0, 0.4), v2(0.1, 0.4), v2(0.13, 0.46), v2(0.17, 0.56), v2(0.21, 0.7), v2(0.26, 0.86),
  v2(0.3, 1.02), v2(0.33, 1.16), v2(0.35, 1.28), v2(0.36, 1.36), v2(0.37, 1.4), v2(0.38, 1.42),
];

// Tall stepped dome (y 1.42 .. 1.82)
const LID_PROFILE = [
  v2(0.38, 1.42), v2(0.4, 1.43), v2(0.4, 1.45), v2(0.37, 1.47), v2(0.37, 1.49), v2(0.33, 1.52),
  v2(0.31, 1.58), v2(0.27, 1.62), v2(0.24, 1.64), v2(0.2, 1.69), v2(0.16, 1.72), v2(0.12, 1.76),
  v2(0.09, 1.78), v2(0.09, 1.8), v2(0.06, 1.82), v2(0, 1.82),
];

// Tall looping handle: leaves the lower body, swings out and rises to the lid (right side;
// the left one is the same rotated half a turn)
const HANDLE_CURVE = new THREE.CatmullRomCurve3(
  [
    [0.2, 0.72], [0.34, 0.7], [0.46, 0.78], [0.52, 0.95],
    [0.54, 1.15], [0.51, 1.33], [0.44, 1.46], [0.37, 1.495],
  ].map(([x, yy]) => new THREE.Vector3(x, yy, 0)),
  false,
  "centripetal"
);
const HANDLE_BEADS = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86].map((t) => HANDLE_CURVE.getPointAt(t));

const CROWN_SCALE = 0.8;
const CROWN_BASE_Y = 1.82 - 1.62 * CROWN_SCALE; // crown shapes below are modelled with their base at y 1.62

const RIBBON_COLORS = 3;
const RIBBON_LEN = 0.5;

/**
 * The whole cup (foot, body, lid, crown, handles, pearls, jewels, ribbons) merged into ONE geometry,
 * so the hologram shader is applied to a single mesh. Local units: y = 0 at the top of the base.
 */
function buildTrophyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const temps: THREE.BufferGeometry[] = [];
  const euler = new THREE.Euler();
  const mat = (
    p: [number, number, number],
    r: [number, number, number] = [0, 0, 0],
    s: [number, number, number] = [1, 1, 1]
  ) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(p[0], p[1], p[2]),
      new THREE.Quaternion().setFromEuler(euler.set(r[0], r[1], r[2])),
      new THREE.Vector3(s[0], s[1], s[2])
    );
  const mk = <T extends THREE.BufferGeometry>(g: T): T => {
    temps.push(g);
    return g;
  };
  /** Copy a shape into the merged mesh at a matrix (optionally inside a parent matrix). */
  const add = (g: THREE.BufferGeometry, m?: THREE.Matrix4, parent?: THREE.Matrix4) => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    if (m || parent) {
      const full = (m ?? new THREE.Matrix4()).clone();
      if (parent) full.premultiply(parent);
      c.applyMatrix4(full);
    }
    parts.push(c);
  };

  const bead = mk(new THREE.SphereGeometry(0.012, 8, 6));
  const beads = (count: number, radius: number, y: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      add(bead, mat([Math.cos(a) * radius, y, Math.sin(a) * radius]));
    }
  };
  const ring = (r: number, t: number, y: number) =>
    add(mk(new THREE.TorusGeometry(r, t, 8, 64)), mat([0, y, 0], [HALF_PI, 0, 0]));
  const jewel = mk(new THREE.OctahedronGeometry(0.034, 0));

  // stepped foot, slim stem and fluted knop
  add(
    mk(
      makeLathe(FOOT_STEM_PROFILE, [
        { n: 12, amp: 0.035, y0: 0.0, y1: 0.12 },
        { n: 12, amp: 0.07, y0: 0.28, y1: 0.39 },
      ])
    )
  );
  beads(28, 0.296, 0.033);
  ring(0.105, 0.012, 0.245);
  ring(0.148, 0.012, 0.335);

  // tall fluted body with a jewelled band between two rows of pearls
  add(mk(makeLathe(BOWL_PROFILE, [{ n: 16, amp: 0.05, y0: 0.44, y1: 1.0 }])));
  ring(0.298, 0.012, 1.0);
  beads(32, 0.328, 1.12);
  beads(34, 0.352, 1.28);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(jewel, mat([Math.cos(a) * 0.343, 1.2, Math.sin(a) * 0.343], [0, -a, 0], [1, 1.35, 1]));
  }
  ring(0.385, 0.02, 1.42);

  // tall domed lid
  add(mk(makeLathe(LID_PROFILE, [{ n: 16, amp: 0.04, y0: 1.5, y1: 1.78 }])));
  beads(36, 0.405, 1.435);
  beads(26, 0.31, 1.585);

  // crown: band, eight tines with ball tips, crossed arches, orb and cross
  const crown = mat([0, CROWN_BASE_Y, 0], [0, 0, 0], [CROWN_SCALE, CROWN_SCALE, CROWN_SCALE]);
  const crownBand = mk(new THREE.CylinderGeometry(0.15, 0.12, 0.07, 32, 1, true));
  const crownRingTop = mk(new THREE.TorusGeometry(0.15, 0.012, 8, 64));
  const crownRingBottom = mk(new THREE.TorusGeometry(0.12, 0.012, 8, 64));
  const crownTine = mk(new THREE.ConeGeometry(0.022, 0.12, 4));
  const crownBall = mk(new THREE.SphereGeometry(0.02, 10, 8));
  const crownArch = mk(new THREE.TorusGeometry(0.12, 0.012, 8, 28, Math.PI));
  add(crownBand, mat([0, 1.665, 0]), crown);
  add(crownRingTop, mat([0, 1.7, 0], [HALF_PI, 0, 0]), crown);
  add(crownRingBottom, mat([0, 1.63, 0], [HALF_PI, 0, 0]), crown);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(crownTine, mat([Math.cos(a) * 0.145, 1.76, Math.sin(a) * 0.145]), crown);
    add(crownBall, mat([Math.cos(a) * 0.145, 1.835, Math.sin(a) * 0.145]), crown);
    if (i % 2 === 0) add(jewel, mat([Math.cos(a) * 0.14, 1.665, Math.sin(a) * 0.14], [0, 0, 0], [0.55, 0.55, 0.55]), crown);
  }
  [0, HALF_PI].forEach((rotY) => add(crownArch, mat([0, 1.7, 0], [0, rotY, 0]), crown));
  add(mk(new THREE.SphereGeometry(0.04, 14, 10)), mat([0, 1.84, 0]), crown);
  add(mk(new THREE.BoxGeometry(0.014, 0.075, 0.014)), mat([0, 1.915, 0]), crown);
  add(mk(new THREE.BoxGeometry(0.05, 0.014, 0.014)), mat([0, 1.93, 0]), crown);

  // tall looping handles with bosses, beads and little outward curls (right, then the left turned half a way round)
  const handle = mk(new THREE.TubeGeometry(HANDLE_CURVE, 72, 0.026, 10, false));
  const boss = mk(new THREE.SphereGeometry(0.06, 14, 10));
  const tip = mk(new THREE.SphereGeometry(0.042, 14, 10));
  const hBead = mk(new THREE.SphereGeometry(0.036, 12, 10));
  const scroll = mk(new THREE.TorusGeometry(0.055, 0.014, 8, 20, Math.PI * 1.5));
  [0, Math.PI].forEach((rotY) => {
    const side = mat([0, 0, 0], [0, rotY, 0]);
    add(handle, undefined, side);
    add(boss, mat([0.21, 0.72, 0], [0, 0, 0], [1.2, 1.3, 0.7]), side);
    add(tip, mat([0.37, 1.495, 0]), side);
    HANDLE_BEADS.forEach((p) => add(hBead, mat([p.x, p.y, p.z]), side));
    add(scroll, mat([0.6, 1.2, 0], [0, 0, Math.PI * 0.75]), side);
    add(scroll, mat([0.5, 0.74, 0], [0, 0, Math.PI * 1.25]), side);
  });

  // ribbons hanging inside each handle loop (still, drawn from both sides)
  const ribbon = mk(new THREE.PlaneGeometry(0.04, RIBBON_LEN));
  [1, -1].forEach((side) => {
    for (let ci = 0; ci < RIBBON_COLORS; ci++) {
      const p: [number, number, number] = [side * 0.44, 1.45 - RIBBON_LEN / 2, (ci - 1) * 0.05];
      add(ribbon, mat(p));
      add(ribbon, mat(p, [0, Math.PI, 0]));
    }
  });

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  temps.forEach((g) => g.dispose());
  if (!merged) throw new Error("Trophy geometry could not be merged");
  return merged;
}

export default function AchievementTrophy({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
}: AchievementTrophyProps) {
  const trophyCupRef = useRef<THREE.Group>(null);
  const gemRef = useRef<THREE.Mesh>(null);

  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);

  const y = groundHeight(TROPHY_POS.x, TROPHY_POS.z);

  // The whole cup as one merged mesh, plus the floating gem (animated, so its own mesh)
  const cup = useMemo(
    () => ({
      body: buildTrophyGeometry(),
      gem: new THREE.OctahedronGeometry(0.08, 0),
    }),
    []
  );

  useEffect(() => {
    return () => {
      cup.body.dispose();
      cup.gem.dispose();
    };
  }, [cup]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Slow turntable spin; the cup stands on its projector
    if (trophyCupRef.current) {
      trophyCupRef.current.rotation.y = t * 0.4;
    }

    // Gem floating above the crown
    if (gemRef.current) {
      gemRef.current.rotation.y = t * 1.1;
      gemRef.current.position.y = 2.25 + Math.sin(t * 2.2) * 0.04;
    }

    // Proximity check with wide hysteresis buffer
    const p = pose.current;
    if (p) {
      const dist = Math.hypot(p.x - TROPHY_POS.x, p.z - TROPHY_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  const holo = { hologramColor: HOLO, hologramBrightness: 1.3, scanlineSize: 8, enableAdditive: night };

  return (
    <group position={[TROPHY_POS.x, y, TROPHY_POS.z]}>
      {/* Shared round hologram projector: radar pings on the road, blue light and a faint beam, like the other landmarks */}
      <HologramBase night={night} size={LANDMARK_BASE_SIZE} ringEnd={4.4} lightY={2.2} beamHeight={2.4}>
        {/* The trophy, now a hologram too: one merged mesh turning slowly on the projector dish */}
        <group ref={trophyCupRef} scale={TROPHY_SCALE}>
          <mesh geometry={cup.body}>
            <HolographicMaterial {...holo} />
          </mesh>
          <mesh ref={gemRef} geometry={cup.gem} position={[0, 2.25, 0]} scale={[1, 1.4, 1]}>
            <HolographicMaterial {...holo} />
          </mesh>
        </group>

        {/* Achievement as free-floating holographic writing, revealed while inspecting */}
        <HoloText lines={HOLO_LINES} active={inspecting} night={night} />

        {/* Floating prompt: a quiet orb that becomes an Enter key (or a tap gesture on touch) as the car pulls up, to the right of the cup */}
        <HoloKeyPrompt
          active={isNear}
          visible={!inspecting}
          onActivate={() => onInspectToggle(true)}
          position={PROMPT_POS}
          night={night}
          touch={touch}
        />
      </HologramBase>
    </group>
  );
}

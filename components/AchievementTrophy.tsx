"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/ToyCarSmoke";
import { TROPHY_POS } from "@/components/landmarkConfig";

export { TROPHY_POS };

type AchievementTrophyProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
};

/** Hover panel layout (world units, local to the panel group) */
const PAD = 0.05; // board edge padding
const GAP = 0.04; // gap between image and details
const IMG_W = 1.28;
const IMG_H = 0.847;
const DET_W = 1.28;
const DET_H = 0.62;
const PANEL_W = IMG_W + PAD * 2;
const PANEL_H = PAD + IMG_H + GAP + DET_H + PAD;
const PANEL_SCALE = 1.05; // overall size of the hover panel (text shrinks with it)
const PANEL_X = 1.46; // panel centre, right of the cup (its handles reach ~0.6)
const PANEL_Y = 1.6;

/** Hologram projection: a round lens in the right face of the base, a beam out to the bottom edge of the panel */
const PANEL_BOTTOM = PANEL_Y - (PANEL_H * PANEL_SCALE) / 2;
const LENS_X = 0.376; // just outside the right face of the upper base block (half-width 0.37); a few mm of clearance so it never z-fights, even from far away
const LENS_Y = 0.355; // centre height of the upper base block
const LENS_R = 0.1;
const BEAM_TOP_W = PANEL_W * PANEL_SCALE;
const HOLO = "#9db8d3"; // muted steel blue-grey
const TEX_PX_PER_UNIT = 800; // text texture density: close to the on-screen pixel size so it stays sharp

const PANEL_ROWS: { label: string; value: string }[] = [
  { label: "Degree", value: "Bachelor's Degree in Computer Science" },
  { label: "University", value: "Université de Mostaganem, 2023 – 2026" },
  { label: "Grade", value: "19.75 / 20, graduated 2nd in cohort" },
  { label: "Award", value: "University's Best Startup Project" },
  { label: "Project", value: "Krii, an AI-powered P2P rental marketplace" },
];

/** High-resolution transparent texture with the detail rows (drawn big so it stays sharp up close). */
function createDetailsTexture(): THREE.CanvasTexture {
  const w = Math.round(DET_W * TEX_PX_PER_UNIT);
  const h = Math.round(DET_H * TEX_PX_PER_UNIT);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const rowH = h / PANEL_ROWS.length;
  ctx.textBaseline = "alphabetic";
  const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  PANEL_ROWS.forEach((r, i) => {
    const top = rowH * i;
    if (i > 0) {
      ctx.fillStyle = "#3a404a";
      ctx.fillRect(0, top, w, 2);
    }
    // small label above, larger value below (value shrinks to fit the width)
    ctx.fillStyle = "#8fa8c4";
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(r.label, 10, top + 29);

    ctx.fillStyle = "#e5e9ee";
    let size = 44;
    ctx.font = `700 ${size}px ${FONT}`;
    while (ctx.measureText(r.value).width > w - 24 && size > 28) {
      size -= 1;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    ctx.fillText(r.value, 10, top + 80);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* ---------- Hologram helpers ---------- */

/** Vertical fade for the beam: faint at the top, brighter at the lens. */
function createBeamGradient(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/** Thin horizontal scanlines, tiled over the panel. */
function createScanlineTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 4;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 1, 4);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 2, 1, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, PANEL_H / 0.024);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/**
 * An open light beam lofted between two rings: a round lens facing +x on the side of the base,
 * and a wide, thin ellipse (the bottom edge of the panel). uv.y runs 0 at the lens to 1 at the panel.
 */
function makeBeamCone(
  lens: THREE.Vector3,
  lensR: number,
  top: THREE.Vector3,
  topRx: number,
  topRz: number,
  seg = 48
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let ring = 0; ring <= 1; ring++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      if (ring === 0) pos.push(lens.x, lens.y + Math.cos(a) * lensR, lens.z + Math.sin(a) * lensR);
      else pos.push(top.x + Math.cos(a) * topRx, top.y, top.z + Math.sin(a) * topRz);
      uv.push(i / seg, ring);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i;
    const b = i + 1;
    const c = i + seg + 1;
    const d = i + seg + 2;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

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

const RIBBON_COLORS = ["#c0242b", "#f3f1ea", "#1f4fa8"] as const;
const RIBBON_LEN = 0.5;

/** A ring of beads (instanced) around the vertical axis. */
function Beads({
  count,
  radius,
  y,
  geometry,
  material,
}: {
  count: number;
  radius: number;
  y: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const d = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      d.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [count, radius, y]);
  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />;
}

export default function AchievementTrophy({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
}: AchievementTrophyProps) {
  const trophyCupRef = useRef<THREE.Group>(null);
  const gemRef = useRef<THREE.Mesh>(null);
  const groundAuraRef = useRef<THREE.Mesh>(null);
  const ribbonRefs = useRef<(THREE.Group | null)[]>([]);

  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);

  const y = groundHeight(TROPHY_POS.x, TROPHY_POS.z);

  /* ---- Hover panel (3D, part of the world): image on top, details underneath ---- */
  const panelRef = useRef<THREE.Group>(null);
  const reveal = useRef(0);
  const sweepRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Group>(null);

  const panel = useMemo(() => {
    const img = new THREE.TextureLoader().load("/images/krii.jpg", (tex) => {
      // cover-fit the photo into the image frame without stretching it
      const a = tex.image.width / tex.image.height;
      const target = IMG_W / IMG_H;
      if (a > target) {
        tex.repeat.set(target / a, 1);
        tex.offset.set((1 - target / a) / 2, 0);
      } else {
        tex.repeat.set(1, a / target);
        tex.offset.set(0, (1 - a / target) / 2);
      }
    });
    img.colorSpace = THREE.SRGBColorSpace;
    img.anisotropy = 16;
    const det = createDetailsTexture();
    const base = { transparent: true, depthWrite: false, toneMapped: false, fog: false } as const;
    const beamTex = createBeamGradient();
    const scanTex = createScanlineTexture();
    const additive = {
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    } as const;
    return {
      img,
      det,
      beamTex,
      scanTex,
      rim: new THREE.MeshBasicMaterial({ color: HOLO, ...base }),
      slab: new THREE.MeshBasicMaterial({ color: "#1f252d", ...base }),
      image: new THREE.MeshBasicMaterial({ map: img, ...base }),
      details: new THREE.MeshBasicMaterial({ map: det, ...base }),
      scan: new THREE.MeshBasicMaterial({ map: scanTex, ...base }),
      sweep: new THREE.MeshBasicMaterial({ color: "#d4e5f5", ...additive }),
      beam: new THREE.MeshBasicMaterial({ map: beamTex, color: HOLO, side: THREE.DoubleSide, ...additive }),
      emitter: new THREE.MeshBasicMaterial({ color: HOLO, ...additive }),
      rimGeo: new THREE.PlaneGeometry(PANEL_W + 0.04, PANEL_H + 0.04),
      slabGeo: new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      imageGeo: new THREE.PlaneGeometry(IMG_W, IMG_H),
      detailsGeo: new THREE.PlaneGeometry(DET_W, DET_H),
      scanGeo: new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      sweepGeo: new THREE.PlaneGeometry(PANEL_W, 0.014),
      beamCone: makeBeamCone(
        new THREE.Vector3(LENS_X, LENS_Y, 0),
        LENS_R,
        new THREE.Vector3(PANEL_X, PANEL_BOTTOM, 0),
        BEAM_TOP_W / 2,
        0.05
      ),
      emitterGeo: new THREE.CircleGeometry(LENS_R * 0.85, 40),
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(panel).forEach((o) => (o as { dispose?: () => void }).dispose?.());
    };
  }, [panel]);

  // Materials
  const mats = useMemo(() => {
    const goldBase = {
      color: "#f2b630",
      emissive: new THREE.Color("#8a4b08"),
      emissiveIntensity: 0.35,
      roughness: 0.24,
      metalness: 0.75,
    };
    return {
      baseBlack: new THREE.MeshStandardMaterial({ color: "#101116", roughness: 0.25, metalness: 0.35 }),
      // faceted gold for the lathed body: crisp ribs and steps
      goldFlat: new THREE.MeshStandardMaterial({ ...goldBase, flatShading: true, side: THREE.DoubleSide }),
      gold: new THREE.MeshStandardMaterial({ ...goldBase, side: THREE.DoubleSide }),
      trimGold: new THREE.MeshStandardMaterial({ ...goldBase, emissiveIntensity: 0.3, roughness: 0.28, metalness: 0.8 }),
      darkGold: new THREE.MeshStandardMaterial({
        color: "#b9801c",
        emissive: new THREE.Color("#5a3305"),
        emissiveIntensity: 0.3,
        roughness: 0.35,
        metalness: 0.8,
      }),
      pearl: new THREE.MeshStandardMaterial({
        color: "#f4efe4",
        emissive: new THREE.Color("#6b6350"),
        emissiveIntensity: 0.25,
        roughness: 0.2,
        metalness: 0.3,
      }),
      ruby: new THREE.MeshStandardMaterial({
        color: "#d4163c",
        emissive: new THREE.Color("#c01034"),
        emissiveIntensity: 0.9,
        roughness: 0.15,
        metalness: 0.2,
        flatShading: true,
      }),
      sapphire: new THREE.MeshStandardMaterial({
        color: "#2347b8",
        emissive: new THREE.Color("#1a3a9e"),
        emissiveIntensity: 0.8,
        roughness: 0.15,
        metalness: 0.2,
        flatShading: true,
      }),
      groundAura: new THREE.MeshBasicMaterial({
        color: "#f59e0b",
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
      ribbons: RIBBON_COLORS.map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide })
      ),
    };
  }, []);

  // Geometries
  const geos = useMemo(() => {
    return {
      // base (sized to the slimmer trophy)
      baseLow: new THREE.BoxGeometry(0.96, 0.18, 0.96),
      baseHigh: new THREE.BoxGeometry(0.74, 0.28, 0.74), // top at y 0.49, tucked just under the trim (0.475..0.5) so no faces are coplanar
      baseTrim: new THREE.BoxGeometry(0.8, 0.03, 0.8),
      baseTopTrim: new THREE.BoxGeometry(0.78, 0.025, 0.78),
      plaque: new THREE.BoxGeometry(0.36, 0.12, 0.012),
      // lens housing in the right face of the base
      lensDisc: new THREE.CircleGeometry(LENS_R * 1.15, 40),
      cornerFoot: new THREE.BoxGeometry(0.1, 0.05, 0.1),
      cornerSpire: new THREE.ConeGeometry(0.04, 0.11, 4),
      // body (carved ribs on foot, knop, lower body and the domed lid)
      footStem: makeLathe(FOOT_STEM_PROFILE, [
        { n: 12, amp: 0.035, y0: 0.0, y1: 0.12 },
        { n: 12, amp: 0.07, y0: 0.28, y1: 0.39 },
      ]),
      bowl: makeLathe(BOWL_PROFILE, [{ n: 16, amp: 0.05, y0: 0.44, y1: 1.0 }]),
      lid: makeLathe(LID_PROFILE, [{ n: 16, amp: 0.04, y0: 1.5, y1: 1.78 }]),
      // handles
      handle: new THREE.TubeGeometry(HANDLE_CURVE, 72, 0.026, 10, false),
      handleBoss: new THREE.SphereGeometry(0.06, 14, 10),
      handleBead: new THREE.SphereGeometry(0.036, 12, 10),
      handleTip: new THREE.SphereGeometry(0.042, 14, 10),
      scroll: new THREE.TorusGeometry(0.055, 0.014, 8, 20, Math.PI * 1.5),
      // rings, beads, jewels
      ring: (r: number, t: number) => new THREE.TorusGeometry(r, t, 8, 64),
      bead: new THREE.SphereGeometry(0.012, 8, 6),
      jewel: new THREE.OctahedronGeometry(0.034, 0),
      // crown
      crownBand: new THREE.CylinderGeometry(0.15, 0.12, 0.07, 32, 1, true),
      crownTine: new THREE.ConeGeometry(0.022, 0.12, 4),
      crownBall: new THREE.SphereGeometry(0.02, 10, 8),
      crownArch: new THREE.TorusGeometry(0.12, 0.012, 8, 28, Math.PI),
      crownOrb: new THREE.SphereGeometry(0.04, 14, 10),
      crossV: new THREE.BoxGeometry(0.014, 0.075, 0.014),
      crossH: new THREE.BoxGeometry(0.05, 0.014, 0.014),
      gem: new THREE.OctahedronGeometry(0.08, 0),
      ribbon: new THREE.PlaneGeometry(0.04, RIBBON_LEN),
      aura: new THREE.RingGeometry(1.6, 1.9, 32),
    };
  }, []);

  const rings = useMemo(
    () => ({
      rim: geos.ring(0.385, 0.02),
      emitter: geos.ring(LENS_R * 1.2, 0.01),
      bodySplit: geos.ring(0.298, 0.012),
      collar: geos.ring(0.105, 0.012),
      knop: geos.ring(0.148, 0.012),
      crownTop: geos.ring(0.15, 0.012),
      crownBottom: geos.ring(0.12, 0.012),
    }),
    [geos]
  );

  const jewelAngles = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2), []);
  const tineAngles = useMemo(() => Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Hover panel reveal: eases in when inspecting, eases out (and hides) when leaving
    reveal.current += ((inspecting ? 1 : 0) - reveal.current) * (1 - Math.exp(-4.5 * Math.min(delta, 0.05)));
    const r = reveal.current;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    // hologram flicker: tiny constant jitter plus an occasional brief dip
    let flick = 1 - 0.04 * Math.abs(Math.sin(t * 47) * Math.sin(t * 13));
    if (Math.sin(t * 3.1) > 0.985) flick *= 0.78;

    if (beamRef.current) beamRef.current.visible = r > 0.01;
    panel.beam.opacity = clamp(r * 2.5) * 0.55 * flick;
    panel.emitter.opacity = 0.1 + 0.55 * clamp(r * 2) * flick + (inspecting ? 0 : 0.04 * Math.sin(t * 2));

    // The panel unfolds upward out of the beam, anchored at its bottom edge
    const pg = panelRef.current;
    if (pg) {
      pg.visible = r > 0.01;
      if (pg.visible) {
        const e = 1 - Math.pow(1 - clamp(r * 1.15), 3);
        const eY = Math.max(0.02, e);
        pg.scale.set(PANEL_SCALE * (0.85 + 0.15 * e), PANEL_SCALE * eY, PANEL_SCALE);
        pg.position.set(PANEL_X, PANEL_BOTTOM + (PANEL_H * PANEL_SCALE * eY) / 2 + Math.sin(t * 1.4) * 0.01, 0);
        panel.rim.opacity = clamp(r * 1.8) * 0.95 * flick;
        panel.slab.opacity = clamp(r * 1.8) * 0.8;
        panel.image.opacity = clamp((r - 0.2) * 2.2) * 0.96 * flick;
        panel.details.opacity = clamp((r - 0.45) * 2.5) * flick;
        panel.scan.opacity = clamp(r * 1.5) * 0.5;
        panel.scanTex.offset.y = -t * 0.04;
        const sweep = sweepRef.current;
        if (sweep) {
          const f = (t * 0.45) % 2.4;
          sweep.visible = f <= 1;
          sweep.position.y = (f - 0.5) * PANEL_H;
          panel.sweep.opacity = 0.4 * clamp(r * 2) * (1 - Math.abs(f - 0.5));
        }
      }
    }

    // Slow turntable spin; the cup sits on its base
    if (trophyCupRef.current) {
      trophyCupRef.current.rotation.y = t * 0.4;
    }

    // Ruby floating above the crown
    if (gemRef.current) {
      gemRef.current.rotation.y = t * 1.1;
      gemRef.current.position.y = 2.25 + Math.sin(t * 2.2) * 0.04;
    }

    // Ribbons sway gently
    ribbonRefs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.z = Math.sin(t * 1.8 + i * 0.9) * 0.06;
      g.rotation.x = Math.sin(t * 1.3 + i * 1.7) * 0.08;
    });

    if (groundAuraRef.current) {
      groundAuraRef.current.rotation.z = -t * 0.3;
      (groundAuraRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.18 + Math.sin(t * 2.0) * 0.07;
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

  const flat = Math.PI / 2;

  return (
    <group position={[TROPHY_POS.x, y, TROPHY_POS.z]}>
      {/* Ground soft gold aura */}
      <mesh
        ref={groundAuraRef}
        geometry={geos.aura}
        material={mats.groundAura}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.03, 0]}
      />

      {/* Black square base: gold trim, corner feet and spires, front plaque */}
      <mesh position={[0, 0.09, 0]} geometry={geos.baseLow} material={mats.baseBlack} castShadow receiveShadow />
      <mesh position={[0, 0.195, 0]} geometry={geos.baseTrim} material={mats.trimGold} />
      <mesh position={[0, 0.35, 0]} geometry={geos.baseHigh} material={mats.baseBlack} castShadow receiveShadow />
      <mesh position={[0, 0.4875, 0]} geometry={geos.baseTopTrim} material={mats.trimGold} />
      <mesh position={[0, 0.34, 0.376]} geometry={geos.plaque} material={mats.trimGold} />
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz]) => (
        <group key={`${sx}${sz}`}>
          <mesh position={[sx * 0.45, 0.025, sz * 0.45]} geometry={geos.cornerFoot} material={mats.trimGold} />
          <mesh
            position={[sx * 0.32, 0.5525 + 0.03, sz * 0.32]}
            rotation={[0, Math.PI / 4, 0]}
            geometry={geos.cornerSpire}
            material={mats.trimGold}
          />
        </group>
      ))}

      {/* Royal lidded trophy */}
      <group ref={trophyCupRef} position={[0, 0.502, 0]}>
        {/* Stepped foot, slim stem and fluted knop */}
        <mesh geometry={geos.footStem} material={mats.goldFlat} castShadow />
        <Beads count={28} radius={0.296} y={0.033} geometry={geos.bead} material={mats.pearl} />
        <mesh geometry={rings.collar} material={mats.darkGold} position={[0, 0.245, 0]} rotation={[flat, 0, 0]} />
        <mesh geometry={rings.knop} material={mats.darkGold} position={[0, 0.335, 0]} rotation={[flat, 0, 0]} />

        {/* Tall fluted body; plain upper band with jewels between two rows of pearls */}
        <mesh geometry={geos.bowl} material={mats.goldFlat} castShadow />
        <mesh geometry={rings.bodySplit} material={mats.darkGold} position={[0, 1.0, 0]} rotation={[flat, 0, 0]} />
        <Beads count={32} radius={0.328} y={1.12} geometry={geos.bead} material={mats.pearl} />
        <Beads count={34} radius={0.352} y={1.28} geometry={geos.bead} material={mats.pearl} />
        {jewelAngles.map((a, i) => (
          <mesh
            key={a}
            geometry={geos.jewel}
            material={i % 2 === 0 ? mats.ruby : mats.sapphire}
            position={[Math.cos(a) * 0.343, 1.2, Math.sin(a) * 0.343]}
            scale={[1, 1.35, 1]}
            rotation={[0, -a, 0]}
          />
        ))}
        <mesh geometry={rings.rim} material={mats.trimGold} position={[0, 1.42, 0]} rotation={[flat, 0, 0]} />

        {/* Tall domed lid */}
        <mesh geometry={geos.lid} material={mats.goldFlat} castShadow />
        <Beads count={36} radius={0.405} y={1.435} geometry={geos.bead} material={mats.pearl} />
        <Beads count={26} radius={0.31} y={1.585} geometry={geos.bead} material={mats.pearl} />

        {/* Crown: band, eight tines with ball tips, crossed arches, orb and cross */}
        <group position={[0, CROWN_BASE_Y, 0]} scale={CROWN_SCALE}>
          <mesh geometry={geos.crownBand} material={mats.gold} position={[0, 1.665, 0]} />
          <mesh geometry={rings.crownTop} material={mats.trimGold} position={[0, 1.7, 0]} rotation={[flat, 0, 0]} />
          <mesh geometry={rings.crownBottom} material={mats.trimGold} position={[0, 1.63, 0]} rotation={[flat, 0, 0]} />
          {tineAngles.map((a) => (
            <group key={a} position={[Math.cos(a) * 0.145, 1.7, Math.sin(a) * 0.145]}>
              <mesh geometry={geos.crownTine} material={mats.gold} position={[0, 0.06, 0]} />
              <mesh geometry={geos.crownBall} material={mats.pearl} position={[0, 0.135, 0]} />
            </group>
          ))}
          {tineAngles.map((a, i) =>
            i % 2 === 0 ? (
              <mesh
                key={`g${a}`}
                geometry={geos.jewel}
                material={i % 4 === 0 ? mats.ruby : mats.sapphire}
                position={[Math.cos(a) * 0.14, 1.665, Math.sin(a) * 0.14]}
                scale={0.55}
              />
            ) : null
          )}
          {[0, Math.PI / 2].map((rotY) => (
            <mesh key={rotY} geometry={geos.crownArch} material={mats.trimGold} position={[0, 1.7, 0]} rotation={[0, rotY, 0]} />
          ))}
          <mesh geometry={geos.crownOrb} material={mats.trimGold} position={[0, 1.84, 0]} />
          <mesh geometry={geos.crossV} material={mats.trimGold} position={[0, 1.915, 0]} />
          <mesh geometry={geos.crossH} material={mats.trimGold} position={[0, 1.93, 0]} />
        </group>

        {/* Tall looping handles with scroll ornaments and beads (right, then the left rotated) */}
        {[0, Math.PI].map((rotY) => (
          <group key={rotY} rotation={[0, rotY, 0]}>
            <mesh geometry={geos.handle} material={mats.gold} castShadow />
            <mesh geometry={geos.handleBoss} material={mats.trimGold} position={[0.21, 0.72, 0]} scale={[1.2, 1.3, 0.7]} />
            <mesh geometry={geos.handleTip} material={mats.trimGold} position={[0.37, 1.495, 0]} />
            {HANDLE_BEADS.map((p, i) => (
              <mesh
                key={i}
                geometry={geos.handleBead}
                material={i % 2 === 0 ? mats.pearl : mats.trimGold}
                position={[p.x, p.y, p.z]}
              />
            ))}
            {/* little outward curls on the handle */}
            <mesh geometry={geos.scroll} material={mats.trimGold} position={[0.6, 1.2, 0]} rotation={[0, 0, Math.PI * 0.75]} />
            <mesh geometry={geos.scroll} material={mats.trimGold} position={[0.5, 0.74, 0]} rotation={[0, 0, Math.PI * 1.25]} />
          </group>
        ))}

        {/* Red / white / blue ribbons hanging inside each handle loop */}
        {[1, -1].flatMap((side, si) =>
          RIBBON_COLORS.map((_, ci) => {
            const idx = si * 3 + ci;
            return (
              <group
                key={`rib-${idx}`}
                ref={(el) => {
                  ribbonRefs.current[idx] = el;
                }}
                position={[side * 0.44, 1.45, (ci - 1) * 0.05]}
              >
                <mesh geometry={geos.ribbon} material={mats.ribbons[ci]} position={[0, -RIBBON_LEN / 2, 0]} />
              </group>
            );
          })
        )}

        {/* Ruby floating above the crown */}
        <mesh ref={gemRef} geometry={geos.gem} material={mats.ruby} position={[0, 2.25, 0]} scale={[1, 1.4, 1]} />
      </group>

      {/* Warm key light on the front of the trophy (does not spin with it) */}
      <pointLight position={[0.4, 1.6, 1.7]} color="#ffd9a0" intensity={16} distance={7} decay={2} />

      {/* Projector lens: a round disc set into the right face of the base */}
      <mesh position={[LENS_X - 0.002, LENS_Y, 0]} rotation={[0, flat, 0]} geometry={geos.lensDisc} material={mats.baseBlack} />
      <mesh position={[LENS_X, LENS_Y, 0]} rotation={[0, flat, 0]} geometry={rings.emitter} material={mats.trimGold} />
      <mesh
        position={[LENS_X + 0.002, LENS_Y, 0]}
        rotation={[0, flat, 0]}
        geometry={panel.emitterGeo}
        material={panel.emitter}
        renderOrder={1}
      />

      {/* Light beam from the lens out to the bottom edge of the hologram (geometry is in group-local coords) */}
      <group ref={beamRef} visible={false}>
        <mesh geometry={panel.beamCone} material={panel.beam} renderOrder={0} />
      </group>

      {/* 3D hover panel to the right of the cup: image on top, details under it */}
      <group ref={panelRef} visible={false}>
        <mesh geometry={panel.rimGeo} material={panel.rim} position={[0, 0, -0.004]} renderOrder={1} />
        <mesh geometry={panel.slabGeo} material={panel.slab} renderOrder={2} />
        <mesh
          geometry={panel.imageGeo}
          material={panel.image}
          position={[0, PANEL_H / 2 - PAD - IMG_H / 2, 0.006]}
          renderOrder={3}
        />
        <mesh
          geometry={panel.detailsGeo}
          material={panel.details}
          position={[0, PANEL_H / 2 - PAD - IMG_H - GAP - DET_H / 2, 0.006]}
          renderOrder={3}
        />
        <mesh geometry={panel.scanGeo} material={panel.scan} position={[0, 0, 0.012]} renderOrder={4} />
        <mesh ref={sweepRef} geometry={panel.sweepGeo} material={panel.sweep} position={[0, 0, 0.014]} renderOrder={5} />
      </group>

      {/* Plain prompt when the car is nearby: flat grey/blue, no blur, no highlighted badge */}
      {isNear && !inspecting && (
        <Html position={[0, 3.2, 0]} center distanceFactor={14} zIndexRange={[20, 0]}>
          <div
            onClick={() => onInspectToggle(true)}
            style={{
              background: "#2b2f36",
              border: "1px solid #4b5563",
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
              color: "#dbe3ec",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            View achievement <span style={{ color: "#8fa8c4", marginLeft: 6 }}>Enter</span>
          </div>
        </Html>
      )}
    </group>
  );
}

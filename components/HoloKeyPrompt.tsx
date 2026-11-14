"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO_COLOR } from "@/components/HologramBase";

const HOLO_RGB = "94,200,255";

const KEYCAP_W = 0.8;
const KEYCAP_H = 0.46;
const KEYCAP_EXT_W = 0.28;
const KEYCAP_EXT_H = 0.16;
const KEYCAP_TOTAL_H = KEYCAP_H + KEYCAP_EXT_H;
const KEYCAP_D = 0.16;
const KEYCAP_R = 0.07;

type HoloKeyPromptProps = {
  /** The car is close enough to interact. */
  active: boolean;
  /** Hide the whole prompt (e.g. while the inspection view is open). */
  visible?: boolean;
  onActivate: () => void;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  night?: boolean;
  /** Touch devices show a tap gesture instead of an Enter key. */
  touch?: boolean;
};

/** Classic Enter-key silhouette: a wide main bar with an extra box stepping out at the top-right. */
function keycapPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mainH: number,
  extH: number,
  extW: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(r, extH);
  ctx.lineTo(w - extW, extH);
  ctx.lineTo(w - extW, r);
  ctx.quadraticCurveTo(w - extW, 0, w - extW + r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, extH + r);
  ctx.quadraticCurveTo(0, extH, r, extH);
  ctx.closePath();
}

/** The glowing face of the key: the stepped outline and a large return arrow. */
function createKeycapTexture(): THREE.CanvasTexture {
  const w = 888;
  const h = Math.round((w * KEYCAP_TOTAL_H) / KEYCAP_W);
  const mainH = Math.round((h * KEYCAP_H) / KEYCAP_TOTAL_H);
  const extH = h - mainH;
  const extW = Math.round((w * KEYCAP_EXT_W) / KEYCAP_W);
  const r = Math.round((w * KEYCAP_R) / KEYCAP_W);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(${HOLO_RGB},0.9)`;
  ctx.shadowBlur = 30;

  keycapPath(ctx, w, h, mainH, extH, extW, r);
  ctx.strokeStyle = HOLO_COLOR;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.stroke();

  // A large return arrow centred on the main bar.
  const ax = w / 2;
  const ay = extH + mainH / 2;
  const aw = w * 0.46;
  const ah = mainH * 0.5;
  const left = ax - aw / 2;
  const right = ax + aw / 2;
  const top = ay - ah / 2;
  const bottom = ay + ah / 2;

  ctx.strokeStyle = "#eefdff";
  ctx.lineWidth = 36;
  ctx.beginPath();
  ctx.moveTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  const head = aw * 0.26;
  ctx.beginPath();
  ctx.moveTo(left + head, bottom - head);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left + head, bottom + head);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A holographic tap gesture: a circular pulse ring with a TAP label beside it. */
function createTapTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(${HOLO_RGB},0.95)`;
  ctx.shadowBlur = 34;

  const cx = 145;
  const cy = 256;

  // Concentric pulsing rings.
  ctx.strokeStyle = HOLO_COLOR;
  ctx.lineWidth = 16;
  for (const r of [58, 96, 134]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Filled core dot.
  ctx.fillStyle = "rgba(94,200,255,0.28)";
  ctx.beginPath();
  ctx.arc(cx, cy, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = HOLO_COLOR;
  ctx.lineWidth = 10;
  ctx.stroke();

  // TAP label beside the pulse.
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#eefdff";
  ctx.font = "800 110px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("TAP", 300, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function makeKeycapGeometry(): THREE.ExtrudeGeometry {
  const W = KEYCAP_W;
  const T = KEYCAP_TOTAL_H;
  const r = KEYCAP_R;
  const x0 = -W / 2;
  const x1 = W / 2;
  const y0 = -T / 2;
  const y1 = T / 2;
  const mainTop = y0 + KEYCAP_H;
  const extLeft = x1 - KEYCAP_EXT_W;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(extLeft + r, y1);
  shape.quadraticCurveTo(extLeft, y1, extLeft, y1 - r);
  shape.lineTo(extLeft, mainTop);
  shape.lineTo(x0 + r, mainTop);
  shape.quadraticCurveTo(x0, mainTop, x0, mainTop - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: KEYCAP_D,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.018,
    bevelSegments: 4,
    curveSegments: 12,
  });
  geo.center();
  return geo;
}

/** A quiet orb at rest that flips into a holographic Enter key as the car pulls up. */
export default function HoloKeyPrompt({
  active,
  visible = true,
  onActivate,
  position = [0, 0, 0],
  rotation,
  scale = 1,
  night = true,
  touch = false,
}: HoloKeyPromptProps) {
  const groupRef = useRef<THREE.Group>(null);
  const orbRef = useRef<THREE.Group>(null);
  const keycapRef = useRef<THREE.Group>(null);
  const nearness = useRef(0);
  const worldQuat = useRef(new THREE.Quaternion());
  const parentWorldQuat = useRef(new THREE.Quaternion());
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  hoveredRef.current = hovered;

  const assets = useMemo(() => {
    const blending = night ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (touch) {
      const tapTex = createTapTexture();
      const tapMat = new THREE.MeshBasicMaterial({
        map: tapTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending,
        side: THREE.DoubleSide,
      });
      return { mode: "tap" as const, tapTex, tapMat };
    }
    const keycapGeo = makeKeycapGeometry();
    const keycapTex = createKeycapTexture();
    const keycapEdges = new THREE.EdgesGeometry(keycapGeo, 15);
    const keycapBody = new THREE.MeshBasicMaterial({
      color: HOLO_COLOR,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      blending,
      side: THREE.DoubleSide,
    });
    const keycapEdgeMat = new THREE.LineBasicMaterial({
      color: HOLO_COLOR,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      fog: false,
    });
    const keycapFace = new THREE.MeshBasicMaterial({
      map: keycapTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      blending,
    });
    return {
      mode: "key" as const,
      keycapGeo,
      keycapTex,
      keycapEdges,
      keycapBody,
      keycapEdgeMat,
      keycapFace,
    };
  }, [night, touch]);

  useEffect(() => {
    return () => {
      if (assets.mode === "tap") {
        assets.tapTex.dispose();
        assets.tapMat.dispose();
        return;
      }
      assets.keycapGeo.dispose();
      assets.keycapTex.dispose();
      assets.keycapEdges.dispose();
      assets.keycapBody.dispose();
      assets.keycapEdgeMat.dispose();
      assets.keycapFace.dispose();
    };
  }, [assets]);

  useEffect(() => {
    if (active && visible) return;
    setHovered(false);
    document.body.style.cursor = "";
  }, [active, visible]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    nearness.current += ((active ? 1 : 0) - nearness.current) * (1 - Math.exp(-9 * Math.min(delta, 0.05)));
    const n = nearness.current;
    const ne = n * n * (3 - 2 * n);

    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.6) * 0.035;
      // Billboard in world space, accounting for rotated parents (e.g. project landmarks)
      worldQuat.current.copy(state.camera.quaternion);
      if (groupRef.current.parent) {
        groupRef.current.parent.getWorldQuaternion(parentWorldQuat.current);
        worldQuat.current.premultiply(parentWorldQuat.current.invert());
      }
      groupRef.current.quaternion.copy(worldQuat.current);
    }
    if (orbRef.current) {
      const s = Math.max(0.001, 1 - ne);
      orbRef.current.visible = s > 0.02;
      orbRef.current.scale.setScalar(s);
      orbRef.current.rotation.y = t * 1.1;
      orbRef.current.rotation.x = t * 0.5;
    }
    if (keycapRef.current) {
      const hoverScale = hoveredRef.current ? 1.07 : 1;
      const tapPulse = touch ? 1 + Math.sin(t * 3.2) * 0.045 : 1;
      const s = Math.max(0.001, ne * hoverScale * tapPulse);
      keycapRef.current.visible = s > 0.02;
      keycapRef.current.scale.setScalar(s);
      keycapRef.current.rotation.z = (1 - ne) * -0.6;
    }
  });

  return (
    <group ref={groupRef} position={position} scale={scale} visible={visible}>
      <group ref={orbRef}>
        <mesh>
          <icosahedronGeometry args={[0.1, 0]} />
          <meshBasicMaterial
            color={HOLO_COLOR}
            transparent
            opacity={0.85}
            toneMapped={false}
            depthWrite={false}
            blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
        </mesh>
        <mesh rotation={[0.7, 0.3, 0]}>
          <torusGeometry args={[0.18, 0.006, 8, 40]} />
          <meshBasicMaterial
            color={HOLO_COLOR}
            transparent
            opacity={0.55}
            toneMapped={false}
            depthWrite={false}
            blending={night ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
        </mesh>
      </group>

      <group
        ref={keycapRef}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "";
        }}
      >
        {assets.mode === "tap" ? (
          <mesh material={assets.tapMat} position={[0, 0, 0.02]}>
            <planeGeometry args={[1.8, 1.8]} />
          </mesh>
        ) : (
          <>
            <mesh geometry={assets.keycapGeo} material={assets.keycapBody} />
            <lineSegments geometry={assets.keycapEdges} material={assets.keycapEdgeMat} />
            <mesh position={[0, 0, KEYCAP_D / 2 + 0.02]} material={assets.keycapFace}>
              <planeGeometry args={[KEYCAP_W, KEYCAP_TOTAL_H]} />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const HOLO_RGB = "94,200,255";
const CORE = "#eefdff";

export type HoloLineSpec = {
  text: string;
  size: number;
  family: string;
  weight: number;
  italic?: boolean;
  textWidth: number;
  x: number;
  y: number;
  z: number;
  color: string;
  spacing?: number;
  delay: number;
  /** Optional URL: the line becomes a clickable link that opens in a new browser page. */
  link?: string;
  underline?: boolean;
};

type HoloTextProps = {
  lines: HoloLineSpec[];
  active: boolean;
  /** Additive blending for night; normal blending keeps the text readable in daylight. */
  night?: boolean;
  /** Mobile portrait: stack the text above the hologram instead of beside it. */
  mobile?: boolean;
  /** Fixed facing rotation for each text line. When omitted, lines billboard to face the camera. */
  rotation?: [number, number, number];
};

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Draw one line of glowing holographic type onto a transparent canvas and fit it to a world width. */
function createHoloTextTexture(spec: HoloLineSpec) {
  const font = `${spec.italic ? "italic " : ""}${spec.weight} ${spec.size}px ${spec.family}`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  setSpacing(probe, spec.spacing ?? 0);
  const textW = Math.max(1, probe.measureText(spec.text).width);

  const padX = Math.ceil(spec.size * 0.85);
  const padY = Math.ceil(spec.size * 0.85);
  const w = Math.ceil(textW + padX * 2);
  const h = Math.ceil(spec.size * 1.35 + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  setSpacing(ctx, spec.spacing ?? 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = w / 2;
  const cy = h / 2;

  ctx.fillStyle = spec.color;
  ctx.shadowColor = `rgba(${HOLO_RGB},0.95)`;
  ctx.shadowBlur = spec.size * 0.55;
  ctx.fillText(spec.text, cx, cy);
  ctx.fillText(spec.text, cx, cy);

  ctx.shadowBlur = 0;
  ctx.fillStyle = CORE;
  ctx.fillText(spec.text, cx, cy);

  if (spec.underline) {
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = Math.max(2, spec.size * 0.025);
    ctx.shadowColor = `rgba(${HOLO_RGB},0.9)`;
    ctx.shadowBlur = spec.size * 0.25;
    const y = cy + spec.size * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - textW / 2, y);
    ctx.lineTo(cx + textW / 2, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const planeW = (spec.textWidth * w) / textW;
  return { tex, planeW, planeH: (planeW * h) / w };
}

/** A column of free-floating holographic lines that ease in when active. Faces camera by default, or uses a fixed rotation when provided. */
export default function HoloText({ lines, active, night = true, mobile = false, rotation }: HoloTextProps) {
  const reveal = useRef(0);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const worldQuat = useRef(new THREE.Quaternion());
  const parentWorldQuat = useRef(new THREE.Quaternion());

  // On mobile portrait, stack the writing above the hologram instead of beside it.
  const adjustedLines = useMemo(() => {
    if (!mobile) return lines;
    return lines.map((l) => ({ ...l, x: 0, y: l.y + 2.6 }));
  }, [lines, mobile]);

  const assets = useMemo(() => {
    return adjustedLines.map((spec) => {
      const { tex, planeW, planeH } = createHoloTextTexture(spec);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        blending: night ? THREE.AdditiveBlending : THREE.NormalBlending,
        opacity: 0,
      });
      const geo = new THREE.PlaneGeometry(planeW, planeH);
      return { spec, tex, mat, geo };
    });
  }, [adjustedLines, night]);

  useEffect(() => {
    return () => {
      assets.forEach((line) => {
        line.geo.dispose();
        line.mat.dispose();
        line.tex.dispose();
      });
    };
  }, [assets]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    reveal.current += ((active ? 1 : 0) - reveal.current) * (1 - Math.exp(-4.5 * Math.min(delta, 0.05)));
    const r = reveal.current;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let flick = 1 - 0.015 * Math.abs(Math.sin(t * 47) * Math.sin(t * 13));
    if (Math.sin(t * 3.1) > 0.985) flick *= 0.93;

    assets.forEach((line, i) => {
      const g = refs.current[i];
      if (!g) return;
      const e = clamp((r - line.spec.delay) * 2.6);
      const eased = 1 - Math.pow(1 - e, 3);
      g.visible = e > 0.01;
      if (!g.visible) return;
      if (rotation) {
        g.rotation.set(rotation[0], rotation[1], rotation[2]);
      } else {
        // Billboard in world space, accounting for rotated parents (e.g. hologram landmarks)
        worldQuat.current.copy(state.camera.quaternion);
        if (g.parent) {
          g.parent.getWorldQuaternion(parentWorldQuat.current);
          worldQuat.current.premultiply(parentWorldQuat.current.invert());
        }
        g.quaternion.copy(worldQuat.current);
      }
      g.scale.setScalar(0.88 + 0.12 * eased);
      g.position.set(line.spec.x, line.spec.y + Math.sin(t * 0.9 + i * 1.7) * 0.004, line.spec.z);
      line.mat.opacity = eased * flick * 0.95;
    });
  });

  return (
    <group>
      {assets.map((line, i) => (
        <group
          key={line.spec.text}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[line.spec.x, line.spec.y, line.spec.z]}
          visible={false}
          onClick={
            line.spec.link
              ? (e) => {
                  e.stopPropagation();
                  window.open(line.spec.link!, "_blank", "noopener,noreferrer");
                }
              : undefined
          }
          onPointerOver={
            line.spec.link
              ? (e) => {
                  e.stopPropagation();
                  document.body.style.cursor = "pointer";
                }
              : undefined
          }
          onPointerOut={
            line.spec.link
              ? () => {
                  document.body.style.cursor = "";
                }
              : undefined
          }
        >
          <mesh geometry={line.geo} material={line.mat} renderOrder={2} userData={{ link: line.spec.link }} />
        </group>
      ))}
    </group>
  );
}

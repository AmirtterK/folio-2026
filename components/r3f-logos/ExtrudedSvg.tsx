"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { ThreeElements } from "@react-three/fiber";

export type GradientStop = [offset: number, color: string];

export type SvgLayer = {
  /** SVG path `d` attribute */
  d: string;
  fill: string;
  /** Linear gradient in SVG user units; overrides `fill` when set */
  gradient?: { y1: number; y2: number; stops: GradientStop[] };
  /** Extrusion depth as a fraction of the viewBox width */
  depth?: number;
  /** Z offset as a fraction of the viewBox width */
  z?: number;
};

type Common = {
  viewBox: [width: number, height: number];
  /** World-space size of the largest viewBox side */
  size?: number;
  /** Multiplies every layer's depth */
  thickness?: number;
  /** Bevel size as a fraction of the viewBox width (0 disables) */
  bevel?: number;
  /** Replaces every fill (gradients are dropped) */
  color?: string;
  metalness?: number;
  roughness?: number;
  curveSegments?: number;
};

export type ExtrudedSvgProps = Omit<ThreeElements["group"], "children" | "layers"> &
  Common & {
    /** Explicit path layers (used by the AI logos) ... */
    layers?: SvgLayer[];
    /** ...or a whole SVG document string (used by the tech logos) */
    svg?: string;
    /** Extrusion depth for `svg` mode, as a fraction of the viewBox width */
    depth?: number;
  };

/** What a logo component accepts: everything except the source geometry. */
export type LogoProps = Omit<ExtrudedSvgProps, "layers" | "svg" | "viewBox">;

type Item = {
  shapes: THREE.Shape[];
  fill: string;
  depth: number;
  z: number;
  gradient?: SvgLayer["gradient"];
};

function lerpStops(stops: GradientStop[], t: number) {
  const c = new THREE.Color();
  if (t <= stops[0][0]) return c.set(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return c.set(ca).lerp(new THREE.Color(cb), (t - a) / (b - a || 1));
    }
  }
  return c.set(stops[stops.length - 1][1]);
}

export function ExtrudedSvg({
  layers,
  svg,
  depth = 0.08,
  viewBox,
  size = 2,
  thickness = 1,
  bevel = 0.006,
  color,
  metalness = 0.15,
  roughness = 0.4,
  curveSegments = 16,
  ...groupProps
}: ExtrudedSvgProps) {
  const [vbW, vbH] = viewBox;

  const built = useMemo(() => {
    const loader = new SVGLoader();
    const items: Item[] = [];

    if (svg) {
      loader.parse(svg).paths.forEach((p, i) => {
        const fillStyle = p.userData?.style?.fill;
        if (fillStyle === "none") return;
        items.push({
          shapes: p.toShapes(true),
          fill: `#${p.color.getHexString()}`,
          depth,
          z: i * 0.0004, // tiny offset so stacked paths never z-fight
        });
      });
    }
    for (const l of layers ?? []) {
      const parsed = loader.parse(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="${l.d}"/></svg>`
      );
      items.push({
        shapes: parsed.paths.flatMap((p) => p.toShapes(true)),
        fill: l.fill,
        depth: l.depth ?? depth,
        z: l.z ?? 0,
        gradient: l.gradient,
      });
    }

    return items.map((it) => {
      const b = bevel * vbW;
      const geometry = new THREE.ExtrudeGeometry(it.shapes, {
        depth: it.depth * vbW * thickness,
        curveSegments,
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelOffset: -b, // keeps the silhouette identical to the SVG
        bevelSegments: 2,
      });

      const useGradient = !!it.gradient && !color;
      if (useGradient) {
        const { y1, y2, stops } = it.gradient!;
        const pos = geometry.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const t = THREE.MathUtils.clamp((pos.getY(i) - y1) / (y2 - y1), 0, 1);
          const c = lerpStops(stops, t);
          colors.set([c.r, c.g, c.b], i * 3);
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }

      geometry.translate(-vbW / 2, -vbH / 2, 0);
      return { geometry, fill: it.fill, z: it.z * vbW * thickness, useGradient };
    });
  }, [layers, svg, depth, vbW, vbH, thickness, bevel, curveSegments, color]);

  useEffect(() => () => built.forEach((b) => b.geometry.dispose()), [built]);

  const s = size / Math.max(vbW, vbH);

  return (
    <group {...groupProps}>
      {/* SVG is y-down; the negative Y scale flips it upright (Three flips face winding for us) */}
      <group scale={[s, -s, s]}>
        {built.map(({ geometry, fill, z, useGradient }, i) => (
          <mesh key={i} geometry={geometry} position={[0, 0, z]} castShadow receiveShadow>
            <meshStandardMaterial
              color={useGradient ? "#ffffff" : color ?? fill}
              vertexColors={useGradient}
              metalness={metalness}
              roughness={roughness}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

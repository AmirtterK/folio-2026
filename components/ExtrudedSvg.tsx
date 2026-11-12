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
  /** Linear gradient in SVG user units, overrides `fill` when set */
  gradient?: { y1: number; y2: number; stops: GradientStop[] };
  /** Extrusion depth as a fraction of the viewBox width */
  depth?: number;
  /** Z offset as a fraction of the viewBox width */
  z?: number;
};

export type ExtrudedSvgProps = Omit<ThreeElements["group"], "children" | "layers"> & {
  layers: SvgLayer[];
  viewBox: [width: number, height: number];
  /** World-space size of the largest viewBox side */
  size?: number;
  /** Multiplies every layer's depth */
  thickness?: number;
  /** Bevel size as a fraction of the viewBox width (0 disables) */
  bevel?: number;
  /** Replaces every layer's fill (gradients are dropped) */
  color?: string;
  metalness?: number;
  roughness?: number;
  curveSegments?: number;
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
  viewBox,
  size = 2,
  thickness = 1,
  bevel = 0.006,
  color,
  metalness = 0.1,
  roughness = 0.45,
  curveSegments = 16,
  ...groupProps
}: ExtrudedSvgProps) {
  const [vbW, vbH] = viewBox;

  const built = useMemo(() => {
    const loader = new SVGLoader();
    return layers.map((layer) => {
      const data = loader.parse(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="${layer.d}"/></svg>`
      );
      const shapes = data.paths.flatMap((p) => p.toShapes(true));

      const depth = (layer.depth ?? 0.08) * vbW * thickness;
      const b = bevel * vbW;
      const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth,
        curveSegments,
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelOffset: -b, // keep the silhouette identical to the SVG
        bevelSegments: 2,
      });

      if (layer.gradient && !color) {
        const { y1, y2, stops } = layer.gradient;
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
      return { geometry, layer, gradient: !!layer.gradient && !color };
    });
  }, [layers, vbW, vbH, thickness, bevel, curveSegments, color]);

  useEffect(() => () => built.forEach((b) => b.geometry.dispose()), [built]);

  const s = size / Math.max(vbW, vbH);

  return (
    <group {...groupProps}>
      {/* SVG is y-down: the negative Y scale flips it upright (Three flips face winding for us) */}
      <group scale={[s, -s, s]}>
        {built.map(({ geometry, layer, gradient }, i) => (
          <mesh
            key={i}
            geometry={geometry}
            position={[0, 0, (layer.z ?? 0) * vbW * thickness]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={gradient ? "#ffffff" : color ?? layer.fill}
              vertexColors={gradient}
              metalness={metalness}
              roughness={roughness}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

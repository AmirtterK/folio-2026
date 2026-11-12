"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { ThreeElements } from "@react-three/fiber";
import { shapesFromPath } from "./svgShapes";

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
  /**
   * Cut-outs (letters, eyes, counters) are filled with a contrasting solid so
   * the logo never looks hollow. Omit for an automatic light/dark contrast
   * colour (an SVG path can override it with a `data-hole="#hex"` attribute; `data-depth` / `data-z` per path set its own extrusion and offset), pass a colour to choose it, or `false` to keep the see-through holes.
   */
  holeColor?: string | false;
  /**
   * Non-reflective finish (Lambert): the logo shows its own colour whatever the
   * environment map / lights reflect. Ignores metalness and roughness.
   */
  matte?: boolean;
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
  /** true for the hole-filling pieces, which keep their own colour */
  inlay?: boolean;
};

/** Light bodies get a near-black inlay, dark/saturated bodies get white. */
function contrastOf(hex: string) {
  const { l } = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
  return l > 0.55 ? "#111111" : "#ffffff";
}

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
  holeColor,
  matte = false,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fillStyle = (p.userData as any)?.style?.fill;
        if (fillStyle === "none") return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ud = (p.userData ?? {}) as any;
        const rule = (ud.node as Element | undefined)?.getAttribute?.("fill-rule") ?? ud.style?.fillRule ?? ud.style?.["fill-rule"];
        const shapes = shapesFromPath(p, rule === "evenodd", curveSegments);
        const fill = `#${p.color.getHexString()}`;
        const node = ud.node as Element | undefined;
        const pDepth = node?.getAttribute?.("data-depth");
        const pZ = node?.getAttribute?.("data-z");
        const d = pDepth ? parseFloat(pDepth) : depth;
        const z0 = pZ ? parseFloat(pZ) : 0;
        const nodeHole = node?.getAttribute?.("data-hole");
        items.push({
          shapes,
          fill,
          depth: d,
          z: z0 + i * 0.0004, // tiny offset so stacked paths never z-fight
        });

        // Fill the cut-outs with a solid inlay. It is thinner than the body and
        // sits centred in it, so the body (and any island inside the hole, like
        // the counters of the PHP "p") stays proud of it and nothing z-fights.
        if (holeColor !== false) {
          const inlay = shapes.flatMap((s) =>
            s.holes.map((h) => new THREE.Shape(h.getPoints(curveSegments)))
          );
          if (inlay.length) {
            items.push({
              shapes: inlay,
              fill: nodeHole ?? holeColor ?? contrastOf(color ?? fill),
              depth: d * 0.7,
              z: z0 + d * 0.15 + i * 0.0004 + 0.0002,
              inlay: true,
            });
          }
        }
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
      return { geometry, fill: it.fill, z: it.z * vbW * thickness, useGradient, inlay: !!it.inlay };
    });
  }, [layers, svg, depth, vbW, vbH, thickness, bevel, curveSegments, color, holeColor]);

  useEffect(() => () => built.forEach((b) => b.geometry.dispose()), [built]);

  const s = size / Math.max(vbW, vbH);

  return (
    <group {...groupProps}>
      {/* SVG is y-down; the negative Y scale flips it upright (Three flips face winding for us) */}
      <group scale={[s, -s, s]}>
        {built.map(({ geometry, fill, z, useGradient, inlay }, i) => (
          <mesh key={i} geometry={geometry} position={[0, 0, z]} castShadow receiveShadow>
            {matte ? (
              <meshLambertMaterial
                color={useGradient ? "#ffffff" : inlay ? fill : color ?? fill}
                emissive={useGradient ? "#000000" : inlay ? fill : color ?? fill}
                emissiveIntensity={0.18}
                vertexColors={useGradient}
              />
            ) : (
              <meshStandardMaterial
                color={useGradient ? "#ffffff" : inlay ? fill : color ?? fill}
                vertexColors={useGradient}
                metalness={metalness}
                roughness={roughness}
              />
            )}
          </mesh>
        ))}
      </group>
    </group>
  );
}

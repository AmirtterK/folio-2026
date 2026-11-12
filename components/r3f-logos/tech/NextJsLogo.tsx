"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { LogoProps } from "../ExtrudedSvg";

// Source: Devicon (nextjs-plain.svg)
// Subpath 0 = the black disc with the left part of the "N" cut into its edge,
// subpath 1 = the right-hand bar of the "N" (a hole in the disc),
// subpath 2 = a zero-area sliver that is ignored.
// The hole is added explicitly below instead of being inferred from the path's winding
// direction (which different Three versions read differently and used to leave the bar filled).
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M64 0A64 64 0 0 0 0 64a64 64 0 0 0 64 64 64 64 0 0 0 35.508-10.838L47.014 49.34v40.238H38.4V38.4h10.768l57.125 73.584A64 64 0 0 0 128 64 64 64 0 0 0 64 0Zm17.777 38.4h8.534v48.776L81.777 75.97Zm24.18 73.92-.111.096a64 64 0 0 0 .111-.096z"/></svg>';

const VB = 128;

export function NextJsLogo({
  size = 2,
  depth = 0.08,
  thickness = 1,
  bevel = 0.006,
  color = "#0a0a0a",
  matte = true,
  metalness = 0.15,
  roughness = 0.4,
  curveSegments = 16,
  // accepted for API parity with the other logos; the "N" is always see-through
  holeColor: _holeColor,
  ...groupProps
}: LogoProps) {
  const geometry = useMemo(() => {
    const sub = new SVGLoader().parse(SVG).paths[0].subPaths;
    const outer = new THREE.Shape(sub[0].getPoints(curveSegments));
    outer.holes.push(new THREE.Path(sub[1].getPoints(curveSegments))); // right bar of the N: hollow
    const b = bevel * VB;
    const g = new THREE.ExtrudeGeometry(outer, {
      depth: depth * VB * thickness,
      curveSegments,
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: -b,
      bevelSegments: 2,
    });
    g.translate(-VB / 2, -VB / 2, 0);
    return g;
  }, [depth, thickness, bevel, curveSegments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const s = size / VB;

  return (
    <group {...groupProps}>
      {/* SVG is y-down; the negative Y scale flips it upright */}
      <group scale={[s, -s, s]}>
        <mesh geometry={geometry} castShadow receiveShadow>
          {matte ? (
            <meshLambertMaterial color={color} emissive={color} emissiveIntensity={0.18} />
          ) : (
            <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
          )}
        </mesh>
      </group>
    </group>
  );
}

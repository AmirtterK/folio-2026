"use client";

import { ExtrudedSvg, type LogoProps, type SvgLayer } from "../ExtrudedSvg";

// viewBox is 240x300; the source's mask/clip are full-canvas rects, so they are dropped
const LAYERS: SvgLayer[] = [
  // outer frame (square cut-out in the middle)
  {
    d: "M180 60H60V240H180V60ZM240 300H0V0H240V300Z",
    fill: "#EEEEEE",
    depth: 0.1,
  },
  // dark inner block, recessed slightly into the frame
  {
    d: "M180 240H60V120H180V240Z",
    fill: "#4B4B4B",
    depth: 0.06,
  },
];

export function OpenCodeLogo(props: LogoProps) {
  return <ExtrudedSvg layers={LAYERS} viewBox={[240, 300]} {...props} />;
}

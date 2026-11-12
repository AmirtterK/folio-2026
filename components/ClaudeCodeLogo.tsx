"use client";

import { ExtrudedSvg, type ExtrudedSvgProps, type SvgLayer } from "./ExtrudedSvg";

const LAYERS: SvgLayer[] = [
  {
    d: "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z",
    fill: "#D97757",
    depth: 0.1,
  },
];

export type LogoProps = Omit<ExtrudedSvgProps, "layers" | "viewBox">;

export function ClaudeCodeLogo(props: LogoProps) {
  return <ExtrudedSvg layers={LAYERS} viewBox={[24, 24]} {...props} />;
}

"use client";

import { ExtrudedSvg, type LogoProps } from "../ExtrudedSvg";

// Source: Devicon (flutter-plain.svg)
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><path fill=\"#1e88e5\" d=\"M12.3 64.2L76.3 0h39.4L32.1 83.6zM76.3 128h39.4L81.6 93.9l34.1-34.8H76.3L42.2 93.5z\"/></svg>";

export function FlutterLogo(props: LogoProps) {
  return <ExtrudedSvg svg={SVG} viewBox={[128, 128]} color="#1e88e5" matte {...props} />;
}

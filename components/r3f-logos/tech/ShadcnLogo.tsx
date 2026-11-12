"use client";

import { ExtrudedSvg, type LogoProps } from "../ExtrudedSvg";

// Source: Devicon (shadcn-original.svg)
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><path d=\"m113.872 60.82-53.036 53.036a8.24 8.24 0 0 0 0 11.73 8.247 8.247 0 0 0 11.66 0l53.035-53.035a8.24 8.24 0 0 0 0-11.73 8.24 8.24 0 0 0-11.73 0zm1.137-58.367a8.24 8.24 0 0 0-11.73 0L2.469 103.263a8.24 8.24 0 0 0 0 11.73 8.247 8.247 0 0 0 11.66 0l100.81-100.81a8.24 8.24 0 0 0 0-11.73z\" class=\"b\"/></svg>";

export function ShadcnLogo(props: LogoProps) {
  return <ExtrudedSvg svg={SVG} viewBox={[128, 128]} color="#ffffff" {...props} />;
}

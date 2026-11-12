"use client";

import { ExtrudedSvg, type LogoProps } from "../ExtrudedSvg";

// Source: Devicon (supabase-original.svg) - bolt placed on a black tile
// black tile + green bolt: `data-depth` / `data-z` make the bolt stand proud of the tile
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><path fill=\"#0a0a0a\" d=\"M24 0h80a24 24 0 0 1 24 24v80a24 24 0 0 1-24 24H24A24 24 0 0 1 0 104V24A24 24 0 0 1 24 0z\"/><path fill=\"#3ecf8e\" data-depth=\"0.045\" data-z=\"0.075\" transform=\"translate(25.6 25.6) scale(.6)\" d=\"M53.484 2.128c3.267-4.117 9.905-1.862 9.977 3.396l.508 76.907H12.902c-9.365 0-14.587-10.817-8.764-18.149z\"/><path fill=\"#3ecf8e\" data-depth=\"0.045\" data-z=\"0.075\" transform=\"translate(25.6 25.6) scale(.6) translate(-27.722 -60.338)\" d=\"M102.24 186.21c-3.267 4.117-9.904 1.862-9.977-3.397l-1.156-76.906h51.715c9.365 0 14.587 10.817 8.763 18.149z\"/></svg>";

export function SupabaseLogo(props: LogoProps) {
  return <ExtrudedSvg svg={SVG} viewBox={[128, 128]} matte {...props} />;
}

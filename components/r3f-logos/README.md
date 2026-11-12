# r3f-logos

3D (extruded) React Three Fiber versions of 23 logos: 19 tech logos + 4 AI-tool logos.

## Install

    npm i three @react-three/fiber @react-three/drei
    npm i -D @types/three

(`drei` is only needed for `LogosScene.tsx`; the logo components need just `three` + `@react-three/fiber`.)

Copy this folder into your project, e.g. `components/logos/`.

## Use

    import { Canvas } from "@react-three/fiber";
    import { PythonLogo, NextJsLogo } from "@/components/logos";

    <Canvas>
      <ambientLight />
      <directionalLight position={[3, 5, 5]} />
      <PythonLogo position={[-1.5, 0, 0]} size={2} />
      <NextJsLogo position={[1.5, 0, 0]} color="#fff" thickness={1.5} />
    </Canvas>

All logos accept group props (`position`, `rotation`, `scale`...) plus:

| prop           | default | meaning                                          |
|----------------|---------|--------------------------------------------------|
| `size`         | 2       | world size of the logo's largest side            |
| `thickness`    | 1       | extrusion depth multiplier                       |
| `color`        | brand   | overrides the fill (tech logos default to brand colour, white if the brand is near-black) |
| `bevel`        | 0.006   | bevel as a fraction of width, 0 = sharp edges    |
| `metalness` / `roughness` | 0.15 / 0.4 | material                         |

## Contents

- `ExtrudedSvg.tsx` — shared helper (SVG -> SVGLoader -> ExtrudeGeometry)
- `tech/` — JavaScript, TypeScript, Tailwind, NextJs, ThreeJs, Express, Vite, Git, Php, MySql, Shadcn, Flutter, Dart, Firebase, Sqlite, Arduino, C, Python, Java
- `ai/` — ClaudeCode, Codex, OpenAI, OpenCode
- `svg/` — the original tech SVGs (from Devicon, MIT)
- `LogosScene.tsx` — demo canvas showing all of them

Logos are trademarks of their respective owners.

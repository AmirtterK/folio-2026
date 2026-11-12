# Folio 2026

A small Next.js test bench for the portfolio car models, using the same stack as Neural Flows (Next.js 16, React 19, R3F 9, drei 10, three 0.170).

- **Detailed + smoke:** `components/FolioCar.tsx`, the main car with exhaust smoke and all selectable models.
- **Detailed:** `components/FolioCarBase.tsx`, the safe original. Edit the smoke version, not this one.
- **Classic (HTML):** `public/classic-car.html`, the standalone low-poly version (loads Three.js r128 from a CDN).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use the tabs at the top left to switch between the versions.

## Controls

| Input | Action |
|---|---|
| W / S or Up / Down | drive forward / reverse |
| A / D or Left / Right | steer |
| Space | brake |
| On-screen buttons | same as the keys (mobile-friendly) |
| M or **Map** button | open the full-screen track map |
| R | reset the car to the grid |
| F | toggle free camera |
| Hand gestures | tick **Hand gestures** (top bar), see below |
| Drag / scroll | orbit / zoom |

The "Paint" picker changes the car's color, and the "Smoke" checkbox toggles the exhaust on the smoke version. On phones, the top bar scrolls horizontally and the driving buttons sit above the safe area.

## Hand gestures

Tick **Hand gestures** in the top bar and allow camera access. A small preview shows your hand and what the car is reading. It works on every 3D tab and the keys and buttons keep working alongside it.

| Gesture | Action |
|---|---|
| Open palm (four fingers up) | drive forward |
| Fist | brake |
| Index + middle finger only | reverse |
| Tilt hand left / right | steer, proportional to the tilt |
| Anything else, or no hand | coast |

Tips: keep your hand upright in front of the camera with decent light, hold a gesture for a split second, and make a fist to stop inside a pit box. Unticking the box (or leaving the 3D tabs) releases the camera.

Hand tracking is MediaPipe's Hand Landmarker (`@mediapipe/tasks-vision`) and runs in the browser, so no video leaves your machine. The WASM runtime is copied into `public/mediapipe/wasm` by `scripts/copy-mediapipe.mjs` (runs on `npm install`); the 8 MB model file is downloaded from Google's MediaPipe storage the first time you switch gestures on, so that part needs internet.

## Smoke

`FolioCar` takes the same props as `FolioCarBase`, plus `smoke` (default true) and `smokeColor`. The exhaust layout follows each car: the S15 and Stingray use a single left-side tip, while the Panamera and F599 use twin tips. Puffs blow backward (forward when reversing) so the stationary car looks like it is moving. Nothing comes out when stopped.

## Layout

```
app/layout.tsx              root layout
app/page.tsx                loads FolioScene with SSR off (WebGL is browser-only)
components/FolioScene.tsx   tabs, buttons, color picker, canvas
components/HandGestures.tsx webcam hand-gesture controls (MediaPipe)
scripts/copy-mediapipe.mjs  copies the MediaPipe WASM runtime into public/
components/FolioCarBase.tsx the detailed car (safe copy)
components/FolioCar.tsx     the detailed car with exhaust smoke
public/classic-car.html     classic version
```

## Notes

- The cars use the drei `Environment` preset for glossy reflections. The preset downloads its lighting map from the internet, so paint looks flat when offline.
- To use a car in another project, copy its `.tsx` file and make sure `three`, `@react-three/fiber` and `@react-three/drei` are installed.

# Toy car lab

A small Next.js test bench for the toy car models, using the same stack as Neural Flows (Next.js 15, React 19, R3F 9, drei 10, three 0.170).

- **Detailed + smoke:** `components/ToyCarSmoke.tsx`, a separate copy of the detailed car with exhaust smoke.
- **Detailed:** `components/ToyCar.tsx`, the safe original. Edit the smoke version, not this one.
- **Classic (HTML):** `public/toy-car.html`, the standalone low-poly version (loads Three.js r128 from a CDN).

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
| On-screen buttons | same as the keys |
| Hand gestures | tick **Hand gestures** (top bar), see below |
| Drag / scroll | orbit / zoom |

The "Paint" picker changes the car's color, and the "Smoke" checkbox toggles the exhaust on the smoke version.

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

`ToyCarSmoke` takes the same props as `ToyCar`, plus `smoke` (default true) and `smokeColor`. Both tailpipes puff while the car drives, more with throttle and speed. Puffs blow backward (forward when reversing) so the stationary car looks like it is moving. Nothing comes out when stopped.

## Layout

```
app/layout.tsx              root layout
app/page.tsx                loads CarLab with SSR off (WebGL is browser-only)
components/CarLab.tsx       tabs, buttons, color picker, canvas
components/HandGestures.tsx webcam hand-gesture controls (MediaPipe)
scripts/copy-mediapipe.mjs  copies the MediaPipe WASM runtime into public/
components/ToyCar.tsx       the detailed car (safe copy)
components/ToyCarSmoke.tsx  the detailed car with exhaust smoke
public/toy-car.html         classic version
```

## Notes

- The cars use the drei `Environment` preset for glossy reflections. The preset downloads its lighting map from the internet, so paint looks flat when offline.
- To use a car in another project, copy its `.tsx` file and make sure `three`, `@react-three/fiber` and `@react-three/drei` are installed.

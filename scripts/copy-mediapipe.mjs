// Copies MediaPipe's WASM runtime from node_modules into public/mediapipe/wasm so the hand tracker
// loads it from the same origin (and from the exact version that is installed) instead of a CDN.
// Runs automatically after `npm install` (see "postinstall" in package.json).

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = resolve(root, "public/mediapipe/wasm");

if (!existsSync(src)) {
  console.warn("[mediapipe] @mediapipe/tasks-vision is not installed yet, skipping the WASM copy.");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[mediapipe] copied WASM runtime to public/mediapipe/wasm");

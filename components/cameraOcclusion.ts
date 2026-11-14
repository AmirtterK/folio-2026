/**
 * Camera vs. buildings. The orbit camera is free to swing anywhere around the car, so it kept ending up inside or
 * behind the ring of buildings. Every frame, FreeCamControls asks `resolveCameraOffset` where the camera may be:
 *
 *   1. the line from the car to the camera is clear                  -> leave it exactly where the player put it
 *   2. a building is in the way                                      -> tilt the camera up (same distance and
 *                                                                       heading) until the line clears the roof
 *   3. even looking nearly straight down it is blocked (tall wall
 *      right next to the car)                                        -> pull the camera in along the line
 *
 * The buildings are plain oriented boxes (their footprint from cityLayout.ts and their height), registered by
 * CityRing. Pure maths, no per-frame allocations.
 */

import * as THREE from "three";

export type OcclusionBox = { x: number; y: number; z: number; hw: number; hd: number; h: number; yaw: number };

let boxes: OcclusionBox[] = [];

export function setOcclusionBoxes(list: OcclusionBox[]) {
  boxes = list;
}

export function clearOcclusionBoxes(list: OcclusionBox[]) {
  if (boxes === list) boxes = [];
}

/** Boxes are grown by this much, so the camera (and its near plane) keeps a little air to the walls. */
const MARGIN = 0.8;
/** Steepest tilt, just short of the orbit controls' minimum polar angle (0.15 rad from straight up). */
const MAX_ELEVATION = Math.PI / 2 - 0.16;
const TILT_STEP = 0.05;

let t0 = 0;
let t1 = 1;
function slab(o: number, d: number, lo: number, hi: number) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  return t0 <= t1;
}

/** Where the segment o + t*d (t in 0..1) first enters the box grown by m; Infinity if it never does, -1 if o is already inside. */
function entry(b: OcclusionBox, m: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const rx = ox - b.x;
  const rz = oz - b.z;
  // same frame as pointInBox() in cityLayout.ts
  const lx = rx * c - rz * s;
  const lz = rx * s + rz * c;
  const ly = oy - b.y;
  const hx = b.hw + m;
  const hz = b.hd + m;
  const y0 = -m;
  const y1 = b.h + m;
  if (Math.abs(lx) <= hx && Math.abs(lz) <= hz && ly >= y0 && ly <= y1) return -1;
  t0 = 0;
  t1 = 1;
  if (slab(lx, dx * c - dz * s, -hx, hx) && slab(ly, dy, y0, y1) && slab(lz, dx * s + dz * c, -hz, hz)) return t0;
  return Infinity;
}

/** Fraction of the segment (origin + t*dir) at which it first meets a building, or Infinity when it is clear. */
function firstHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  let best = Infinity;
  for (const b of boxes) {
    let t = entry(b, MARGIN, ox, oy, oz, dx, dy, dz);
    // the car is hugging the wall, inside the grown box: only the real walls count
    if (t === -1) t = entry(b, 0, ox, oy, oz, dx, dy, dz);
    if (t === -1) continue;
    if (t < best) best = t;
  }
  return best;
}

/** True when nothing stands between `target` and `target + offset`. */
export function isOffsetClear(target: THREE.Vector3, offset: THREE.Vector3) {
  return boxes.length === 0 || firstHit(target.x, target.y, target.z, offset.x, offset.y, offset.z) === Infinity;
}

/** The camera offset (from `target`) closest to `offset` that is not behind a building. Writes into and returns `out`. */
export function resolveCameraOffset(target: THREE.Vector3, offset: THREE.Vector3, out: THREE.Vector3, minLength = 7) {
  if (isOffsetClear(target, offset)) return out.copy(offset);

  const r = offset.length();
  const hlen = Math.hypot(offset.x, offset.z);
  if (hlen < 1e-4) return out.copy(offset); // already looking straight down

  const hx = offset.x / hlen;
  const hz = offset.z / hlen;
  const e0 = Math.atan2(offset.y, hlen);
  const place = (el: number) => out.set(hx * r * Math.cos(el), r * Math.sin(el), hz * r * Math.cos(el));

  // 2. tilt up, keeping distance and heading
  for (let el = e0 + TILT_STEP; el < MAX_ELEVATION; el += TILT_STEP) {
    if (isOffsetClear(target, place(el))) return out;
  }

  // 3. as high as it goes, then in along the line
  place(Math.max(e0, MAX_ELEVATION));
  const t = firstHit(target.x, target.y, target.z, out.x, out.y, out.z);
  if (t !== Infinity) out.multiplyScalar(Math.min(1, Math.max(minLength / r, t * 0.98)));
  return out;
}

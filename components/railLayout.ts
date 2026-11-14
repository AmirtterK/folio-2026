/**
 * Layout of the crash barrier along both edges of the road. Pure maths (no React / three.js), so it can be unit-run
 * in node.
 *
 * The barrier is cut into modules that follow the centre line: each module runs from arc length s to s + L on the
 * line RAIL_OFFSET to the side of the centre line, so neighbouring modules always touch (the module is stretched a
 * little on the outside of a bend and squeezed on the inside). The only opening is INFIELD_GAP on the inside of
 * the main straight.
 */

import { INFIELD_GAP, RAIL_OFFSET, TrackField, inInfieldGap } from "@/components/trackCollision";

export type RailSeg = {
  /** middle of the module on the ground */
  x: number;
  z: number;
  /** rotation around Y that turns the module's local +x along the barrier */
  yaw: number;
  /** distance between the two ends of the module */
  len: number;
};

/** Native module length (post spacing x 4) and visual scale applied on top of it, see scripts/build-track-assets.py. */
export const RAIL_MODULE_LENGTH = 5.4;
export const RAIL_SCALE = 1.2;

export function layoutRails(field: TrackField, offset = RAIL_OFFSET): RailSeg[] {
  const n = field.n;
  const S = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    S[i + 1] = S[i] + Math.hypot(field.xs[j] - field.xs[i], field.zs[j] - field.zs[i]);
  }
  const total = S[n];

  const pos = (s: number) => {
    const t0 = ((s % total) + total) % total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= t0) lo = mid;
      else hi = mid;
    }
    const j = (lo + 1) % n;
    const seg = S[lo + 1] - S[lo];
    const t = seg > 0 ? (t0 - S[lo]) / seg : 0;
    return { x: field.xs[lo] + (field.xs[j] - field.xs[lo]) * t, z: field.zs[lo] + (field.zs[j] - field.zs[lo]) * t };
  };
  /** point on the line `q` units to the left (+) / right (-) of the centre line at arc length s */
  const side = (s: number, q: number) => {
    const a = pos(s - 1.2);
    const b = pos(s + 1.2);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const p = pos(s);
    return { x: p.x + -tz * q, z: p.z + tx * q };
  };

  // Cut each side by length along ITS OWN line (the outer side of a bend is longer than the centre line, the inner
  // side shorter), so every module keeps close to its natural size instead of being stretched on tight bends.
  const out: RailSeg[] = [];
  const STEP = 0.4;
  for (const sgn of [1, -1]) {
    const m = Math.ceil(total / STEP);
    const px = new Float64Array(m + 1);
    const pz = new Float64Array(m + 1);
    const cum = new Float64Array(m + 1);
    for (let i = 0; i <= m; i++) {
      const p = side((i / m) * total, offset * sgn);
      px[i] = p.x;
      pz[i] = p.z;
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    const sideLen = cum[m];
    const count = Math.max(8, Math.round(sideLen / (RAIL_MODULE_LENGTH * RAIL_SCALE)));
    const L = sideLen / count;
    const at = (c: number) => {
      let lo = 0;
      let hi = m;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= c) lo = mid;
        else hi = mid;
      }
      const seg = cum[lo + 1] - cum[lo];
      const t = seg > 0 ? (c - cum[lo]) / seg : 0;
      return { x: px[lo] + (px[lo + 1] - px[lo]) * t, z: pz[lo] + (pz[lo + 1] - pz[lo]) * t, s: ((lo + t) / m) * total };
    };
    for (let k = 0; k < count; k++) {
      const A = at(k * L);
      const B = at(Math.min((k + 1) * L, sideLen - 1e-6));
      const x = (A.x + B.x) / 2;
      const z = (A.z + B.z) / 2;
      // the opening on the inside of the main straight: no barrier there
      const cl = pos((A.s + B.s) / 2);
      if (inInfieldGap(cl.x, cl.z) && field.inside(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(-(B.z - A.z), B.x - A.x), len: Math.hypot(B.x - A.x, B.z - A.z) });
    }
  }
  return out;
}
/** Where the pushable cones stand: one row across the mouth of the opening. */
export function coneLayout(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const z = INFIELD_GAP.z - offsetToMouth();
  let i = 0;
  for (let x = INFIELD_GAP.x0 + 1.5; x <= INFIELD_GAP.x1 - 1.5; x += 3.4) {
    // tiny deterministic wobble so the row doesn't look machine-made
    const w = Math.sin(i * 12.9898) * 0.5;
    out.push({ x: x + w * 0.4, z: z + w, yaw: i * 0.9 });
    i++;
  }
  return out;
}

function offsetToMouth() {
  return RAIL_OFFSET + 0.6;
}

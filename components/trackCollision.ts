/**
 * Solid obstacles for the driving car.
 *
 * The car in FolioCar.tsx is not a Rapier body: it moves itself and asks `collide(x, z, r)` whether a circle at
 * (x, z) overlaps something, getting back a push-out vector. (The Rapier colliders in the scene only shove the
 * pushable logos and tyres around, the car drives straight through them.) This module is that `collide` function.
 *
 * Two kinds of obstacle live here:
 *  - the TRACK CORRIDOR: a continuous invisible wall that follows the whole circuit at a fixed distance from the
 *    centre line. Everywhere outside the loop the car must stay within `reach` of the track, so the ring of
 *    buildings placed right behind that wall can never be driven through or around, however fast you hit it. The
 *    infield (everything inside the loop) is open.
 *  - CIRCLE colliders (street lamps and anything else round and solid).
 */

import type { BufferGeometry, BufferAttribute } from "three";

/** How far from the track centre line the car may drive on the outside of the loop (track half width is 7). */
export const TRACK_WALL_DISTANCE = 10.8;

/** Distance from the centre line to the crash barrier on each side of the road (road half width is 7). */
export const RAIL_OFFSET = 7.4;

/**
 * The one opening in the barrier, on the inside of the main straight (the Rettifilo, z = 57.15), that leads into
 * the infield. Everything else is closed.
 */
export const INFIELD_GAP = { x0: 12, x1: 66, z: 57.15, zTol: 12 };

export type Pt = { x: number; z: number };
export type CircleCollider = { x: number; z: number; r: number };

/** Centre line of the ribbon built by buildMonzaGeometry (one point per row, the duplicated closing row dropped). */
export function ribbonCenterline(geometry: BufferGeometry): Pt[] {
  const pos = geometry.attributes.position as BufferAttribute;
  const rows = pos.count / 2;
  const out: Pt[] = [];
  for (let k = 0; k < rows - 1; k++) {
    out.push({
      x: (pos.getX(k * 2) + pos.getX(k * 2 + 1)) / 2,
      z: (pos.getZ(k * 2) + pos.getZ(k * 2 + 1)) / 2,
    });
  }
  return out;
}

/** The closed centre line of the circuit, with fast nearest-point and inside-the-loop queries. */
export class TrackField {
  readonly n: number;
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  /** Scratch result of `nearest` (reused, copy it if you need to keep it). */
  readonly hit = { d: 0, qx: 0, qz: 0 };

  constructor(points: Pt[]) {
    this.n = points.length;
    this.xs = new Float32Array(this.n);
    this.zs = new Float32Array(this.n);
    points.forEach((p, i) => {
      this.xs[i] = p.x;
      this.zs[i] = p.z;
    });
  }

  /** Distance from (x, z) to the centre line and the closest point on it. */
  nearest(x: number, z: number) {
    const { n, xs, zs, hit } = this;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const ax = xs[i];
      const az = zs[i];
      const dx = xs[j] - ax;
      const dz = zs[j] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const ex = x - px;
      const ez = z - pz;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bx = px;
        bz = pz;
      }
    }
    hit.d = Math.sqrt(best);
    hit.qx = bx;
    hit.qz = bz;
    return hit;
  }

  /** True when (x, z) is enclosed by the loop (the infield). */
  inside(x: number, z: number) {
    const { n, xs, zs } = this;
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = zs[i];
      const zj = zs[j];
      if (zi > z !== zj > z && x < ((xs[j] - xs[i]) * (z - zi)) / (zj - zi) + xs[i]) c = !c;
    }
    return c;
  }
}

/* ---------- registry used by `worldCollide` ---------- */

let corridor: { field: TrackField; reach: number } | null = null;
let rail: { field: TrackField; offset: number } | null = null;
const circleSets = new Map<string, CircleCollider[]>();
let circles: CircleCollider[] = [];

const rebuildCircles = () => {
  circles = [];
  circleSets.forEach((list) => circles.push(...list));
};

/** Install the invisible wall that keeps the car within `reach` of the track on the outside of the loop. */
export function setTrackCorridor(field: TrackField, reach = TRACK_WALL_DISTANCE) {
  corridor = { field, reach };
}

/** Remove the wall (only if `field` is still the installed one, so a remount can't remove its successor's). */
export function clearTrackCorridor(field: TrackField) {
  if (corridor && corridor.field === field) corridor = null;
}

/** Install the solid crash barrier along both edges of the road (open only at INFIELD_GAP). */
export function setTrackRail(field: TrackField, offset = RAIL_OFFSET) {
  rail = { field, offset };
}

export function clearTrackRail(field: TrackField) {
  if (rail && rail.field === field) rail = null;
}

/** True when the point on the road centre line (qx, qz) is inside the opening of the barrier. */
export function inInfieldGap(qx: number, qz: number) {
  return qx > INFIELD_GAP.x0 && qx < INFIELD_GAP.x1 && Math.abs(qz - INFIELD_GAP.z) < INFIELD_GAP.zTol;
}

/** Register (or replace) a named set of solid circles, e.g. "lamps". */
export function setCircleColliders(key: string, list: CircleCollider[]) {
  circleSets.set(key, list);
  rebuildCircles();
}

export function clearCircleColliders(key: string) {
  circleSets.delete(key);
  rebuildCircles();
}

/**
 * Solid circles that cover a rectangle (centre cx, cz, size sx by sz along the world axes). A long thing gets a row
 * of circles instead of one big blob, so the car can't drive through it but doesn't bounce off empty air either.
 */
export function boxCircles(cx: number, cz: number, sx: number, sz: number): CircleCollider[] {
  const r = Math.max(0.4, (Math.min(sx, sz) / 2) * 0.9);
  const half = Math.max(0, Math.max(sx, sz) / 2 - r);
  const n = Math.max(1, Math.ceil((half * 2) / r) + 1);
  const out: CircleCollider[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -half + (2 * half * i) / (n - 1);
    out.push(sx >= sz ? { x: cx + t, z: cz, r } : { x: cx, z: cz + t, r });
  }
  return out;
}

/**
 * `collide` for FolioCar: if a circle of radius r at (x, z) overlaps a solid, returns the vector that pushes it
 * out (pointing away from the obstacle, length = how deep it is), otherwise null.
 */
export function worldCollide(x: number, z: number, r: number): [number, number] | null {
  let bestPen = 0;
  let vx = 0;
  let vz = 0;

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = x - c.x;
    const dz = z - c.z;
    const rr = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-4;
    const pen = rr - d;
    if (pen > bestPen) {
      bestPen = pen;
      vx = (dx / d) * pen;
      vz = (dz / d) * pen;
    }
  }

  if (corridor) {
    const { field, reach } = corridor;
    const limit = reach - r;
    const m = field.nearest(x, z);
    if (m.d > limit && !field.inside(x, z)) {
      // too far from the track on the outside of the loop: push back toward the nearest bit of road
      const pen = m.d - limit;
      if (pen > bestPen) {
        bestPen = pen;
        vx = ((m.qx - x) / m.d) * pen;
        vz = ((m.qz - z) / m.d) * pen;
      }
    }
  }

  if (rail) {
    const { field, offset } = rail;
    // The barrier is a thin wall along the line `offset` units from the centre line: a car whose circle touches
    // that band is pushed out on whichever side it came from (road side or infield/outside), so it can neither
    // leave the road nor, once through the opening, be dragged back out of the infield.
    const band = 0.1 + r;
    const m = field.nearest(x, z);
    const dd = m.d - offset;
    if (dd < band && dd > -band) {
      const qx = m.qx;
      const qz = m.qz;
      const d = m.d || 1e-4;
      // the opening on the inside of the main straight is the only way through
      const open = inInfieldGap(qx, qz) && field.inside(x, z);
      if (!open) {
        const pen = band - Math.abs(dd);
        if (pen > bestPen) {
          bestPen = pen;
          const s = dd <= 0 ? 1 : -1; // road side: push toward the road, other side: away from it
          vx = (((qx - x) / d) * pen) * s;
          vz = (((qz - z) / d) * pen) * s;
        }
      }
    }
  }

  return bestPen > 0 ? [vx, vz] : null;
}

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
 *
 * Performance: the car calls `worldCollide` several times per frame (and several times per sub-step), so the
 * track queries must be cheap. `TrackField.nearest` uses a uniform grid instead of scanning every segment, and
 * `inside` answers are cached on a coarse grid away from the road edge.
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

const GRID_CELL = 16; // world units per grid cell
const MAX_RING = 6; // search at most this many cells out before falling back to a full scan
const INSIDE_CELL = 2; // coarse cache cell for `insideCached`

/** The closed centre line of the circuit, with fast nearest-point and inside-the-loop queries. */
export class TrackField {
  readonly n: number;
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  /** Scratch result of `nearest` (reused, copy it if you need to keep it). */
  readonly hit = { d: 0, qx: 0, qz: 0 };

  // uniform grid of segment indices
  private gx0 = 0;
  private gz0 = 0;
  private gw = 1;
  private gh = 1;
  private cells: number[][] = [];
  private stamp: Int32Array;
  private stampId = 0;
  private bd2 = 0;
  private bqx = 0;
  private bqz = 0;
  private insideMemo = new Map<number, boolean>();

  constructor(points: Pt[]) {
    this.n = points.length;
    this.xs = new Float32Array(this.n);
    this.zs = new Float32Array(this.n);
    points.forEach((p, i) => {
      this.xs[i] = p.x;
      this.zs[i] = p.z;
    });
    this.stamp = new Int32Array(this.n);
    this.buildGrid();
  }

  private buildGrid() {
    const { n, xs, zs } = this;
    if (n === 0) return;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (zs[i] < minZ) minZ = zs[i];
      if (zs[i] > maxZ) maxZ = zs[i];
    }
    this.gx0 = minX - GRID_CELL;
    this.gz0 = minZ - GRID_CELL;
    this.gw = Math.ceil((maxX - minX + GRID_CELL * 2) / GRID_CELL) + 1;
    this.gh = Math.ceil((maxZ - minZ + GRID_CELL * 2) / GRID_CELL) + 1;
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const x0 = Math.floor((Math.min(xs[i], xs[j]) - this.gx0) / GRID_CELL);
      const x1 = Math.floor((Math.max(xs[i], xs[j]) - this.gx0) / GRID_CELL);
      const z0 = Math.floor((Math.min(zs[i], zs[j]) - this.gz0) / GRID_CELL);
      const z1 = Math.floor((Math.max(zs[i], zs[j]) - this.gz0) / GRID_CELL);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.cells[cz * this.gw + cx].push(i);
    }
  }

  /** Test segment i against (x, z), keeping the closest result so far in bd2 / bqx / bqz. */
  private scan(i: number, x: number, z: number) {
    const { n, xs, zs } = this;
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
    if (d2 < this.bd2) {
      this.bd2 = d2;
      this.bqx = px;
      this.bqz = pz;
    }
  }

  /** Distance from (x, z) to the centre line and the closest point on it. */
  nearest(x: number, z: number) {
    const { n, hit, gw, gh, cells } = this;
    this.bd2 = Infinity;
    this.bqx = 0;
    this.bqz = 0;

    const cx = Math.floor((x - this.gx0) / GRID_CELL);
    const cz = Math.floor((z - this.gz0) / GRID_CELL);
    const stampId = ++this.stampId;
    let done = false;

    for (let k = 0; k <= MAX_RING && !done; k++) {
      for (let dz = -k; dz <= k; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= gh) continue;
        for (let dx = -k; dx <= k; dx++) {
          if ((dx < 0 ? -dx : dx) !== k && (dz < 0 ? -dz : dz) !== k) continue; // ring k only
          const gx = cx + dx;
          if (gx < 0 || gx >= gw) continue;
          const list = cells[gz * gw + gx];
          for (let q = 0; q < list.length; q++) {
            const i = list[q];
            if (this.stamp[i] === stampId) continue;
            this.stamp[i] = stampId;
            this.scan(i, x, z);
          }
        }
      }
      // every segment closer than k * cell has been looked at, so a hit inside that radius is the true nearest
      const covered = k * GRID_CELL;
      if (this.bd2 <= covered * covered) done = true;
    }

    if (!done) {
      // far from the road (or outside the grid): fall back to the full scan
      this.bd2 = Infinity;
      for (let i = 0; i < n; i++) this.scan(i, x, z);
    }

    hit.d = Math.sqrt(this.bd2);
    hit.qx = this.bqx;
    hit.qz = this.bqz;
    return hit;
  }

  /** True when (x, z) is enclosed by the loop (the infield). Exact, O(n). */
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

  /**
   * Same answer as `inside`, remembered per 2-unit cell. Only use it for points that are well away from the road
   * edge (the callers below only ask when the car is more than ~10 units from the centre line), where a 2-unit
   * cell can never straddle the boundary.
   */
  insideCached(x: number, z: number) {
    const ix = Math.round(x / INSIDE_CELL);
    const iz = Math.round(z / INSIDE_CELL);
    const key = (ix + 4096) * 8192 + (iz + 4096);
    let v = this.insideMemo.get(key);
    if (v === undefined) {
      v = this.inside(ix * INSIDE_CELL, iz * INSIDE_CELL);
      this.insideMemo.set(key, v);
    }
    return v;
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

/**
 * Outer-side barrier only (for the pushable logos): if a circle of radius r at (x, z) is on the outside of the loop and
 * past the outer crash barrier, returns the vector that pulls it back onto the road side, otherwise null. The inner
 * barrier and the infield opening are ignored, so only the outside edge of the road holds things in.
 */
export function outerRailPush(x: number, z: number, r: number): [number, number] | null {
  if (!rail) return null;
  const { field, offset } = rail;
  const m = field.nearest(x, z);
  const limit = offset - 0.1 - r;
  if (m.d <= limit) return null;
  if (field.inside(x, z)) return null;
  const pen = m.d - limit;
  const d = m.d || 1e-4;
  return [((m.qx - x) / d) * pen, ((m.qz - z) / d) * pen];
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
 *
 * The nearest-road query is done once per call and shared by the corridor wall and the crash barrier.
 */
export function worldCollide(x: number, z: number, r: number): [number, number] | null {
  let bestPen = 0;
  let vx = 0;
  let vz = 0;

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = x - c.x;
    if (dx > 12 || dx < -12) continue; // cheap reject: no collider here is that big
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

  // one nearest-road lookup, reused below
  let nf: TrackField | null = null;
  let nd = 0;
  let nqx = 0;
  let nqz = 0;

  if (corridor) {
    const { field, reach } = corridor;
    const limit = reach - r;
    const m = field.nearest(x, z);
    nf = field;
    nd = m.d;
    nqx = m.qx;
    nqz = m.qz;
    if (nd > limit && !field.insideCached(x, z)) {
      // too far from the track on the outside of the loop: push back toward the nearest bit of road
      const pen = nd - limit;
      if (pen > bestPen) {
        bestPen = pen;
        vx = ((nqx - x) / nd) * pen;
        vz = ((nqz - z) / nd) * pen;
      }
    }
  }

  if (rail) {
    const { field, offset } = rail;
    // The barrier is a thin wall along the line `offset` units from the centre line: a car whose circle touches
    // that band is pushed out on whichever side it came from (road side or infield/outside), so it can neither
    // leave the road nor, once through the opening, be dragged back out of the infield.
    const band = 0.1 + r;
    if (nf !== field) {
      const m = field.nearest(x, z);
      nf = field;
      nd = m.d;
      nqx = m.qx;
      nqz = m.qz;
    }
    const dd = nd - offset;
    if (dd < band && dd > -band) {
      const d = nd || 1e-4;
      // the opening on the inside of the main straight is the only way through
      const open = inInfieldGap(nqx, nqz) && field.inside(x, z);
      if (!open) {
        const pen = band - Math.abs(dd);
        if (pen > bestPen) {
          bestPen = pen;
          const s = dd <= 0 ? 1 : -1; // road side: push toward the road, other side: away from it
          vx = (((nqx - x) / d) * pen) * s;
          vz = (((nqz - z) / d) * pen) * s;
        }
      }
    }
  }

  return bestPen > 0 ? [vx, vz] : null;
}

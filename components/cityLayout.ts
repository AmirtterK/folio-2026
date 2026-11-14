/**
 * Layout of the ring of buildings around the outside of the circuit. Pure maths (no React, no three.js), so it can
 * be unit-run in node.
 *
 * Seven different models (incl. the neon Japanese houses) are mixed so nothing repeats too often. Each has a use limit, and the picker always
 * favours the ones used least so far and never uses the same model three times in a row. Each copy also gets its
 * own size, height stretch and mirroring.
 *
 *   1. front row   - walks round the loop and sets a building flush against the invisible wall, long ones on
 *                    straights, short ones in tight bends, nothing ever poking into the drivable corridor
 *   2. gap filling - any stretch of wall still without a building gets a compact one
 *   3. back row    - tall towers behind the front row for a skyline
 *
 * Deterministic (seeded), so it looks the same on every load.
 */

import { TRACK_WALL_DISTANCE, TrackField } from "@/components/trackCollision";

export type SourceId = "cyber" | "future" | "modern" | "tower" | "chicago" | "asian" | "neon";

export type SourceDef = {
  id: SourceId;
  file: string;
  /** Length of the longest side of the footprint, in world units, before the per-copy size jitter. */
  length: number;
  /** Random height stretch range (non-uniform) so the tall single buildings don't all look alike. */
  heightJitter: [number, number];
  /** Most copies in the front row (the picker may exceed this by 50% when it must fill a gap or build the back row). */
  maxUses: number;
  /** Relative preference when the picker has a choice. */
  weight: number;
  /** Compact enough to fill gaps in the wall and to make the back row. */
  compact: boolean;
};

export const SOURCES: SourceDef[] = [
  { id: "cyber", file: "cyberpunk_sci_fi_building.glb", length: 46, heightJitter: [1, 1], maxUses: 10, weight: 1.3, compact: false },
  { id: "future", file: "futuristic_low_poly_building.glb", length: 15, heightJitter: [0.9, 1.45], maxUses: 24, weight: 1.1, compact: true },
  { id: "modern", file: "modern_night_building.glb", length: 17, heightJitter: [0.8, 1.3], maxUses: 24, weight: 1.2, compact: true },
  { id: "tower", file: "game_ready_city_buildings.glb", length: 22, heightJitter: [0.8, 1.25], maxUses: 22, weight: 1.0, compact: true },
  { id: "chicago", file: "realistic_chicago_buildings.glb", length: 52, heightJitter: [1, 1], maxUses: 6, weight: 0.8, compact: false },
  { id: "asian", file: "asian_themed_low_poly_night_city_buildings.glb", length: 56, heightJitter: [1, 1], maxUses: 6, weight: 0.8, compact: false },
  // a row of neon-lit Japanese houses (from the street scene): a few of them among the other buildings
  { id: "neon", file: "neon_row.glb", length: 50, heightJitter: [1, 1.12], maxUses: 5, weight: 1.9, compact: false },
  // san_francisco_city.glb (15 MB, ~93k triangles for one building) is deliberately not used: too expensive for what it adds
];

/** What the layout needs to know about each (normalised) model. Lengths are at the model's own `length` scale. */
export type ModelDims = {
  /** height of the raw model */
  rawHeight: number;
  /** long side runs along z, so the copy is turned a quarter turn to run along the street */
  quarter: boolean;
  /** uniform scale that gives the model its `length` */
  s0: number;
  /** width along the street, depth away from it, at scale s0 */
  w0: number;
  d0: number;
};

const WALL = TRACK_WALL_DISTANCE;
/** Distance from the centre line to the FRONT face of a front-row building (just behind the invisible wall). */
export const FRONT = WALL + 0.6;
/** Distance to the front face of the back-row towers. */
export const BACK = WALL + 30;

/* ---------- small helpers ---------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Box = { x: number; z: number; hw: number; hd: number; yaw: number };

export function boxesOverlap(a: Box, b: Box, shrink: number) {
  const ahw = a.hw - shrink;
  const ahd = a.hd - shrink;
  const bhw = b.hw - shrink;
  const bhd = b.hd - shrink;
  if (ahw <= 0 || ahd <= 0 || bhw <= 0 || bhd <= 0) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ra = Math.hypot(ahw, ahd);
  const rb = Math.hypot(bhw, bhd);
  if (dx * dx + dz * dz > (ra + rb) * (ra + rb)) return false;
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  const axes: [number, number][] = [
    [ca, -sa],
    [sa, ca],
    [cb, -sb],
    [sb, cb],
  ];
  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz);
    const pa = ahw * Math.abs(ca * ux - sa * uz) + ahd * Math.abs(sa * ux + ca * uz);
    const pb = bhw * Math.abs(cb * ux - sb * uz) + bhd * Math.abs(sb * ux + cb * uz);
    if (dist > pa + pb) return false;
  }
  return true;
}

export function pointInBox(b: Box, x: number, z: number) {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}

/** The centre line with arc-length lookups and an outward-pointing normal. */
class Loop {
  readonly n: number;
  readonly pts: { x: number; z: number }[];
  readonly S: Float64Array;
  readonly length: number;
  sign = 1;

  constructor(pts: { x: number; z: number }[]) {
    this.pts = pts;
    this.n = pts.length;
    this.S = new Float64Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % this.n];
      this.S[i + 1] = this.S[i] + Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.length = this.S[this.n];
  }

  pos(s: number) {
    const L = this.length;
    const t0 = ((s % L) + L) % L;
    let lo = 0;
    let hi = this.n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.S[mid] <= t0) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[(lo + 1) % this.n];
    const seg = this.S[lo + 1] - this.S[lo];
    const t = seg > 0 ? (t0 - this.S[lo]) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Position, unit tangent and unit OUTWARD normal (away from the infield) at arc length s. */
  frame(s: number) {
    const a = this.pos(s - 1.5);
    const b = this.pos(s + 1.5);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const p = this.pos(s);
    return { x: p.x, z: p.z, tx, tz, nx: -tz * this.sign, nz: tx * this.sign };
  }

  /** How much longer (or shorter) than the centre line the line `q` units outward is, around arc length s. */
  stretch(s: number, q: number) {
    const f1 = this.frame(s - 2);
    const f2 = this.frame(s + 2);
    const ax = f1.x + f1.nx * q;
    const az = f1.z + f1.nz * q;
    const bx = f2.x + f2.nx * q;
    const bz = f2.z + f2.nz * q;
    return Math.min(3, Math.max(0.35, Math.hypot(bx - ax, bz - az) / 4));
  }
}

/* ---------- layout ---------- */

export type CityPlacement = {
  src: SourceId;
  x: number;
  z: number;
  /** rotation around Y that makes the building's local +z face the track */
  yaw: number;
  mirror: 1 | -1;
  quarter: boolean;
  /** uniform horizontal scale and (stretched) vertical scale */
  sx: number;
  sy: number;
  /** footprint on the ground (centre, half extents, yaw) */
  box: Box;
  /** height after scaling */
  h: number;
};

/** Seed of the layout. Picked by scripts/_seed-scan.mjs (fewest uncovered stretches of wall, a few neon houses); change the models or limits and it needs a re-scan. */
export const CITY_SEED = 29;

export function layoutCity(field: TrackField, dims: Record<SourceId, ModelDims>, seed: number = CITY_SEED): CityPlacement[] {
  const rand = mulberry32(seed);
  const loop = new Loop(Array.from({ length: field.n }, (_, i) => ({ x: field.xs[i], z: field.zs[i] })));

  // which side is "outward"? (away from the infield). Left normal first, flip if it mostly lands inside the loop.
  let inside = 0;
  for (let k = 0; k < 60; k++) {
    const f = loop.frame((k / 60) * loop.length);
    if (field.inside(f.x + f.nx * 4, f.z + f.nz * 4)) inside++;
  }
  if (inside > 30) loop.sign = -1;

  const placed: CityPlacement[] = [];
  const uses: Record<SourceId, number> = { cyber: 0, future: 0, modern: 0, tower: 0, chicago: 0, asian: 0, neon: 0 };
  const recent: SourceId[] = [];

  type Opts = { front: number; shrink: number; maxSlack: number; pushMax: number };

  const tryPlace = (def: SourceDef, sc: number, j: number, hm: number, mirror: 1 | -1, o: Opts): CityPlacement | null => {
    const p = dims[def.id];
    const sx = p.s0 * j;
    const sy = sx * hm;
    const w = p.w0 * j;
    const d = p.d0 * j;
    const hw = w / 2;
    const hd = d / 2;
    const f = loop.frame(sc);
    const yaw = Math.atan2(-f.nx, -f.nz); // local +z faces the track
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);

    let push = 0;
    for (let attempt = 0; attempt < 16; attempt++) {
      const q = o.front + push + hd;
      const cx = f.x + f.nx * q;
      const cz = f.z + f.nz * q;

      // every sampled point of the footprint must stay out of the drivable corridor (and out of the infield)
      let deficit = 0;
      let frontSlack = 0;
      for (const lx of [-1, -0.5, 0, 0.5, 1]) {
        for (const lz of [-1, 0, 1]) {
          const px = cx + ca * lx * hw + sa * lz * hd;
          const pz = cz - sa * lx * hw + ca * lz * hd;
          const m = field.nearest(px, pz);
          if (field.inside(px, pz)) deficit = Math.max(deficit, 4);
          else if (m.d < WALL + 0.25) deficit = Math.max(deficit, WALL + 0.25 - m.d);
          if (lz === 1) frontSlack = Math.max(frontSlack, m.d - (WALL + 0.25));
        }
      }
      if (deficit > 0) {
        push += Math.max(deficit, 0.5);
        if (push > o.pushMax) return null;
        continue;
      }
      // front edge too far from the wall (e.g. a long building on a tight bend): leave it to a shorter one
      if (frontSlack > o.maxSlack) return null;

      const box: Box = { x: cx, z: cz, hw, hd, yaw };
      for (const other of placed) if (boxesOverlap(box, other.box, o.shrink)) return null;
      return { src: def.id, x: cx, z: cz, yaw, mirror, quarter: p.quarter, sx, sy, box, h: p.rawHeight * sy };
    }
    return null;
  };

  /** Candidates ordered by how little they have been used so far (with a random nudge), skipping the last two used. */
  const ranked = (pool: SourceDef[], capFactor: number) =>
    pool
      .filter((d) => uses[d.id] < Math.ceil(d.maxUses * capFactor) && !recent.slice(-2).includes(d.id))
      .map((d) => ({ d, score: d.weight * (1 - uses[d.id] / (d.maxUses * capFactor + 1)) * (0.6 + rand() * 0.8) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.d);

  const commit = (pl: CityPlacement) => {
    placed.push(pl);
    uses[pl.src]++;
    recent.push(pl.src);
  };

  const jitter = (def: SourceDef) => {
    const j = def.compact ? 0.92 + rand() * 0.2 : 0.95 + rand() * 0.1;
    const hm = def.heightJitter[0] + rand() * (def.heightJitter[1] - def.heightJitter[0]);
    const mirror: 1 | -1 = rand() > 0.5 ? 1 : -1;
    return { j, hm, mirror };
  };

  /* 1. front row: walk the loop, building after building, flush against the wall */
  const L = loop.length;
  const start = rand() * 6;
  let s = start;
  let guard = 0;
  while (s < start + L - 3 && guard++ < 600) {
    let done = false;
    for (const def of ranked(SOURCES, 1).slice(0, 4)) {
      const { j, hm, mirror } = jitter(def);
      const pr = dims[def.id];
      const w = pr.w0 * j;
      const k = loop.stretch(s, FRONT + (pr.d0 * j) / 2);
      const sc = s + w / 2 / k;
      const pl = tryPlace(def, sc, j, hm, mirror, { front: FRONT, shrink: 1.2, maxSlack: 4.5, pushMax: 9 });
      if (pl) {
        commit(pl);
        const k2 = loop.stretch(sc, FRONT + (pr.d0 * j) / 2);
        s = sc + (w / 2 + 0.5 + rand() * 1.6) / k2;
        done = true;
        break;
      }
    }
    if (!done) s += 4;
  }

  /* 2. gap filling: anywhere along the wall that no building covers yet gets a compact one */
  const compact = SOURCES.filter((d) => d.compact);
  s = 0;
  guard = 0;
  while (s < L && guard++ < 800) {
    const f = loop.frame(s);
    const gx = f.x + f.nx * (WALL + 1.2);
    const gz = f.z + f.nz * (WALL + 1.2);
    // a point that is really inside another stretch of the corridor (or inside the loop) isn't wall, nothing to cover
    if (field.inside(gx, gz) || field.nearest(gx, gz).d < WALL + 0.5 || placed.some((p) => pointInBox(p.box, gx, gz))) {
      s += 2.5;
      continue;
    }
    let done = false;
    // narrow gaps and tight bends: try the compact models at full size first, then smaller and smaller
    outer: for (const shrinkBy of [1, 0.78, 0.6, 0.45, 0.33, 0.24]) {
      for (const def of ranked(compact, 3).slice(0, 3)) {
        const jj = jitter(def);
        const j = jj.j * shrinkBy;
        const pl = tryPlace(def, s, j, jj.hm, jj.mirror, { front: FRONT, shrink: 1.0, maxSlack: 8, pushMax: 12 });
        if (pl) {
          commit(pl);
          s += (dims[def.id].w0 * j) / 2 + 0.8;
          done = true;
          break outer;
        }
      }
    }
    if (!done) s += 1.5;
  }

  /* 3. back row: tall towers behind the front row for a skyline */
  let back = 0;
  s = rand() * 10;
  guard = 0;
  while (s < L && back < 12 && guard++ < 300) {
    let done = false;
    for (const def of ranked(compact, 1.5).slice(0, 3)) {
      const { j, hm, mirror } = jitter(def);
      const pl = tryPlace(def, s, j, hm * 1.1, mirror, { front: BACK, shrink: 0, maxSlack: Infinity, pushMax: 20 });
      if (pl) {
        commit(pl);
        back++;
        s += dims[def.id].w0 * j + 6 + rand() * 18;
        done = true;
        break;
      }
    }
    if (!done) s += 6;
  }

  return placed;
}

/** For tests/diagnostics: which sampled points of the wall (distance WALL+1.2 outside the road) no building covers. */
export function wallGaps(field: TrackField, placed: CityPlacement[], step = 2): { x: number; z: number }[] {
  const loop = new Loop(Array.from({ length: field.n }, (_, i) => ({ x: field.xs[i], z: field.zs[i] })));
  let inside = 0;
  for (let k = 0; k < 60; k++) {
    const f = loop.frame((k / 60) * loop.length);
    if (field.inside(f.x + f.nx * 4, f.z + f.nz * 4)) inside++;
  }
  if (inside > 30) loop.sign = -1;
  const gaps: { x: number; z: number }[] = [];
  for (let s = 0; s < loop.length; s += step) {
    const f = loop.frame(s);
    const gx = f.x + f.nx * (WALL + 1.2);
    const gz = f.z + f.nz * (WALL + 1.2);
    if (!field.inside(gx, gz) && field.nearest(gx, gz).d >= WALL + 0.5 && !placed.some((p) => pointInBox(p.box, gx, gz))) gaps.push({ x: gx, z: gz });
  }
  return gaps;
}

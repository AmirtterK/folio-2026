import * as THREE from "three";
import type { ShapePath } from "three";

type Poly = { pts: THREE.Vector2[]; area: number };

function signedArea(p: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i];
    const r = p[(i + 1) % n];
    a += q.x * r.y - r.x * q.y;
  }
  return a / 2;
}

function inside(pt: THREE.Vector2, poly: THREE.Vector2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** A point that is really inside the polygon's own area (not on its edge). */
function probe(poly: THREE.Vector2[]) {
  const n = poly.length;
  let best = poly[0];
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = a.distanceToSquared(b);
    if (len > bestLen) {
      bestLen = len;
      best = a.clone().lerp(b, 0.5);
      // nudge it a hair to the inside of that edge
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      const eps = Math.sqrt(bestLen) * 1e-3 + 1e-4;
      for (const s of [1, -1]) {
        const t = new THREE.Vector2(best.x + (s * nx * eps) / l, best.y + (s * ny * eps) / l);
        if (inside(t, poly)) return t;
      }
    }
  }
  return best;
}

/**
 * Turns an SVG path into Three shapes using the SVG fill rule itself
 * ("nonzero" or "evenodd") instead of relying on SVGLoader's winding-direction
 * guess, which differs between Three versions and can swap what is filled and
 * what is hollow.
 */
export function shapesFromPath(path: ShapePath, evenOdd: boolean, divisions = 12): THREE.Shape[] {
  const polys: Poly[] = [];
  for (const sp of path.subPaths) {
    const raw = sp.getPoints(divisions);
    const pts: THREE.Vector2[] = [];
    for (const p of raw) {
      const last = pts[pts.length - 1];
      if (!last || last.distanceToSquared(p) > 1e-10) pts.push(p);
    }
    if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10) pts.pop();
    if (pts.length < 3) continue;
    const area = signedArea(pts);
    if (Math.abs(area) < 1e-9) continue;
    polys.push({ pts, area });
  }

  const probes = polys.map((p) => probe(p.pts));
  // parent = the smallest polygon that contains this one
  const parent: number[] = polys.map((_, i) => {
    let best = -1;
    polys.forEach((q, j) => {
      if (j === i || Math.abs(q.area) <= Math.abs(polys[i].area)) return;
      if (inside(probes[i], q.pts) && (best < 0 || Math.abs(q.area) < Math.abs(polys[best].area))) best = j;
    });
    return best;
  });

  // winding of the region directly inside each polygon (sum over it and its ancestors)
  const filled: boolean[] = polys.map((p, i) => {
    let w = 0;
    for (let k = i; k >= 0; k = parent[k]) w += evenOdd ? 1 : Math.sign(polys[k].area);
    return evenOdd ? w % 2 !== 0 : w !== 0;
  });

  const shapes = new Map<number, THREE.Shape>();
  polys.forEach((p, i) => {
    if (!filled[i] || (parent[i] >= 0 && filled[parent[i]])) return; // not an outer boundary
    shapes.set(i, new THREE.Shape(p.pts));
  });
  polys.forEach((p, i) => {
    if (filled[i] || parent[i] < 0 || !filled[parent[i]]) return; // not a hole boundary
    let k = parent[i];
    while (k >= 0 && !shapes.has(k)) k = parent[k];
    if (k >= 0) shapes.get(k)!.holes.push(new THREE.Path(p.pts));
  });
  return [...shapes.values()];
}

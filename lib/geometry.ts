// Procedural mesh builders. Everything in the game is generated in code — there
// are no model files — so "realistic" has to come from geometry that curves and
// tapers rather than from boxes and spheres bolted together.
//
// The workhorse is `loft`: give it a handful of cross-sections along a spine and
// it lays a smooth skin over them. A cow's barrel, its neck, its skull, its legs,
// its horns, a tree trunk and a fence rail are all the same call with different
// numbers, which is why the whole world can be organic without a single asset.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * One cross-section of a lofted shape: an ellipse of half-width `rx` and
 * half-height `ry`, centred at (`x`, `y`) and sitting at `z` along the spine.
 */
export interface Ring {
  z: number;
  x?: number;
  y?: number;
  rx: number;
  ry: number;
}

/**
 * Catmull-Rom through a list of scalars, parameterised 0..n-1. Used instead of
 * straight lines between rings so a six-ring cow reads as one smooth animal
 * rather than six stacked tubes.
 */
function catmull(v: number[], t: number): number {
  const n = v.length;
  if (n === 1) return v[0];
  const i = Math.min(n - 2, Math.max(0, Math.floor(t)));
  const f = Math.min(1, Math.max(0, t - i));
  const p0 = v[Math.max(0, i - 1)];
  const p1 = v[i];
  const p2 = v[i + 1];
  const p3 = v[Math.min(n - 1, i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f3)
  );
}

export interface LoftOptions {
  /** Points around each cross-section. More = rounder and more expensive. */
  radial?: number;
  /** Cross-sections generated along the spine. Defaults to 6 per input ring. */
  segments?: number;
  /** Close the ends off. Skipped automatically where a ring has no area. */
  caps?: boolean;
  /**
   * Squares the cross-section off, 0 (ellipse) to 1 (rounded box). A muzzle and
   * a fence rail are both flatter-sided than a plain tube.
   */
  square?: number;
}

/** Point on the cross-section at `angle`, blended from ellipse to rounded box. */
function profile(angle: number, rx: number, ry: number, square: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (square <= 0) return [c * rx, s * ry];
  // superellipse: |x/rx|^n + |y/ry|^n = 1, with n rising as `square` does
  const n = 2 + square * 4;
  const k = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), -1 / n);
  return [c * rx * k, s * ry * k];
}

/** Lay a smooth, UV-mapped skin over a list of cross-sections. */
export function loft(rings: Ring[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const radial = opts.radial ?? 22;
  const steps = opts.segments ?? (rings.length - 1) * 6;
  const square = opts.square ?? 0;
  const caps = opts.caps ?? true;

  const xs = rings.map((r) => r.x ?? 0);
  const ys = rings.map((r) => r.y ?? 0);
  const zs = rings.map((r) => r.z);
  const rxs = rings.map((r) => r.rx);
  const rys = rings.map((r) => r.ry);

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cols = radial + 1; // the seam column is duplicated so UVs can wrap

  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * (rings.length - 1);
    const cx = catmull(xs, t);
    const cy = catmull(ys, t);
    const cz = catmull(zs, t);
    const rx = Math.max(0, catmull(rxs, t));
    const ry = Math.max(0, catmull(rys, t));
    for (let j = 0; j <= radial; j++) {
      const [px, py] = profile((j / radial) * Math.PI * 2, rx, ry, square);
      pos.push(cx + px, cy + py, cz);
      uv.push(j / radial, s / steps);
    }
  }

  for (let s = 0; s < steps; s++) {
    for (let j = 0; j < radial; j++) {
      const a = s * cols + j;
      const b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const skinVerts = pos.length / 3;

  if (caps) {
    const endCap = (t: number, front: boolean) => {
      const cx = catmull(xs, t);
      const cy = catmull(ys, t);
      const cz = catmull(zs, t);
      const rx = Math.max(0, catmull(rxs, t));
      const ry = Math.max(0, catmull(rys, t));
      if (rx < 0.004 || ry < 0.004) return; // pointed end: nothing to close
      const centre = pos.length / 3;
      pos.push(cx, cy, cz);
      uv.push(0.5, 0.5);
      for (let j = 0; j <= radial; j++) {
        const [px, py] = profile((j / radial) * Math.PI * 2, rx, ry, square);
        pos.push(cx + px, cy + py, cz);
        uv.push(0.5 + px / (rx * 2), 0.5 + py / (ry * 2));
      }
      for (let j = 0; j < radial; j++) {
        const a = centre + 1 + j;
        if (front) idx.push(centre, a + 1, a);
        else idx.push(centre, a, a + 1);
      }
    };
    endCap(0, true);
    endCap(rings.length - 1, false);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // The duplicated seam column gets two half-normals, which shows up as a stripe
  // down the length of the shape. Average the pair back together.
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let s = 0; s <= steps; s++) {
    const a = s * cols;
    const b = a + radial;
    if (b >= skinVerts) break;
    const nx = (nrm.getX(a) + nrm.getX(b)) / 2;
    const ny = (nrm.getY(a) + nrm.getY(b)) / 2;
    const nz = (nrm.getZ(a) + nrm.getZ(b)) / 2;
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / len, ny / len, nz / len);
    nrm.setXYZ(b, nx / len, ny / len, nz / len);
  }
  nrm.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

/** Deterministic RNG, so the same fence gets the same knots on every reload. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One blade of grass: a tapered strip that curves over under its own weight,
 * darker at the root than the tip. Grass is drawn by the thousand, so this is
 * two triangles per segment and no more.
 */
export function bladeGeometry(
  height: number,
  width: number,
  bend: number,
  segs = 4
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const root = new THREE.Color("#2c6320");
  const tip = new THREE.Color("#93d158");
  const c = new THREE.Color();

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = (width * (1 - t) * (1 - t * 0.35)) / 2;
    const y = height * t;
    const z = bend * t * t;
    c.copy(root).lerp(tip, t * t * 0.85 + t * 0.15);
    pos.push(-w, y, z, w, y, z);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  // the last pair sits at the tip, so close it with a single triangle
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, last + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A lumpy rock, a clod of earth or a blob of foliage: a sphere kicked out of
 * shape. `smooth` welds the seams first — an IcosahedronGeometry is non-indexed,
 * so without that every face gets its own normal and a rolling hill comes out
 * looking like a pile of broken glass.
 */
export function lumpGeometry(
  seed: number,
  radius: number,
  rough = 0.32,
  detail = 1,
  smooth = false
): THREE.BufferGeometry {
  const geo = smooth
    ? mergeVertices(new THREE.IcosahedronGeometry(radius, detail), 1e-4)
    : new THREE.IcosahedronGeometry(radius, detail);
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const r = rng(seed);
  // hash by rounded position so vertices sharing a corner move together
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 1 + (r() - 0.5) * rough * 2;
      seen.set(key, k);
    }
    p.setXYZ(i, x * k, y * k * (1 - rough * 0.5), z * k);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A leafy blob for tree canopies — like `lumpGeometry` but rounder and denser. */
export function foliageGeometry(seed: number, radius: number): THREE.BufferGeometry {
  return lumpGeometry(seed, radius, 0.24, 2, true);
}

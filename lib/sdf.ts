// One-piece characters.
//
// Every character in the game used to be a pile of lofted tubes and spheres,
// each a separate mesh, each pushed a little way into its neighbour to hide the
// join. However carefully the pieces were overlapped, the result read as what it
// was — a kit of parts — because two surfaces that merely intersect leave a hard
// crease where they cross, and a separately UV-mapped texture on each piece
// never lines up across that crease.
//
// This file builds a body the way a sculptor would instead: as ONE surface.
// The shape is described as a signed distance field — a function that says how
// far any point is from the skin, negative inside — made of simple primitives
// blended with a *smooth* union, so a leg does not plug into a shoulder, it
// grows out of it. That field is then turned into a single triangle mesh
// (`surfaceNets`), and every vertex is given skin weights from whichever
// primitives it is closest to, so the one mesh can be driven by the existing
// skeleton of groups and bend at the joints instead of coming apart at them.
//
// Nothing here knows about cows or policemen. Cow.tsx and Officer.tsx each
// describe their anatomy as a list of `Prim`s and hand it to `buildSkin`.

import * as THREE from "three";

export type V3 = [number, number, number];

/**
 * A distance function in model space. Negative inside.
 *
 * Primitives also carry a bounding sphere (`bc`, `br`), which is what keeps
 * meshing affordable: a body is fifty-odd parts and any one point is only ever
 * near a handful of them, so a part whose bounding sphere is further away than
 * the surface already found cannot change the answer and is skipped.
 */
export type Dist = ((x: number, y: number, z: number) => number) & { bc?: V3; br?: number };

function bounded(d: Dist, c: V3, r: number): Dist {
  d.bc = c;
  d.br = r;
  return d;
}

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

export function sphere(c: V3, r: number): Dist {
  return bounded((x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r, c, r);
}

/**
 * An ellipsoid. Not an exact distance (no closed form exists) but the standard
 * first-order bound, which is accurate near the surface — and near the surface
 * is the only place the mesher and the blends look.
 */
export function ellipsoid(c: V3, r: V3, rot?: V3): Dist {
  const m = rot ? inverseRotation(rot) : null;
  const ix = 1 / r[0];
  const iy = 1 / r[1];
  const iz = 1 / r[2];
  return bounded((x, y, z) => {
    let px = x - c[0];
    let py = y - c[1];
    let pz = z - c[2];
    if (m) [px, py, pz] = apply(m, px, py, pz);
    const k0 = len3(px * ix, py * iy, pz * iz);
    const k1 = len3(px * ix * ix, py * iy * iy, pz * iz * iz);
    if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
    return (k0 * (k0 - 1)) / k1;
  }, c, Math.max(r[0], r[1], r[2]));
}

/**
 * A cone with a sphere on each end — a limb segment that tapers. Exact.
 * `squash` scales the cross-section across one axis, for limbs that are deeper
 * than they are wide; it makes the distance approximate, which is fine.
 */
export function roundCone(a: V3, b: V3, ra: number, rb: number, squashX = 1): Dist {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const reach = Math.sqrt(l2) / 2 + Math.max(ra, rb) * Math.max(1, squashX);
  return bounded((x, y, z) => {
    // Squashing is done about the segment's own x, so it is only meaningful for
    // segments that lie in a plane of constant x — which every limb that swings
    // fore-and-aft does.
    const px = (x - a[0]) / squashX;
    const py = y - a[1];
    const pz = z - a[2];
    const yd = px * bx + py * by + pz * bz;
    const z0 = yd - l2;
    const qx = px * l2 - bx * yd;
    const qy = py * l2 - by * yd;
    const qz = pz * l2 - bz * yd;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yd * yd * l2;
    const z2 = z0 * z0 * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    let d: number;
    if (Math.sign(z0) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - rb;
    else if (Math.sign(yd) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - ra;
    else d = (Math.sqrt(x2 * a2 * il2) + yd * rr) * il2 - ra;
    return squashX < 1 ? d * squashX : d;
  }, mid, reach);
}

export function capsule(a: V3, b: V3, r: number): Dist {
  return roundCone(a, b, r, r);
}

/** A rounded box, for things that should read as hard-edged: boots, a cap. */
export function roundBox(c: V3, half: V3, round: number, rot?: V3): Dist {
  const m = rot ? inverseRotation(rot) : null;
  return bounded((x, y, z) => {
    let px = x - c[0];
    let py = y - c[1];
    let pz = z - c[2];
    if (m) [px, py, pz] = apply(m, px, py, pz);
    const qx = Math.abs(px) - half[0] + round;
    const qy = Math.abs(py) - half[1] + round;
    const qz = Math.abs(pz) - half[2] + round;
    const out = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return out + Math.min(Math.max(qx, qy, qz), 0) - round;
  }, c, len3(half[0], half[1], half[2]));
}

/** An upright cylinder with rounded rims: a cap band, a bollard, a cup. */
export function cylinder(c: V3, r: number, halfH: number, round = 0): Dist {
  return bounded((x, y, z) => {
    const dx = Math.sqrt((x - c[0]) ** 2 + (z - c[2]) ** 2) - r + round;
    const dy = Math.abs(y - c[1]) - halfH + round;
    return Math.min(Math.max(dx, dy), 0) + Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - round;
  }, c, Math.sqrt(r * r + halfH * halfH));
}

/**
 * A shape described in some other frame — a bone's — placed into model space
 * by `m`. Rigid transforms and uniform scale only, which is all a rig has.
 */
export function inFrame(d: Dist, m: THREE.Matrix4): Dist {
  const inv = m.clone().invert();
  const e = inv.elements;
  const scale = new THREE.Vector3().setFromMatrixScale(m).x;
  const out: Dist = (x, y, z) =>
    d(
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]
    ) * scale;
  if (d.bc) {
    const c = new THREE.Vector3(...d.bc).applyMatrix4(m);
    return bounded(out, [c.x, c.y, c.z], (d.br ?? 0) * scale);
  }
  return out;
}

type M3 = number[];

function inverseRotation(rot: V3): M3 {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.invert();
  const e = m.elements;
  // column-major 4x4 -> row-major 3x3
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

function apply(m: M3, x: number, y: number, z: number): V3 {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** Polynomial smooth minimum: a union whose seam is a fillet `k` wide. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

// ---------------------------------------------------------------------------
// a body
// ---------------------------------------------------------------------------

export interface Prim {
  d: Dist;
  /** Index into the bone list this part of the skin moves with. */
  bone: number;
  /** How wide the fillet is where this joins what came before it. */
  k?: number;
  /** Carve this out instead of adding it. */
  sub?: boolean;
  /** Vertex colour, for characters painted by part rather than by shader. */
  color?: string;
  /** A label handed to `paint`, so it can tell a sleeve from a chest. */
  tag?: string;
  /**
   * How strongly this part claims skin near it, as a distance bias. Negative
   * makes it claim less — used for masses like a shoulder that should stay
   * with the body even where a limb runs right through them.
   */
  bias?: number;
}

/** The whole field: every prim folded together in order. */
export function fieldOf(prims: Prim[]): Dist {
  const n = prims.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cz = new Float64Array(n);
  const cr = new Float64Array(n);
  const ks = new Float64Array(n);
  prims.forEach((p, i) => {
    const c = p.d.bc;
    cx[i] = c ? c[0] : 0;
    cy[i] = c ? c[1] : 0;
    cz[i] = c ? c[2] : 0;
    cr[i] = c ? p.d.br ?? 0 : -1;
    ks[i] = p.k ?? 0;
  });
  return (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      const p = prims[i];
      const k = ks[i];
      // Skip anything that provably cannot touch the result. Its distance is
      // at least (distance to its bounding sphere), and a union only cares
      // about parts within `k` of the best so far; a carve only about parts
      // the point is within `k` of being inside.
      if (cr[i] >= 0 && d !== Infinity) {
        const lb = len3(x - cx[i], y - cy[i], z - cz[i]) - cr[i];
        if (p.sub ? -lb < d - k : lb - k > d) continue;
      }
      const di = p.d(x, y, z);
      if (p.sub) d = smax(d, -di, k);
      else d = d === Infinity ? di : smin(d, di, k);
    }
    return d;
  };
}

/**
 * March a ray until it hits the surface. Used to plant eyes, hair and buttons
 * ON the skin — a feature placed by eye on a curved surface is always either
 * floating off it or sunk inside it.
 */
export function rayHit(f: Dist, o: V3, dir: V3, maxT = 2): V3 | null {
  const len = len3(dir[0], dir[1], dir[2]);
  const dx = dir[0] / len;
  const dy = dir[1] / len;
  const dz = dir[2] / len;
  let t = 0;
  for (let i = 0; i < 300 && t < maxT; i++) {
    const x = o[0] + dx * t;
    const y = o[1] + dy * t;
    const z = o[2] + dz * t;
    const d = f(x, y, z);
    if (d < 0.0004) return [x, y, z];
    t += Math.max(d * 0.8, 0.0006);
  }
  return null;
}

/** Outward surface normal at a point, from the field's gradient. */
export function normalAt(f: Dist, p: V3, eps = 0.002): V3 {
  // the tetrahedral trick: four samples instead of six
  const a = f(p[0] + eps, p[1] - eps, p[2] - eps);
  const b = f(p[0] - eps, p[1] - eps, p[2] + eps);
  const c = f(p[0] - eps, p[1] + eps, p[2] - eps);
  const d = f(p[0] + eps, p[1] + eps, p[2] + eps);
  const nx = a - b - c + d;
  const ny = -a - b + c + d;
  const nz = -a + b - c + d;
  const l = len3(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------------------
// meshing
// ---------------------------------------------------------------------------

/**
 * Naive surface nets: one vertex per grid cell the surface passes through,
 * one quad per grid edge it crosses. Simpler than marching cubes, makes far
 * fewer slivers, and the quads come out evenly sized all over the body, which
 * is what skinning wants.
 *
 * The field is only sampled finely near the surface: a coarse pass first
 * skips any block of cells that is provably all inside or all outside.
 */
export function surfaceNets(f: Dist, min: V3, max: V3, step: number) {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  const B = 4;
  const reach = B * step * 0.87 * 1.3 + step;
  for (let bk = 0; bk < nz; bk += B) {
    for (let bj = 0; bj < ny; bj += B) {
      for (let bi = 0; bi < nx; bi += B) {
        const c = f(
          min[0] + (bi + B / 2) * step,
          min[1] + (bj + B / 2) * step,
          min[2] + (bk + B / 2) * step
        );
        const far = Math.abs(c) > reach;
        for (let k = bk; k < Math.min(nz, bk + B); k++) {
          for (let j = bj; j < Math.min(ny, bj + B); j++) {
            for (let i = bi; i < Math.min(nx, bi + B); i++) {
              vals[at(i, j, k)] = far
                ? c
                : f(min[0] + i * step, min[1] + j * step, min[2] + k * step);
            }
          }
        }
      }
    }
  }

  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const cell = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  const pos: number[] = [];

  // the 12 edges of a cube, as pairs of corner offsets
  const corners: V3[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[at(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          const va = cv[a];
          const vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          n++;
        }
        cellVert[cell(i, j, k)] = pos.length / 3;
        pos.push(
          min[0] + (i + sx / n) * step,
          min[1] + (j + sy / n) * step,
          min[2] + (k + sz / n) * step
        );
      }
    }
  }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = vals[at(i, j, k)] < 0;
        // x edge from (i,j,k): cells around it share j-1..j, k-1..k
        if (v0 !== vals[at(i + 1, j, k)] < 0) {
          quad(
            cellVert[cell(i, j - 1, k - 1)],
            cellVert[cell(i, j, k - 1)],
            cellVert[cell(i, j, k)],
            cellVert[cell(i, j - 1, k)]
          );
        }
        if (v0 !== vals[at(i, j + 1, k)] < 0) {
          quad(
            cellVert[cell(i - 1, j, k - 1)],
            cellVert[cell(i, j, k - 1)],
            cellVert[cell(i, j, k)],
            cellVert[cell(i - 1, j, k)]
          );
        }
        if (v0 !== vals[at(i, j, k + 1)] < 0) {
          quad(
            cellVert[cell(i - 1, j - 1, k)],
            cellVert[cell(i, j - 1, k)],
            cellVert[cell(i, j, k)],
            cellVert[cell(i - 1, j, k)]
          );
        }
      }
    }
  }

  // Pull every vertex onto the true surface, a couple of Newton steps along
  // the gradient. The cell average is only ever an approximation, and on a
  // shape this curved it shows as faint terracing.
  const eps = step * 0.3;
  const maxMove = step * 0.8;
  for (let v = 0; v < pos.length; v += 3) {
    const ox = pos[v];
    const oy = pos[v + 1];
    const oz = pos[v + 2];
    let x = ox;
    let y = oy;
    let z = oz;
    for (let it = 0; it < 1; it++) {
      const d = f(x, y, z);
      const n = normalAt(f, [x, y, z], eps);
      x -= n[0] * d;
      y -= n[1] * d;
      z -= n[2] * d;
    }
    const mx = x - ox;
    const my = y - oy;
    const mz = z - oz;
    const m = len3(mx, my, mz);
    const s = m > maxMove ? maxMove / m : 1;
    pos[v] = ox + mx * s;
    pos[v + 1] = oy + my * s;
    pos[v + 2] = oz + mz * s;
  }

  // Normals straight from the field, so the shading is as smooth as the shape
  // rather than as smooth as the triangles.
  const nrm = new Float32Array(pos.length);
  for (let v = 0; v < pos.length; v += 3) {
    const n = normalAt(f, [pos[v], pos[v + 1], pos[v + 2]], eps);
    nrm[v] = n[0];
    nrm[v + 1] = n[1];
    nrm[v + 2] = n[2];
  }

  // Winding: rather than reason about which way round each quad was emitted,
  // compare each triangle with the field's own outward normal and flip it if
  // it disagrees. Cheap, and it cannot be wrong.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const dot = gx * (nrm[a] + nrm[b] + nrm[c]) + gy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + gz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (dot < 0) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }

  return { positions: new Float32Array(pos), normals: nrm, indices: idx };
}

// ---------------------------------------------------------------------------
// skinning
// ---------------------------------------------------------------------------

export interface SkinOptions {
  min: V3;
  max: V3;
  step: number;
  /**
   * How far apart two parts' distances have to be before one of them owns a
   * vertex outright. Small = hard joints, large = rubbery ones.
   */
  falloff?: number;
  /** Paint vertex colours from each prim's `color`, plus an optional override. */
  colors?: boolean;
  paint?: (p: V3, base: THREE.Color, part: Prim) => void;
  /**
   * An extra per-vertex number, written to a `region` attribute — for a
   * material that wants to paint some parts itself, per pixel.
   */
  region?: (part: Prim) => number;
}

/**
 * Mesh a body and weight it to its bones.
 *
 * Each vertex goes to whichever bones' parts it sits closest to, falling off
 * exponentially with how much further away the others are. Where a forearm
 * meets an upper arm both are equally close and the vertex is shared between
 * them, which is exactly a smooth elbow; out on the middle of the forearm the
 * upper arm is far away and drops out entirely.
 */
export function buildSkin(prims: Prim[], o: SkinOptions): THREE.BufferGeometry {
  const f = fieldOf(prims);
  const mesh = surfaceNets(f, o.min, o.max, o.step);
  const n = mesh.positions.length / 3;
  const falloff = o.falloff ?? 0.025;

  const boneCount = Math.max(...prims.map((p) => p.bone)) + 1;
  const best = new Float32Array(boneCount);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const colors = o.colors ? new Float32Array(n * 3) : null;
  const region = o.region ? new Float32Array(n) : null;
  const solid = prims.filter((p) => !p.sub);
  const regionOf = o.region ? solid.map((p) => o.region!(p)) : null;
  const parsed = solid.map((p) => new THREE.Color(p.color ?? "#ffffff"));
  const reachW = 0.06 + falloff * 5;
  const c = new THREE.Color();

  for (let v = 0; v < n; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    best.fill(Infinity);
    let r0 = Infinity;
    let r1 = Infinity;
    let nearest = 0;
    let nearestD = Infinity;
    // Every vertex is ON the surface, so the part it belongs to is no more
    // than a fillet's width away; anything whose bounding sphere is further
    // than that plus the weight falloff cannot earn any weight and is skipped.
    for (let i = 0; i < solid.length; i++) {
      const p = solid[i];
      const c = p.d.bc;
      if (c && Math.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) - (p.d.br ?? 0) > reachW) continue;
      const d = p.d(x, y, z) - (p.bias ?? 0);
      if (d < best[p.bone]) best[p.bone] = d;
      if (regionOf) {
        if (regionOf[i] > 0.5) r1 = Math.min(r1, d);
        else r0 = Math.min(r0, d);
      }
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
    }
    let dmin = Infinity;
    for (let b = 0; b < boneCount; b++) dmin = Math.min(dmin, best[b]);

    // top four bones by weight
    const w: [number, number][] = [];
    for (let b = 0; b < boneCount; b++) {
      if (best[b] === Infinity) continue;
      const gap = best[b] - dmin;
      if (gap > falloff * 5) continue;
      w.push([b, Math.exp(-gap / falloff)]);
    }
    w.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let i = 0; i < Math.min(4, w.length); i++) sum += w[i][1];
    for (let i = 0; i < 4; i++) {
      skinIndex[v * 4 + i] = i < w.length ? w[i][0] : 0;
      skinWeight[v * 4 + i] = i < w.length ? w[i][1] / sum : 0;
    }

    // Blended by distance rather than taken from the nearest part, so the
    // boundary follows the line where the two parts meet instead of snapping
    // from vertex to vertex in a saw-tooth.
    if (region) region[v] = Math.min(1, Math.max(0, 0.5 + (r0 - r1) / 0.016));
    if (colors) {
      c.copy(parsed[nearest]);
      o.paint?.([x, y, z], c, solid[nearest]);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  if (colors) geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (region) geo.setAttribute("region", new THREE.BufferAttribute(region, 1));
  geo.setIndex(mesh.indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The rig's rest pose, captured. The skin is meshed around the body standing
 * at rest, so it has to be bound against the bones as they stand at rest —
 * and since the mesh is built in a worker and arrives a second or two later,
 * by which time the rig is mid-dance, the rest pose is snapshotted up front:
 * every bone's inverse world matrix, and where the skin's parent was.
 *
 * Call it with the rig in its rest pose, before anything has animated it.
 */
export interface RestPose {
  bones: THREE.Object3D[];
  inverses: THREE.Matrix4[];
  bind: THREE.Matrix4;
  skeleton?: THREE.Skeleton;
}

export function snapshotRest(parent: THREE.Object3D, bones: THREE.Object3D[]): RestPose {
  parent.updateMatrixWorld(true);
  return {
    bones,
    inverses: bones.map((b) => b.matrixWorld.clone().invert()),
    bind: parent.matrixWorld.clone(),
  };
}

/**
 * Wrap a skin geometry in a SkinnedMesh under `parent`, bound to the rest pose
 * that was snapshotted. Several meshes bound to the same snapshot share one
 * skeleton.
 *
 * The bones are ordinary groups, not THREE.Bone — the skeleton only ever reads
 * their world matrices, so the existing pose code drives the skin untouched.
 */
export function bindSkin(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  rest: RestPose
): THREE.SkinnedMesh {
  rest.skeleton ??= new THREE.Skeleton(rest.bones as THREE.Bone[], rest.inverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The skin moves a long way from its bind-pose bounds (a cow on its hind
  // legs, a leg mid-stride), so culling against them would pop it out.
  mesh.frustumCulled = false;
  parent.add(mesh);
  mesh.bind(rest.skeleton, rest.bind);
  return mesh;
}

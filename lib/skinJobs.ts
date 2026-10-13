// The expensive part of every character — meshing its distance field — as a
// job that can run anywhere: in the skin worker normally, or right here on the
// main thread if a worker cannot be had. Geometry crosses the thread boundary
// as plain typed arrays, transferred rather than copied.

import * as THREE from "three";
import { cowJawGeo, cowSkinGeo } from "./cowBody";
import { buildOfficer, OFFICER_BONES, type Frames } from "./officerBody";
import { buildSheep } from "./sheepBody";
import { buildScarecrow } from "./scarecrowBody";

export type SkinJob =
  | { kind: "cow" }
  | { kind: "sheep" }
  | { kind: "scarecrow" }
  /** The officer is built around his own rig: each bone's rest matrix, as 16 numbers. */
  | { kind: "officer"; frames: number[][] };

type Arr = Float32Array | Uint16Array | Uint32Array;

export interface PackedGeo {
  attrs: { name: string; array: Arr; itemSize: number }[];
  index: Uint32Array | null;
}

export function runJob(job: SkinJob): THREE.BufferGeometry[] {
  switch (job.kind) {
    case "cow":
      return [cowSkinGeo(), cowJawGeo()];
    case "scarecrow":
      return [buildScarecrow()];
    case "sheep": {
      const s = buildSheep();
      return [s.body, s.head];
    }
    case "officer": {
      const frames = Object.fromEntries(
        OFFICER_BONES.map((n, i) => [n, new THREE.Matrix4().fromArray(job.frames[i])])
      ) as Frames;
      const o = buildOfficer(frames);
      return [o.body, o.head];
    }
  }
}

export function pack(geo: THREE.BufferGeometry): PackedGeo {
  return {
    attrs: Object.entries(geo.attributes).map(([name, a]) => ({
      name,
      array: (a as THREE.BufferAttribute).array as Arr,
      itemSize: a.itemSize,
    })),
    index: geo.index ? Uint32Array.from(geo.index.array as ArrayLike<number>) : null,
  };
}

export function unpack(p: PackedGeo): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const a of p.attrs) geo.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize));
  if (p.index) geo.setIndex(new THREE.BufferAttribute(p.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function transferables(list: PackedGeo[]): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const p of list) {
    for (const a of p.attrs) out.push(a.array.buffer as ArrayBuffer);
    if (p.index) out.push(p.index.buffer as ArrayBuffer);
  }
  return out;
}

// The scarecrow, as one stuffed piece: a lumpy plaid shirt hung off a cross,
// sleeves sagging under their own straw, a rope round the middle and a burlap
// sack for a head. Built in the skin worker like everything else with a body.
//
// Everything is in the scarecrow's own space: the post at the origin, +z the
// way it faces, y up from the ground.

import * as THREE from "three";
import { rng } from "./rand";
import { buildSkin, capsule, ellipsoid, fieldOf, normalAt, rayHit, roundCone, sphere, type Prim, type V3 } from "./sdf";

const SHIRT = "#9a3a35";
const SACK = "#c7a66c";

function headPrims(): Prim[] {
  const r = rng(4243);
  const head: Prim[] = [{ d: ellipsoid([0, 1.62, 0], [0.165, 0.185, 0.15]), bone: 0, color: SACK, tag: "sack" }];
  // a sack stuffed unevenly
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const y = 1.56 + r() * 0.14;
    head.push({
      d: sphere([Math.cos(a) * 0.1, y, Math.sin(a) * 0.08], 0.07 + r() * 0.03),
      bone: 0,
      k: 0.05,
      color: SACK,
      tag: "sack",
    });
  }
  // gathered and tied at the neck
  head.push({ d: roundCone([0, 1.43, 0], [0, 1.5, 0], 0.045, 0.08), bone: 0, k: 0.03, color: SACK, tag: "sack" });
  return head;
}

/** The face is drawn on the front of the sack, so it is found ON the sack. */
export function onSack(x: number, y: number): { p: V3; n: V3 } {
  const f = fieldOf(headPrims());
  const p = rayHit(f, [x, y, 0.5], [0, 0, -1], 1) ?? [x, y, 0.15];
  return { p, n: normalAt(f, p) };
}

export function buildScarecrow(): THREE.BufferGeometry {
  const r = rng(515);
  const body: Prim[] = [
    // a shirt stuffed with straw: fat in places, flat in others
    { d: roundCone([0, 0.86, 0], [0, 1.24, 0], 0.17, 0.19, 1), bone: 0, color: SHIRT, tag: "shirt" },
    { d: ellipsoid([0, 0.84, 0], [0.22, 0.09, 0.16]), bone: 0, k: 0.06, color: SHIRT, tag: "shirt" },
    { d: ellipsoid([0.05, 1.05, 0.06], [0.14, 0.14, 0.11]), bone: 0, k: 0.07, color: SHIRT, tag: "shirt" },
    { d: ellipsoid([-0.06, 1.17, -0.04], [0.15, 0.1, 0.11]), bone: 0, k: 0.07, color: SHIRT, tag: "shirt" },
    // the collar
    { d: capsule([0, 1.33, 0], [0, 1.38, 0], 0.075), bone: 0, k: 0.05, color: SHIRT, tag: "shirt" },
  ];
  // sleeves, sagging between the shoulder and the end of the cross-piece
  for (const s of [-1, 1]) {
    const shoulder: V3 = [s * 0.16, 1.27, 0];
    const elbow: V3 = [s * 0.36, 1.19 + r() * 0.02, 0.01];
    const cuff: V3 = [s * 0.57, 1.24, 0];
    body.push(
      { d: roundCone(shoulder, elbow, 0.085, 0.07), bone: 0, k: 0.05, color: SHIRT, tag: "shirt" },
      { d: roundCone(elbow, cuff, 0.07, 0.062), bone: 0, k: 0.04, color: SHIRT, tag: "shirt" }
    );
  }
  body.push(...headPrims());

  return buildSkin(body, {
    min: [-0.7, 0.66, -0.26],
    max: [0.7, 1.86, 0.28],
    step: 0.011,
    colors: true,
    paint: (p, c, part) => {
      const [x, y, z] = p;
      if (part.tag === "shirt") {
        // plaid: two sets of stripes crossing, darker where they cross
        const u = Math.sin(x * 38) > 0.55 ? 1 : 0;
        const v = Math.sin(y * 38 + 1.3) > 0.55 ? 1 : 0;
        c.multiplyScalar(1 - 0.28 * u - 0.28 * v);
        // a rope round the middle
        if (y > 0.93 && y < 0.97) c.set("#b99a5b");
        // and a patch somebody sewed on, badly
        if (Math.abs(x - 0.09) < 0.055 && Math.abs(y - 1.1) < 0.05 && z > 0) c.set("#3e5a8a");
      } else if (part.tag === "sack") {
        // burlap is never one colour
        const n = Math.sin(x * 140) * Math.sin(y * 150) * 0.04 + Math.sin(z * 90 + y * 30) * 0.03;
        c.offsetHSL(0, 0, n);
      }
    },
  });
}

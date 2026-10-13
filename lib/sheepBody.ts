// A sheep, as two pieces of one-piece skin: a fleece and a head. The same
// technique as the cow (lib/sdf.ts), so the sheep stop being a ball on four
// sticks standing next to an animal that is not. Built in the skin worker.

import * as THREE from "three";
import { rng } from "./rand";
import { buildSkin, ellipsoid, roundCone, sphere, type Prim } from "./sdf";

export const WOOL = "#ece7dc";
export const SHEEP_DARK = "#2f2b27";

export function buildSheep(): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const r = rng(7171);
  // A fleece is a cloud of overlapping lumps over a barrel: smooth, it reads
  // as a bean.
  const wool: Prim[] = [{ d: ellipsoid([0, 0.47, 0], [0.2, 0.17, 0.3]), bone: 0, color: WOOL }];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const zz = (r() - 0.5) * 0.5;
    const y = 0.47 + Math.sin(a) * 0.15;
    const x = Math.cos(a) * 0.17;
    if (y < 0.36) continue;
    wool.push({ d: sphere([x, y, zz], 0.075 + r() * 0.05), bone: 0, k: 0.05, color: WOOL });
  }
  wool.push({ d: sphere([0, 0.5, -0.33], 0.07), bone: 0, k: 0.04, color: WOOL }); // tail
  const body = buildSkin(wool, { min: [-0.34, 0.18, -0.48], max: [0.34, 0.74, 0.46], step: 0.016, colors: true });

  const headParts: Prim[] = [
    // a long dark face, and a woolly cap on top of it
    { d: roundCone([0, 0.02, -0.02], [0, -0.05, 0.14], 0.068, 0.046), bone: 0, color: SHEEP_DARK },
    { d: sphere([0, 0.075, -0.02], 0.072), bone: 0, k: 0.03, color: WOOL },
    { d: sphere([0.04, 0.06, 0.03], 0.05), bone: 0, k: 0.03, color: WOOL },
    { d: sphere([-0.045, 0.065, 0.025], 0.05), bone: 0, k: 0.03, color: WOOL },
    ...[-1, 1].map((sx) => ({
      d: ellipsoid([sx * 0.095, 0.02, 0.0], [0.06, 0.018, 0.03], [0, 0, sx * -0.35]),
      bone: 0,
      k: 0.015,
      color: SHEEP_DARK,
    })),
  ];
  const head = buildSkin(headParts, { min: [-0.18, -0.12, -0.12], max: [0.18, 0.16, 0.22], step: 0.009, colors: true });
  return { body, head };
}

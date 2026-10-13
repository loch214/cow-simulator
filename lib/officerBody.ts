// The officer's body, as one piece of skin — two, in fact: a body, and a
// head-and-neck that goes down inside the shirt collar, which is where a seam
// belongs. Pure data and arithmetic, no React, so the meshing can run in a
// worker (lib/skin.worker.ts) instead of freezing the page while it loads.
//
// Every part is described in the frame of the bone it moves with; `buildOfficer`
// is handed each bone's rest transform, read off the live group tree in
// components/Officer.tsx, so the rig is only ever written down once.

import * as THREE from "three";
import {
  buildSkin,
  capsule,
  ellipsoid,
  fieldOf,
  inFrame,
  normalAt,
  rayHit,
  roundBox,
  roundCone,
  sphere,
  type Dist,
  type Prim,
  type V3,
} from "./sdf";

/**
 * The stance, solved rather than eyeballed, so the boots stand ON the forecourt
 * instead of in it. The thigh tips forward and the shin tips back under it —
 * the shape a heavy man standing still for an hour settles into — and the boot
 * then cancels the net angle so the sole stays flat.
 */
export const HIP_Y = 0.9;
export const THIGH = 0.4;
export const SHIN = 0.4;
export const THIGH_TILT = 0.09;
export const SHIN_TILT = -0.16;
/** What the boot has to undo to sit flat on the ground. */
export const FOOT_LEVEL = -(THIGH_TILT + SHIN_TILT);
/** Where his head sits on top of his chest. High enough that there IS a neck. */
export const HEAD_Y = 0.79;

export const C = {
  shirt: "#8fa8cc",
  vest: "#1b2440",
  hivis: "#d8e24a",
  trouser: "#262b3b",
  boot: "#151515",
  belt: "#121318",
  skin: "#d49b73",
  flush: "#cf7a66",
  hair: "#5a4436",
  cap: "#22335e",
  visor: "#0e0e12",
  check: "#eef0f5",
};

/** The bones the skin is weighted to — every group the animation moves. */
export const OFFICER_BONES = [
  "root", "hips",
  "legL", "shinL", "bootL", "legR", "shinR", "bootR",
  "chest", "belly",
  "padArm", "padFore", "foodArm", "foodFore",
  "head", "jaw",
] as const;
export type BoneName = (typeof OFFICER_BONES)[number];
const BI = Object.fromEntries(OFFICER_BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

// ---------------------------------------------------------------------------
// anatomy — every part described in the frame of the bone it moves with
// ---------------------------------------------------------------------------

type Part = { d: Dist; k?: number; color: string; tag?: string; sub?: boolean };

/** His head, in head space: the origin is the middle of the skull. */
export function headParts(): Part[] {
  return [
    { d: ellipsoid([0, 0.03, 0], [0.125, 0.14, 0.13]), color: C.skin, tag: "face" },
    // jowls: where the weight shows first
    ...[-1, 1].map((s) => ({
      d: ellipsoid([s * 0.072, -0.055, 0.035], [0.07, 0.072, 0.07]),
      k: 0.05,
      color: C.skin,
      tag: "face",
    })),
    // a heavy brow, which is most of "bored"
    { d: ellipsoid([0, 0.058, 0.085], [0.105, 0.028, 0.045]), k: 0.03, color: C.skin, tag: "face" },
    // a nose that has seen a lot of pubs
    { d: ellipsoid([0, 0.005, 0.135], [0.034, 0.038, 0.04]), k: 0.016, color: C.flush, tag: "nose" },
    ...[-1, 1].map((s) => ({
      d: ellipsoid([s * 0.125, 0.012, -0.005], [0.022, 0.045, 0.032]),
      k: 0.014,
      color: C.skin,
      tag: "face",
    })),
    // the second chin
    { d: ellipsoid([0, -0.11, 0.02], [0.095, 0.055, 0.08]), k: 0.05, color: C.skin, tag: "face" },
  ];
}

/** The chin, on the jaw: it drops when he yawns or talks. */
function jawParts(): Part[] {
  return [{ d: ellipsoid([0, -0.065, 0.1], [0.075, 0.05, 0.06]), k: 0.045, color: C.skin, tag: "face" }];
}

function neckParts(): Part[] {
  // thick, short, and going down inside the collar
  return [{ d: capsule([0, 0.52, -0.01], [0, 0.76, 0.01], 0.086), k: 0.05, color: C.skin, tag: "neck" }];
}

function torsoParts(): Part[] {
  return [
    { d: ellipsoid([0, 0.3, -0.02], [0.25, 0.23, 0.18]), color: C.shirt, tag: "torso" },
    { d: ellipsoid([0, 0.48, -0.005], [0.255, 0.19, 0.175]), k: 0.12, color: C.shirt, tag: "torso" },
    // sloping, padded shoulders
    { d: ellipsoid([0, 0.6, -0.015], [0.285, 0.075, 0.14]), k: 0.1, color: C.shirt, tag: "torso" },
    // the collar, round the bottom of the neck
    { d: capsule([0, 0.6, -0.01], [0, 0.66, 0.0], 0.1), k: 0.05, color: C.shirt, tag: "collar" },
  ];
}

function gutParts(): Part[] {
  // The single most important shape on him.
  return [{ d: ellipsoid([0, 0.18, 0.075], [0.268, 0.255, 0.265]), k: 0.1, color: C.shirt, tag: "torso" }];
}

function hipParts(): Part[] {
  return [{ d: ellipsoid([0, 0.0, -0.025], [0.235, 0.15, 0.19]), k: 0.1, color: C.trouser, tag: "hips" }];
}

const thighParts = (): Part[] => [
  { d: roundCone([0, 0.04, 0], [0, -THIGH, 0], 0.128, 0.094), k: 0.06, color: C.trouser },
];
const shinParts = (): Part[] => [
  { d: roundCone([0, 0, 0], [0, -SHIN + 0.04, 0], 0.094, 0.072), k: 0.04, color: C.trouser },
];
const bootParts = (): Part[] => [
  { d: roundCone([0, 0.05, 0], [0, -0.04, 0.01], 0.07, 0.076), k: 0.02, color: C.boot },
  { d: roundBox([0, -0.06, 0.055], [0.07, 0.04, 0.15], 0.038), k: 0.03, color: C.boot },
];

const upperArmParts = (): Part[] => [
  { d: sphere([0, 0, 0], 0.094), color: C.shirt, tag: "sleeve" },
  { d: roundCone([0, 0, 0], [0, -0.25, 0], 0.088, 0.072), k: 0.04, color: C.shirt, tag: "sleeve" },
];
/** Short sleeves. A fat man in short sleeves is funnier than one in long ones. */
const foreArmParts = (): Part[] => [
  { d: roundCone([0, 0.0, 0], [0, -0.235, 0.004], 0.068, 0.054), k: 0.035, color: C.skin, tag: "arm" },
  { d: ellipsoid([0, -0.29, 0.016], [0.048, 0.064, 0.052]), k: 0.03, color: C.skin, tag: "arm" },
];

// ---------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------

const tmp = new THREE.Color();

/** Which parts the shader paints (1) rather than taking their vertex colour (0). */
const shaderPainted = (part: Prim) => (part.tag === "torso" || part.tag === "hips" ? 1 : 0);

function paintHead(p: V3, c: THREE.Color, part: Prim) {
  const [x, y, z] = p;
  const tag = part.tag;
  const hy = y - (HIP_Y + HEAD_Y); // back to head space
  if (tag === "face") {
    // short back and sides under the cap, and a ruddy patch on each cheek
    if (z < -0.03 && hy > -0.02 && hy < 0.1) c.set(C.hair);
    const cheek = Math.min(
      Math.hypot(x - 0.075, hy + 0.025, z - 0.1),
      Math.hypot(x + 0.075, hy + 0.025, z - 0.1)
    );
    if (cheek < 0.05) c.lerp(tmp.set(C.flush), 0.6 * (1 - cheek / 0.05));
  } else if (tag === "neck") {
    if (y < HIP_Y + 0.6) c.set(C.shirt);
  }
}

// ---------------------------------------------------------------------------
// building the skin from the rig
// ---------------------------------------------------------------------------

export type Frames = Record<BoneName, THREE.Matrix4>;

/**
 * Turn each part into a primitive in model space. `frames` is every bone's
 * transform relative to the officer's own origin, read off the live group tree
 * in its rest pose — so the skin is built around exactly the skeleton that will
 * drive it, and nothing about the rig has to be written down twice.
 */
function place(parts: Part[], bone: BoneName, frames: Frames): Prim[] {
  return parts.map((p) => ({
    d: inFrame(p.d, frames[bone]),
    bone: BI[bone],
    k: p.k,
    color: p.color,
    tag: p.tag,
    sub: p.sub,
  }));
}

/** Mesh both pieces of him. Expensive: run it in the worker. */
export function buildOfficer(frames: Frames): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const body: Prim[] = [
    ...place(torsoParts(), "chest", frames),
    ...place(gutParts(), "belly", frames),
    ...place(hipParts(), "hips", frames),
    ...(["L", "R"] as const).flatMap((s) => [
      ...place(thighParts(), `leg${s}`, frames),
      ...place(shinParts(), `shin${s}`, frames),
      ...place(bootParts(), `boot${s}`, frames),
    ]),
    ...place(upperArmParts(), "padArm", frames),
    ...place(foreArmParts(), "padFore", frames),
    ...place(upperArmParts(), "foodArm", frames),
    ...place(foreArmParts(), "foodFore", frames),
  ];
  const head: Prim[] = [
    ...place(neckParts(), "chest", frames),
    ...place(headParts(), "head", frames),
    ...place(jawParts(), "jaw", frames),
  ];
  const top = HIP_Y + HEAD_Y;
  return {
    body: buildSkin(body, {
      min: [-0.62, -0.02, -0.36],
      max: [0.62, 1.66, 0.58],
      step: 0.0115,
      falloff: 0.02,
      colors: true,
      region: shaderPainted,
    }),
    head: buildSkin(head, {
      min: [-0.17, HIP_Y + 0.5, -0.2],
      max: [0.17, top + 0.21, 0.24],
      step: 0.0058,
      falloff: 0.02,
      colors: true,
      paint: paintHead,
      region: () => 0,
    }),
  };
}

/** The face alone, in head space, for planting eyes and a moustache on it. */
const faceField = (() => {
  let f: Dist | null = null;
  return () => (f ??= fieldOf(headParts().map((p) => ({ ...p, bone: 0 }))));
})();

function onFace(x: number, y: number): { p: V3; n: V3 } {
  const f = faceField();
  const p = rayHit(f, [x, y, 0.5], [0, 0, -1], 1) ?? [x, y, 0.12];
  return { p, n: normalAt(f, p) };
}

/** Where the eyes, the moustache and the mouth go, found on the face. */
export const FACE = (() => {
  const at = (x: number, y: number, sink: number) => {
    const { p, n } = onFace(x, y);
    return {
      pos: [p[0] - n[0] * sink, p[1] - n[1] * sink, p[2] - n[2] * sink] as V3,
      rot: [-Math.asin(n[1]) * 0.6, Math.atan2(n[0], n[2]), 0] as V3,
    };
  };
  return {
    eyes: [-1, 1].map((s) => at(s * 0.05, 0.035, 0.008)),
    tache: at(0, -0.032, 0.012),
    mouth: at(0, -0.06, 0.004),
  };
})();

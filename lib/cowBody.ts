// The cow's body, as one piece of skin.
//
// Every number in here is a position in BODY space with the cow standing square:
// +z is forward, y is up from the ground, and the cow's own origin is on the
// ground between its feet. The leg segments are not placed by eye — they are
// laid along the very bones the leg solver drives, at their resting angles, so
// the skin and the skeleton agree about where every joint is.
//
// See lib/sdf.ts for how a list of these turns into a mesh.

import * as THREE from "three";
import { BACK_REST, BACK_RIG, FRONT_REST, FRONT_RIG, type LegAngles, type LegRig } from "./locomotion";
import {
  buildSkin,
  capsule,
  ellipsoid,
  roundBox,
  fieldOf,
  normalAt,
  rayHit,
  roundCone,
  sphere,
  type Dist,
  type Prim,
  type V3,
} from "./sdf";

/** The poll — the joint at the top of the neck that the skull hangs off. */
export const HEAD_POS: V3 = [0, 1.05, 0.86];
/** Where the neck bone starts, buried in the chest. */
export const NECK_ROOT: V3 = [0, 0.95, 0.32];
/** The jaw hinge, in head space. */
export const JAW_POS: V3 = [0, -0.045, 0.05];
/** How far up from the end of the leg chain the hoof's coronet is. */
export const HOOF_HEIGHT = 0.098;

/**
 * The bones the skin is weighted to, in order. Cow.tsx binds the skeleton to the
 * groups with these names, so this list is the contract between the two files.
 */
export const COW_BONES = [
  "body",
  "neck",
  "head",
  "legFL", "kneeFL", "shinFL", "hoof0",
  "legFR", "kneeFR", "shinFR", "hoof1",
  "legBL", "kneeBL", "shinBL", "hoof2",
  "legBR", "kneeBR", "shinBR", "hoof3",
  "tail",
  "jaw",
] as const;

const BONE = Object.fromEntries(COW_BONES.map((n, i) => [n, i])) as Record<(typeof COW_BONES)[number], number>;

/** Head space to body space, at rest. The head has no resting rotation. */
const h = (x: number, y: number, z: number): V3 => [x + HEAD_POS[0], y + HEAD_POS[1], z + HEAD_POS[2]];

// ---------------------------------------------------------------------------
// legs, laid along the rig
// ---------------------------------------------------------------------------

/** A bone of length `len` hanging off `from` at angle `a` about X. */
function down(from: V3, len: number, a: number): V3 {
  return [from[0], from[1] - len * Math.cos(a), from[2] - len * Math.sin(a)];
}

interface LegJoints {
  hip: V3;
  elbow: V3;
  knee: V3;
  end: V3;
}

/** Where each joint of a leg is with the cow standing square. */
export function legJoints(rig: LegRig, rest: LegAngles, side: number): LegJoints {
  const hip: V3 = [side * rig.hipX, rig.hipY, rig.hipZ];
  const elbow = down(hip, rig.seg[0], rest.hip);
  const knee = down(elbow, rig.seg[1], rest.hip + rest.knee);
  const end = down(knee, rig.seg[2], rest.hip + rest.knee + rest.shin);
  return { hip, elbow, knee, end };
}

const up = (p: V3, dy: number, dz = 0): V3 => [p[0], p[1] + dy, p[2] + dz];

function frontLeg(side: number, bones: [number, number, number, number]): Prim[] {
  const j = legJoints(FRONT_RIG, FRONT_REST, side);
  const [hip, knee, shin, hoof] = bones;
  return [
    // the upper arm, almost all of it inside the shoulder
    { d: roundCone(j.hip, j.elbow, 0.1, 0.074), bone: hip, k: 0.07 },
    // forearm: muscular at the top, tapering into the knee
    { d: roundCone(up(j.elbow, 0.02), j.knee, 0.07, 0.044), bone: knee, k: 0.05 },
    // the knee (carpus) — the widest point of a cow's lower leg
    { d: ellipsoid(up(j.knee, 0, 0.004), [0.047, 0.052, 0.05]), bone: shin, k: 0.03 },
    { d: roundCone(j.knee, up(j.end, 0.13), 0.04, 0.035), bone: shin, k: 0.03 },
    // fetlock, and the pastern sloping down into the hoof
    { d: ellipsoid(up(j.end, 0.125, -0.008), [0.043, 0.042, 0.047]), bone: shin, k: 0.03 },
    { d: roundCone(up(j.end, 0.12, -0.004), up(j.end, 0.07, 0.012), 0.039, 0.041), bone: hoof, k: 0.03 },
  ];
}

function backLeg(side: number, bones: [number, number, number, number]): Prim[] {
  const j = legJoints(BACK_RIG, BACK_REST, side);
  const [hip, knee, shin, hoof] = bones;
  return [
    // the thigh, fat at the top where it becomes the haunch
    { d: roundCone(j.hip, j.elbow, 0.125, 0.085), bone: hip, k: 0.08 },
    // gaskin
    { d: roundCone(up(j.elbow, 0.01), j.knee, 0.08, 0.046), bone: knee, k: 0.05 },
    // the hock, and the point of it sticking out behind
    { d: ellipsoid(up(j.knee, 0, -0.008), [0.046, 0.055, 0.055]), bone: shin, k: 0.03 },
    { d: sphere(up(j.knee, 0.035, -0.05), 0.03), bone: shin, k: 0.04 },
    { d: roundCone(j.knee, up(j.end, 0.13), 0.04, 0.035), bone: shin, k: 0.03 },
    { d: ellipsoid(up(j.end, 0.125, -0.008), [0.043, 0.042, 0.047]), bone: shin, k: 0.03 },
    { d: roundCone(up(j.end, 0.12, -0.004), up(j.end, 0.07, 0.012), 0.039, 0.041), bone: hoof, k: 0.03 },
  ];
}

// ---------------------------------------------------------------------------
// the head
// ---------------------------------------------------------------------------

/**
 * The skull, in body space. Short, deep and broad across the eyes, pinched a
 * little at the bridge and flaring into a wide, blunt muzzle — the proportions
 * that read as cow rather than horse, pig or anteater, all of which this head
 * has been at one time or another.
 */
function headPrims(): Prim[] {
  const b = BONE.head;
  return [
    { d: ellipsoid(h(0, 0.015, -0.04), [0.132, 0.13, 0.13]), bone: b, k: 0.05 },
    // the long flat face
    { d: roundCone(h(0, 0.0, 0.02), h(0, -0.055, 0.19), 0.112, 0.088, 0.98), bone: b, k: 0.07 },
    // The muzzle: broad, flat-fronted and squarish. A round one is a pig's
    // snout from the front, which is exactly what the first version of this
    // head turned out to be.
    { d: roundBox(h(0, -0.072, 0.262), [0.106, 0.07, 0.062], 0.05), bone: b, k: 0.07 },
    // cheeks, where the chewing muscles are
    ...[-1, 1].map((s) => ({ d: ellipsoid(h(s * 0.082, -0.055, 0.03), [0.06, 0.07, 0.085]), bone: b, k: 0.05 })),
    // brow ridges: the eyes sit under these, which is what gives a cow its
    // permanently mildly-concerned expression
    ...[-1, 1].map((s) => ({ d: ellipsoid(h(s * 0.1, 0.05, 0.04), [0.048, 0.04, 0.05]), bone: b, k: 0.04 })),
    // the flat poll between the horns
    { d: ellipsoid(h(0, 0.1, -0.07), [0.11, 0.05, 0.065]), bone: b, k: 0.05 },
    // underside of the jaw, back where it meets the throat
    { d: ellipsoid(h(0, -0.09, -0.03), [0.08, 0.075, 0.1]), bone: b, k: 0.06 },
    // Nostrils: commas pressed into the front corners of the muzzle, flaring
    // outward — a cow's nostrils face forward-and-out, not straight ahead.
    ...[-1, 1].map((s) => ({
      d: ellipsoid(h(s * 0.05, -0.058, 0.322), [0.016, 0.026, 0.026], [0, s * 0.5, s * 0.45]),
      bone: b,
      k: 0.014,
      sub: true,
    })),
  ];
}

/** The lower jaw, as its own piece of skin — the mouth has to be able to open. */
function jawPrims(): Prim[] {
  const b = BONE.jaw;
  return [
    { d: roundCone(h(0, -0.098, -0.01), h(0, -0.122, 0.24), 0.07, 0.05, 1.15), bone: b, k: 0.04 },
    // the lower lip and chin, tucked up under the muzzle
    { d: ellipsoid(h(0, -0.13, 0.235), [0.07, 0.04, 0.06]), bone: b, k: 0.04 },
  ];
}

// ---------------------------------------------------------------------------
// the whole animal
// ---------------------------------------------------------------------------

function bodyPrims(): Prim[] {
  const b = BONE.body;
  const mirror = (f: (s: number) => Prim) => [f(-1), f(1)];
  return [
    // The barrel is three overlapping masses rather than one egg: ribs, a belly
    // that hangs lower and wider, and a squarer hindquarter. A cow is deeper
    // than it is wide and close to straight along the back.
    { d: ellipsoid([0, 0.835, 0.12], [0.265, 0.285, 0.48]), bone: b },
    { d: ellipsoid([0, 0.79, -0.2], [0.28, 0.29, 0.42]), bone: b, k: 0.16 },
    { d: ellipsoid([0, 0.875, -0.5], [0.232, 0.235, 0.27]), bone: b, k: 0.12 },
    // the pin bones and the slope of the rump down to the tail
    { d: ellipsoid([0, 0.97, -0.67], [0.165, 0.12, 0.12]), bone: b, k: 0.08 },
    // forequarter and chest
    { d: ellipsoid([0, 0.86, 0.48], [0.205, 0.26, 0.26]), bone: b, k: 0.12 },
    // a straight back, with the withers rising at the front of it
    { d: capsule([0, 1.03, 0.48], [0, 1.035, -0.6], 0.085), bone: b, k: 0.12 },
    { d: ellipsoid([0, 1.06, 0.42], [0.085, 0.07, 0.16]), bone: b, k: 0.08 },
    // the hooks: the two corners of the pelvis, which make a cow's back end
    // angular from above rather than round
    ...mirror((s) => ({ d: ellipsoid([s * 0.18, 1.02, -0.42], [0.065, 0.05, 0.07]), bone: b, k: 0.08 })),
    // shoulder and haunch — the muscle that the legs grow out of
    ...mirror((s) => ({ d: ellipsoid([s * 0.15, 0.84, 0.47], [0.1, 0.2, 0.15]), bone: b, k: 0.08, bias: -0.01 })),
    ...mirror((s) => ({ d: ellipsoid([s * 0.165, 0.8, -0.48], [0.1, 0.2, 0.18]), bone: b, k: 0.08, bias: -0.01 })),
    // brisket and dewlap: the keel of the chest and the fold of skin under the throat
    { d: ellipsoid([0, 0.64, 0.55], [0.12, 0.12, 0.14]), bone: b, k: 0.1 },
    { d: ellipsoid([0, 0.77, 0.68], [0.045, 0.13, 0.11]), bone: b, k: 0.08 },
    // the udder, two lobes with a cleft between them
    { d: ellipsoid([0, 0.6, -0.4], [0.13, 0.1, 0.16]), bone: b, k: 0.07 },
    ...mirror((s) => ({ d: ellipsoid([s * 0.068, 0.545, -0.4], [0.075, 0.07, 0.13]), bone: b, k: 0.04 })),
    // the root of the tail
    { d: capsule([0, 1.03, -0.66], [0, 1.0, -0.75], 0.048), bone: b, k: 0.05 },
  ];
}

function neckPrims(): Prim[] {
  return [
    // Deeper than it is wide, and buried in the chest at the bottom end — the
    // neck bone stretches between the body and wherever the head has gone.
    { d: roundCone([0, 0.92, 0.42], [0, 1.02, 0.84], 0.185, 0.128, 0.8), bone: BONE.neck, k: 0.12 },
  ];
}

const legBones = (prefix: "F" | "B", side: "L" | "R", hoof: number): [number, number, number, number] => [
  BONE[`leg${prefix}${side}` as "legFL"],
  BONE[`knee${prefix}${side}` as "kneeFL"],
  BONE[`shin${prefix}${side}` as "shinFL"],
  BONE[`hoof${hoof}` as "hoof0"],
];

/** Every part of the cow, in the order they are blended. */
export function cowPrims(): Prim[] {
  return [
    ...bodyPrims(),
    ...neckPrims(),
    ...headPrims(),
    ...frontLeg(-1, legBones("F", "L", 0)),
    ...frontLeg(1, legBones("F", "R", 1)),
    ...backLeg(-1, legBones("B", "L", 2)),
    ...backLeg(1, legBones("B", "R", 3)),
  ];
}

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

const BODY_MIN: V3 = [-0.42, -0.04, -0.86];
const BODY_MAX: V3 = [0.42, 1.34, 1.32];

/** The skin itself. Expensive (a few hundred ms), so it is built once. */
export const cowSkinGeo = once(() =>
  buildSkin(cowPrims(), { min: BODY_MIN, max: BODY_MAX, step: 0.0105, falloff: 0.022 })
);

export const cowJawGeo = once(() =>
  buildSkin(jawPrims(), { min: h(-0.13, -0.22, -0.14), max: h(0.13, -0.02, 0.34), step: 0.0075 })
);

// ---------------------------------------------------------------------------
// planting things on the face
// ---------------------------------------------------------------------------

/** The head alone, in HEAD space — what eyes, hair and horns are planted on. */
export const headField = once((): Dist => {
  const f = fieldOf(headPrims());
  return (x, y, z) => f(x + HEAD_POS[0], y + HEAD_POS[1], z + HEAD_POS[2]);
});

/** Where a ray from `from` toward `to` first meets the skull, in head space. */
export function onHead(from: V3, to: V3): { p: V3; n: V3 } {
  const f = headField();
  const dir: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const p = rayHit(f, from, dir, 1) ?? to;
  return { p, n: normalAt(f, p) };
}

/** Height of the top of the skull at (`x`, `z`), in head space. */
export function scalpY(x: number, z: number): number {
  return onHead([x, 0.4, z], [x, -0.2, z]).p[1];
}

// ---------------------------------------------------------------------------
// the coat
// ---------------------------------------------------------------------------

/**
 * Holstein patches, as blobs in body space. The coat is painted in the shader
 * from each pixel's position on the cow standing at rest, so a patch that
 * starts on the shoulder carries on down the leg and up the neck without a seam
 * — the old per-part textures restarted at every join, which was half of why
 * the cow looked bolted together.
 *
 * Deliberately lopsided. A symmetrical cow looks printed.
 */
const PATCHES: [V3, V3][] = [
  [[-0.27, 0.86, 0.02], [0.12, 0.24, 0.3]],
  [[0.27, 0.92, 0.24], [0.1, 0.22, 0.2]],
  [[0.27, 0.8, -0.36], [0.12, 0.2, 0.2]],
  [[0, 1.1, -0.3], [0.22, 0.1, 0.22]],
  [[-0.18, 0.98, 0.5], [0.12, 0.16, 0.16]],
  [[0.1, 1.0, 0.68], [0.1, 0.15, 0.13]],
  [[-0.22, 0.6, -0.52], [0.1, 0.15, 0.14]],
  [[0, 1.02, -0.74], [0.1, 0.09, 0.09]],
  // the head: a black poll and ears, and one black eye
  [[0, 1.18, 0.82], [0.2, 0.1, 0.15]],
  [[0.12, 1.08, 0.9], [0.07, 0.07, 0.08]],
  [[0.22, 0.55, 0.5], [0.08, 0.12, 0.1]],
];

export const COAT_GLSL = /* glsl */ `
varying vec3 vRest;
uniform vec3 uPatchC[${PATCHES.length}];
uniform vec3 uPatchR[${PATCHES.length}];

float cowHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cowNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(cowHash(i), cowHash(i + vec3(1, 0, 0)), f.x),
        mix(cowHash(i + vec3(0, 1, 0)), cowHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(cowHash(i + vec3(0, 0, 1)), cowHash(i + vec3(1, 0, 1)), f.x),
        mix(cowHash(i + vec3(0, 1, 1)), cowHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

vec3 cowCoat(vec3 p) {
  // ragged edges: a patch boundary is never a clean ellipse
  float warp = cowNoise(p * 6.0) * 0.55 + cowNoise(p * 15.0) * 0.28 + cowNoise(p * 37.0) * 0.12;
  float m = 1e3;
  for (int i = 0; i < ${PATCHES.length}; i++) {
    vec3 q = (p - uPatchC[i]) / uPatchR[i];
    m = min(m, length(q) - 1.0 + (warp - 0.47) * 0.95);
  }
  float aa = fwidth(m) + 0.004;
  float black = 1.0 - smoothstep(-aa, aa, m);
  // white socks, and a white blaze down the middle of the face
  black *= smoothstep(0.3, 0.42, p.y);
  float face = smoothstep(1.0, 1.06, p.z);
  black *= 1.0 - face * (1.0 - smoothstep(0.028, 0.05, abs(p.x))) * (1.0 - smoothstep(1.16, 1.2, p.y));

  vec3 white = vec3(0.94, 0.925, 0.89);
  vec3 ink = vec3(0.075, 0.065, 0.06);
  vec3 col = mix(white, ink, black);

  // bare skin: the muzzle and the udder are pink, and have no patches at all
  vec3 muzzleC = vec3(0.0, 0.975, 1.13);
  float muzzle = 1.0 - smoothstep(0.85, 1.0, length((p - muzzleC) / vec3(0.125, 0.095, 0.1)));
  muzzle *= smoothstep(1.07, 1.1, p.z);
  col = mix(col, vec3(0.76, 0.45, 0.45), muzzle);
  float udder = 1.0 - smoothstep(0.75, 1.0, length((p - vec3(0.0, 0.56, -0.4)) / vec3(0.16, 0.11, 0.18)));
  udder *= 1.0 - smoothstep(0.6, 0.66, p.y);
  col = mix(col, vec3(0.92, 0.7, 0.68), udder);

  // a little fur in it, so the white is not plastic
  col *= 0.93 + 0.07 * cowNoise(p * 140.0);
  return col;
}
`;

/**
 * The coat material: an ordinary lit, shadowed MeshStandardMaterial whose
 * colour is swapped for `cowCoat()` of the rest-pose position. The skinned
 * mesh's `position` attribute IS the rest pose, so no extra data is needed.
 */
export function coatMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPatchC = { value: PATCHES.map(([c]) => new THREE.Vector3(...c)) };
    shader.uniforms.uPatchR = { value: PATCHES.map(([, r]) => new THREE.Vector3(...r)) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COAT_GLSL}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = cowCoat(vRest);");
  };
  m.customProgramCacheKey = () => "cow-coat";
  return m;
}

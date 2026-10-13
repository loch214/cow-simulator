"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore, type Prompt } from "@/lib/store";
import { gags, kissAmount, KISS_BACK, SLAP_IMPACT } from "@/lib/reactions";
import { addPose, addPoses, samplePose, Pose, PartName, PART_NAMES, LEGS } from "@/lib/poses";
import {
  BACK_REST,
  BACK_RIG,
  FRONT_REST,
  FRONT_RIG,
  chewCycle,
  gallopPose,
  idlePose,
  quadWalk,
} from "@/lib/locomotion";
import { angleDelta, approach, cowState, turnToward } from "@/lib/cowState";
import { dancePose } from "@/lib/dance";
import { idleSeconds, moveAxis, onAction, onInteract, sprinting, startInput } from "@/lib/input";
import { addShake, cam, cameraGap, frameFront, lookForward } from "@/lib/camera";
import { cowPhysics, kickSpring, makeSpring, relaxPhysics, stepCowPhysics, stepSpring } from "@/lib/physics";
import { creak, step as footstep } from "@/lib/audio";
import { newRunner, stepCutscene, type CutsceneRunner } from "@/lib/cutscene";
import { loft, rng } from "@/lib/geometry";
import { wind } from "@/lib/sway";
import {
  coatMaterial,
  COW_BONES,
  HEAD_POS,
  HOOF_HEIGHT,
  JAW_POS,
  NECK_ROOT,
  onHead,
  scalpY,
} from "@/lib/cowBody";
import { bindSkin, snapshotRest } from "@/lib/sdf";
import { skinGeometry } from "@/lib/skinClient";
import { CowHand, SlapHand } from "./Hands";
import {
  BONK_SPEED,
  GALLOP_SPEED,
  GATE_POINT,
  GRASS,
  INTERACT_RANGE,
  OFFICER,
  POND,
  resolveFence,
  resolveSolids,
  SCARECROW,
  SPEED_LIMIT,
  SPEED_ZONE,
  STRIDE_RATE,
  TURN_SPEED,
  WALK_SPEED,
} from "@/lib/world";

// ---------------------------------------------------------------------------
// where every part sits when the cow is standing square and doing nothing
// ---------------------------------------------------------------------------

type Base = { pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] };

const ORIGIN: [number, number, number] = [0, 0, 0];
const UNIT: [number, number, number] = [1, 1, 1];
const HIDDEN: [number, number, number] = [0.001, 0.001, 0.001];

/**
 * Shoulder and hip pivots, taken from the rigs so the solver and the model can
 * never disagree about where a leg is attached. The lateral pair is mirrored.
 */
const FRONT_HIP: [number, number, number] = [FRONT_RIG.hipX, FRONT_RIG.hipY, FRONT_RIG.hipZ];
const BACK_HIP: [number, number, number] = [BACK_RIG.hipX, BACK_RIG.hipY, BACK_RIG.hipZ];

const part = (
  pos: [number, number, number],
  rot: [number, number, number] = ORIGIN,
  scale: [number, number, number] = UNIT
): Base => ({ pos, rot, scale });

/**
 * Which way the ears point: out, back, and drooping. Cows' ears hang; level
 * paddles read as a plane's wings from the front.
 *
 * An ear is a leaf built along +z, and the group's resting rotation is the ONLY
 * thing deciding which way it leaves the skull, so the Euler is SOLVED from the
 * direction rather than guessed. For order XYZ the local +z axis lands at
 * `(sin b, -cos b·sin a, cos b·cos a)`; taking `b` past a right angle (so the
 * ear sweeps back) gives `b = PI - asin(dx)` and `a = atan2(dy, -dz)`.
 */
const EAR_DIR = (() => {
  const d = [0.8, -0.48, -0.36];
  const l = Math.hypot(d[0], d[1], d[2]);
  return d.map((v) => v / l);
})();
const EAR_A = Math.atan2(EAR_DIR[1], -EAR_DIR[2]);
const EAR_B = Math.PI - Math.asin(EAR_DIR[0]);
const EAR_L: [number, number, number] = [EAR_A, -EAR_B, 0];
const EAR_R: [number, number, number] = [EAR_A, EAR_B, 0];

/**
 * Where the ears come out: found on the side of the skull rather than typed in,
 * then pushed a couple of centimetres back inside so the root of the leaf is
 * buried and never shows its edge.
 */
const EAR_X = onHead([0.4, 0.035, -0.06], [0, 0.035, -0.06]).p[0] - 0.026;

const BASE: Record<PartName, Base> = {
  body: part(ORIGIN),
  head: part(HEAD_POS),
  jaw: part(JAW_POS),
  // Rooted just inside the side of the skull, below the horns and behind the
  // eye — where a cow's ear actually comes out.
  earL: part([-EAR_X, 0.035, -0.06], EAR_L),
  earR: part([EAR_X, 0.035, -0.06], EAR_R),

  // Leg joints carry their standing angles as their resting rotation, so a pose
  // that says nothing about the legs leaves the cow standing square rather than
  // on four straight sticks.
  legFL: part([-FRONT_HIP[0], FRONT_HIP[1], FRONT_HIP[2]], [FRONT_REST.hip, 0, 0]),
  legFR: part([FRONT_HIP[0], FRONT_HIP[1], FRONT_HIP[2]], [FRONT_REST.hip, 0, 0]),
  legBL: part([-BACK_HIP[0], BACK_HIP[1], BACK_HIP[2]], [BACK_REST.hip, 0, 0]),
  legBR: part([BACK_HIP[0], BACK_HIP[1], BACK_HIP[2]], [BACK_REST.hip, 0, 0]),
  kneeFL: part([0, -FRONT_RIG.seg[0], 0], [FRONT_REST.knee, 0, 0]),
  kneeFR: part([0, -FRONT_RIG.seg[0], 0], [FRONT_REST.knee, 0, 0]),
  kneeBL: part([0, -BACK_RIG.seg[0], 0], [BACK_REST.knee, 0, 0]),
  kneeBR: part([0, -BACK_RIG.seg[0], 0], [BACK_REST.knee, 0, 0]),
  shinFL: part([0, -FRONT_RIG.seg[1], 0], [FRONT_REST.shin, 0, 0]),
  shinFR: part([0, -FRONT_RIG.seg[1], 0], [FRONT_REST.shin, 0, 0]),
  shinBL: part([0, -BACK_RIG.seg[1], 0], [BACK_REST.shin, 0, 0]),
  shinBR: part([0, -BACK_RIG.seg[1], 0], [BACK_REST.shin, 0, 0]),

  tail: part([0, 1.0, -0.7], [0.42, 0, 0]),
  tailTip: part([0, -0.3, 0]),
  blush: part(ORIGIN, ORIGIN, HIDDEN),
  brow: part(ORIGIN, ORIGIN, HIDDEN),

  // The hand sits exactly where the front-right hoof does — on the end of the
  // cannon — and is scaled to nothing until one pose asks for it. `aimFist`
  // overwrites its rotation every frame; only the position matters here.
  fist: part([0, -FRONT_RIG.seg[2], 0], ORIGIN, HIDDEN),
};

/** The neck bone's root, as a vector for the per-frame maths in `stretchNeck`. */
const NECK_BASE = new THREE.Vector3(...NECK_ROOT);

/** How far the muzzle sits ahead of the cow's own position, along its facing. */
const MUZZLE_Z = 0.37;
const HEAD_FORWARD = HEAD_POS[2] + MUZZLE_Z;
/**
 * How close the MUZZLE gets to the lens at the height of the kiss — `body.pos`
 * is offset by `HEAD_FORWARD`, which is the muzzle, not the poll. Small on
 * purpose: the gag only lands if the face genuinely fills the screen, and at
 * this range it covers about three-quarters of the frame height. The camera's
 * near plane is 0.12, so there is room to spare.
 */
const KISS_GAP = 0.34;

/** How long the gate takes to swing, in seconds. */
const GATE_SWING = 0.7;

// ---------------------------------------------------------------------------
// geometry — built once, on first use
// ---------------------------------------------------------------------------

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

// ---------------------------------------------------------------------------
// hair
//
// One lock, drawn a few dozen times. Real hair is out of the question here —
// this is a scene with fifteen thousand grass blades already — but a forelock
// made of a dozen separate tapered spikes catches light and moves as a clump,
// and that is the whole difference between a cow with hair and a cow with a
// sphere glued between its horns, which is what was there before.
// ---------------------------------------------------------------------------

/**
 * One lock, as a CURVE rather than a spike. It leaves the scalp along +z, holds
 * its thickness through the first half, then thins and falls away in -y, curling
 * harder the further out it goes — which is what hair does and what a straight
 * tapered cone never will.
 *
 * The drop is cubic in `t` on purpose: a lock that starts falling immediately
 * leaves the scalp on a chord and ends up inside the skull, because the top of a
 * cow's head is a dome. Staying level for the first third and then falling keeps
 * the whole strand outside the head while still reading as hair that hangs.
 */
const LOCK_LEN = 0.24;
const LOCK_DROP = 0.105;

function lockCurve(t: number) {
  return {
    // Only a slight sideways curl. Every lock shares it, so a big one combs the
    // whole fringe over to one side; which way a strand actually falls is set
    // per-lock by the roll in `clump`, and that one is mirrored left to right.
    x: 0.02 * t * t,
    y: -LOCK_DROP * t * t * t,
    z: LOCK_LEN * t,
    r: 0.03 * Math.pow(1 - t, 0.6) + 0.0015,
  };
}

/**
 * A slice of that curve, rebased so the piece starts at its own origin. The
 * fringe is built as two hinged links out of two slices — see `hairTip` below —
 * while the tail switch is one piece and takes the whole thing.
 */
function lockPiece(from: number, to: number, segs = 6): THREE.BufferGeometry {
  const base = lockCurve(from);
  const rings = Array.from({ length: segs + 1 }, (_, i) => {
    const c = lockCurve(from + ((to - from) * i) / segs);
    return { x: c.x - base.x, y: c.y - base.y, z: c.z - base.z, rx: c.r, ry: c.r * 0.74 };
  });
  return loft(rings, { radial: 8, segments: segs * 4 });
}

/** Where the fringe hinges: half way along, in the root piece's own space. */
const HAIR_HINGE: [number, number, number] = (() => {
  const a = lockCurve(0);
  const b = lockCurve(0.5);
  return [b.x - a.x, b.y - a.y, b.z - a.z];
})();

const lockGeo = once(() => lockPiece(0, 1, 7));
const lockRootGeo = once(() => lockPiece(0, 0.5, 4));
const lockTipGeo = once(() => lockPiece(0.5, 1, 5));

interface Lock {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
}

interface ClumpOptions {
  seed: number;
  count: number;
  /** Half the width of the row, across the head. */
  spread: number;
  /** Where along the skull the row is planted. */
  z: number;
  /** How far the strands tip out of level as they leave the scalp. */
  aim: number;
  /** Length, as a multiple of one lock. */
  drop: number;
  /** How far clear of the scalp the roots sit. */
  lift?: number;
  /**
   * How hard the outer strands roll over. A lock droops in its own -y, so
   * rolling it turns "hangs down the forehead" into "hangs down the side of the
   * head" — which is how the edge of the fringe gets round the dome instead of
   * straight through it.
   */
  roll?: number;
}

/**
 * Lay out a clump of locks along the scalp. Generated once from a fixed seed so
 * the fringe is the same fringe on every reload, the same way the grass is.
 */
function clump({ seed, count, spread, z, aim, drop, lift = 0.008, roll = 0.9 }: ClumpOptions): Lock[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const u = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const edge = Math.abs(u);
    const x = u * spread;
    // the outer strands start a little further back, so the clump has a rounded
    // hairline rather than sitting in one straight row
    const rz = z - edge * edge * 0.03;
    return {
      pos: [x, scalpY(x, rz) + lift, rz],
      rot: [
        // the further out, the more the strand has to lift to clear the dome
        aim - edge * 0.22 + (r() - 0.5) * 0.14,
        -u * 0.4 - (r() - 0.5) * 0.14,
        u * roll * (0.45 + edge * 0.8) + (r() - 0.5) * 0.22,
      ],
      // a lock the same size as its neighbour reads as a spike, not as hair
      scale: [0.8 + r() * 0.4, 0.85 + r() * 0.3, drop * (0.86 + r() * 0.3)],
    };
  });
}

/**
 * The fringe that hangs forward down the forehead, between the horns.
 *
 * `aim` is POSITIVE, i.e. the strands leave the scalp already tipping down the
 * face. That matters more than it looks: the forehead falls away towards the
 * nose faster than the hair does, so a fringe aimed level or up stands off the
 * skull as a crest of spikes instead of lying on it — which is exactly what
 * this looked like before, a punk fin rather than a forelock.
 */
const FORELOCK = clump({
  seed: 6161,
  count: 17,
  spread: 0.088,
  z: -0.028,
  aim: 0.3,
  drop: 1.05,
  roll: 0.8,
});
/** A shorter, fuller row behind it, lying back over the poll to give it body. */
const TOPKNOT = clump({
  seed: 6162,
  count: 10,
  spread: 0.062,
  z: -0.112,
  aim: -0.06,
  drop: 0.5,
  lift: 0.01,
  roll: 0.4,
});
/** The strands that get round the sides and hang beside the ears. */
const SIDELOCK = clump({
  seed: 6164,
  count: 6,
  spread: 0.105,
  z: -0.05,
  aim: 0.34,
  drop: 0.6,
  lift: 0.004,
  roll: 1.7,
});
/** Every clump on the head, drawn together so they move as one head of hair. */
const HAIR_CLUMPS: { tag: string; locks: Lock[]; shadow: boolean }[] = [
  { tag: "f", locks: FORELOCK, shadow: true },
  { tag: "t", locks: TOPKNOT, shadow: false },
  { tag: "s", locks: SIDELOCK, shadow: true },
];

/**
 * The switch on the end of the tail. Not laid out by `clump`: that plants roots
 * on a skull, and this grows out of the end of a tail. It is a fan instead, so
 * the strands spray out around the tip rather than all falling one way.
 */
/**
 * Everything that sits on the face, planted on it by ray casts against the
 * skull's own distance field (`onHead`). The face is a sculpted surface now, not
 * a table of rings, so nothing here can be typed in — a feature placed a
 * centimetre off a curved surface either floats or vanishes, and both have
 * happened to this cow.
 */
const FACE = (() => {
  const v = (p: number[]): [number, number, number] => [p[0], p[1], p[2]];
  const eyes = [-1, 1].map((s) => {
    const { p, n } = onHead([s * 0.4, 0.03, 0.3], [0, 0.03, 0.0]);
    return {
      // sunk so a little over half the eyeball stands proud: big, wet and
      // slightly bulging, which is most of what makes a cow look worried
      pos: v([p[0] - n[0] * 0.012, p[1] - n[1] * 0.012, p[2] - n[2] * 0.012]),
      rot: v([-Math.asin(n[1]), Math.atan2(n[0], n[2]), -s * 0.12]),
    };
  });
  const brows = [-1, 1].map((s) => {
    const { p, n } = onHead([s * 0.3, 0.078, 0.1], [0, 0.078, 0.02]);
    return v([p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004]);
  });
  const blush = [-1, 1].map((s) => {
    const { p, n } = onHead([s * 0.4, -0.045, 0.1], [0, -0.045, 0.1]);
    return v([p[0] - n[0] * 0.012, p[1], p[2]]);
  });
  const horns = [-1, 1].map((s) => v([s * 0.075, scalpY(s * 0.075, -0.05) - 0.03, -0.05]));
  const nostrilZ = onHead([0.05, -0.058, 0.6], [0.05, -0.058, 0]).p[2];
  return {
    eyes,
    brows,
    blush,
    horns,
    nostrils: v([0, -0.058, nostrilZ - 0.004]),
  };
})();

const SWITCH: Lock[] = (() => {
  const r = rng(6163);
  return Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * Math.PI * 2 + r() * 0.4;
    return {
      pos: [Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0] as [number, number, number],
      rot: [0.2 + r() * 0.3, Math.cos(a) * 0.32, a] as [number, number, number],
      scale: [0.7 + r() * 0.4, 0.7 + r() * 0.4, 0.5 + r() * 0.3] as [number, number, number],
    };
  });
})();

/**
 * A big soft leaf of an ear. Built along +z, flat in y, and swung out of the
 * side of the head by `EAR_L` / `EAR_R`. The first ring is buried in the skull
 * so the root never shows; the width peaks a third of the way along and the tip
 * rounds off rather than coming to a point, which is the difference between an
 * ear and a fin.
 */
const earGeo = once(() =>
  loft(
    [
      { z: -0.04, rx: 0.03, ry: 0.03 },
      { z: 0.02, rx: 0.058, ry: 0.036 },
      { z: 0.09, rx: 0.085, ry: 0.03 },
      { z: 0.17, rx: 0.079, ry: 0.023 },
      { z: 0.235, rx: 0.055, ry: 0.016 },
      { z: 0.275, rx: 0.02, ry: 0.008 },
    ],
    { radial: 14, segments: 24 }
  )
);

const earInnerGeo = once(() =>
  loft(
    [
      { z: 0.02, rx: 0.032, ry: 0.018 },
      { z: 0.095, rx: 0.055, ry: 0.016 },
      { z: 0.175, rx: 0.048, ry: 0.012 },
      { z: 0.235, rx: 0.02, ry: 0.007 },
    ],
    { radial: 12, segments: 16, caps: false }
  )
);

/** A short horn that curves out and then up. The x offsets are the curve. */
const hornGeo = once(() =>
  loft(
    [
      { z: 0, x: 0, y: 0, rx: 0.038, ry: 0.038 },
      { z: 0.03, x: 0.045, y: 0.014, rx: 0.034, ry: 0.034 },
      { z: 0.045, x: 0.092, y: 0.048, rx: 0.027, ry: 0.027 },
      { z: 0.04, x: 0.122, y: 0.105, rx: 0.017, ry: 0.017 },
      { z: 0.03, x: 0.128, y: 0.15, rx: 0.005, ry: 0.005 },
    ],
    { radial: 12, segments: 22 }
  )
);

/**
 * One half of a cloven hoof, built from the coronet DOWN — `z` here is distance
 * below the top of the hoof, because the leg solver puts the end of the chain on
 * the ground and the hoof has to stand on that point rather than hang under it.
 * Get this backwards and the cow walks with its feet buried.
 */
const toeGeo = once(() =>
  loft(
    [
      { z: 0, y: 0, rx: 0.026, ry: 0.038 },
      { z: 0.035, y: 0.004, rx: 0.031, ry: 0.045 },
      { z: 0.07, y: 0.008, rx: 0.032, ry: 0.048 },
      // The coronet is wide enough to meet the pastern coming down into it,
      // rather than stopping short and leaving the hoof sitting on a peg.
      { z: HOOF_HEIGHT, y: 0.006, rx: 0.031, ry: 0.046 },
      { z: HOOF_HEIGHT + 0.022, y: 0.004, rx: 0.024, ry: 0.036 },
    ],
    { radial: 14, segments: 18 }
  )
);

const tailGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.058, ry: 0.062 },
      { z: 0.09, rx: 0.042, ry: 0.044 },
      { z: 0.2, rx: 0.031, ry: 0.031 },
      { z: 0.3, rx: 0.024, ry: 0.024 },
    ],
    { radial: 10, segments: 14 }
  )
);

const tailTipGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.022, ry: 0.022 },
      { z: 0.16, rx: 0.017, ry: 0.017 },
      { z: 0.26, rx: 0.014, ry: 0.014 },
    ],
    { radial: 10, segments: 10 }
  )
);

/** The black switch of hair on the end of the tail. */
const switchGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.016, ry: 0.016 },
      { z: 0.05, rx: 0.045, ry: 0.045 },
      { z: 0.13, rx: 0.042, ry: 0.042 },
      { z: 0.2, rx: 0.012, ry: 0.012 },
    ],
    { radial: 12, segments: 14 }
  )
);

/** The tongue: a soft, flat, slightly cupped strip, built along +z. */
const tongueGeo = once(() =>
  loft(
    [
      { z: -0.02, y: 0, rx: 0.02, ry: 0.008 },
      { z: 0.04, y: -0.01, rx: 0.03, ry: 0.011 },
      { z: 0.09, y: -0.03, rx: 0.034, ry: 0.011 },
      { z: 0.13, y: -0.06, rx: 0.028, ry: 0.01 },
      { z: 0.155, y: -0.08, rx: 0.012, ry: 0.007 },
    ],
    { radial: 12, segments: 16 }
  )
);

/** A five-pointed cartoon star, for after a collision. */
const starGeo = once(() => {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.018 : 0.042;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  g.center();
  return g;
});
const STARS = [0, 1, 2, 3].map((i) => (i / 4) * Math.PI * 2);

/** Upper lid angles, wide open and fully shut. */
const LID_OPEN = -0.95;
const LID_SHUT = 1.5;

const eyeGeo = once(() => new THREE.SphereGeometry(0.035, 20, 16));
const lidGeo = once(
  () => new THREE.SphereGeometry(0.039, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
);
// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

function useCowMaterials() {
  return useMemo(() => {
    return {
      // The coat: one material for the whole skin, painted in the shader from
      // where each pixel sits on the cow at rest. See `coatMaterial`.
      coat: coatMaterial(),
      // Matched to the white and the black of the coat, for the few loose
      // parts that sit on one or the other: eyelids, the tail, the ears.
      pale: new THREE.MeshStandardMaterial({ color: "#efeae0", roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1d1917", roughness: 0.78 }),
      ink: new THREE.MeshStandardMaterial({ color: "#16110e", roughness: 0.7 }),
      // Hair, as opposed to coat: warmer and lighter than the black of the hide
      // on purpose, because the poll it grows out of is one of the black
      // patches and true black hair on it disappears completely.
      hair: new THREE.MeshStandardMaterial({ color: "#4a382b", roughness: 0.96 }),
      // The teats and the inner ear are bare skin — pinker, and shinier than
      // hair, which is a surprisingly large part of looking like an animal.
      skin: new THREE.MeshStandardMaterial({ color: "#d99a9d", roughness: 0.55 }),
      nostril: new THREE.MeshStandardMaterial({ color: "#5a3036", roughness: 0.5 }),
      horn: new THREE.MeshStandardMaterial({ color: "#d8ccb2", roughness: 0.45 }),
      hoof: new THREE.MeshStandardMaterial({ color: "#2e2823", roughness: 0.42 }),
      eye: new THREE.MeshStandardMaterial({ color: "#120a05", roughness: 0.08 }),
      sclera: new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.25 }),
      tongue: new THREE.MeshStandardMaterial({ color: "#e0768a", roughness: 0.35 }),
      star: new THREE.MeshStandardMaterial({
        color: "#ffd84a",
        emissive: "#ffb800",
        emissiveIntensity: 0.6,
        roughness: 0.4,
      }),
      blush: new THREE.MeshStandardMaterial({
        color: "#ef6f8c",
        transparent: true,
        opacity: 0.8,
        roughness: 0.7,
      }),
      breath: new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    };
  }, []);
}

type Mats = ReturnType<typeof useCowMaterials>;

// ---------------------------------------------------------------------------
// the component
// ---------------------------------------------------------------------------

/** The cow's animated nodes, keyed by the `name` given to each group. */
type Nodes = Partial<Record<string, THREE.Object3D>>;

function applyPart(obj: THREE.Object3D | undefined, base: Base, delta?: Pose[PartName]) {
  if (!obj) return;
  const dp = delta?.pos ?? ORIGIN;
  const dr = delta?.rot ?? ORIGIN;
  const ds = delta?.scale ?? ORIGIN;
  obj.position.set(base.pos[0] + dp[0], base.pos[1] + dp[1], base.pos[2] + dp[2]);
  obj.rotation.set(base.rot[0] + dr[0], base.rot[1] + dr[1], base.rot[2] + dr[2]);
  obj.scale.set(base.scale[0] + ds[0], base.scale[1] + ds[1], base.scale[2] + ds[2]);
}

export default function Cow() {
  const mats = useCowMaterials();

  // pivot = where the cow is in the world and which way it's facing.
  // root = the same cow, but only ever moved by pose deltas.
  const pivotRef = useRef<THREE.Group>(null);

  /**
   * The animated nodes, looked up once by name off the object graph.
   *
   * Twenty-one refs and twenty-one hand-written apply lines is exactly the kind
   * of boilerplate that quietly stops being updated when a body part is added,
   * so instead each group is tagged with its pose name in the JSX below and
   * found here on the first frame. Adding a part is now one line in `BASE` and
   * one `name=` in the model.
   */
  const nodes = useRef<Partial<Record<string, THREE.Object3D>>>({});

  const neckRef = useRef<THREE.Group>(null);
  const nostrilRef = useRef<THREE.Group>(null);
  const breathRef = useRef<THREE.Mesh>(null);

  /**
   * How far into the title-card dance the cow is: 0 on all fours, 1 up on its
   * hind legs and going for it. Rises while the splash is up and falls once the
   * player taps through, so the cow settles back down onto four feet instead of
   * snapping there.
   */
  const danceK = useRef(0);

  const activeGag = useCowStore((s) => s.activeGag);
  const gagStartedAt = useCowStore((s) => s.gagStartedAt);
  const inCutscene = useCowStore((s) => s.inCutscene);
  const grassEatenAt = useCowStore((s) => s.grassEatenAt);

  /**
   * The forelock, as two springs. Hair is not a bone and has no business on the
   * pose stack, so it is driven straight off the wind clock and off whatever the
   * head is doing — which means a slap throws the fringe as well as the skull.
   */
  const hairSpring = useMemo(
    () => ({
      lean: makeSpring(58, 5.2),
      back: makeSpring(58, 5.2),
      // The ends of the strands are softer and slower than the roots — that lag
      // between the two is the whole reason the fringe is hinged at all.
      tipBend: makeSpring(26, 3.4),
      tipSwing: makeSpring(26, 3.4),
    }),
    []
  );
  /** The outer link of every lock, found once in the first-frame node scan. */
  const hairTipsRef = useRef<THREE.Object3D[]>([]);

  const runnerRef = useRef<CutsceneRunner | null>(null);
  // `inCutscene` in the frame callback is a frame or two stale after we end the
  // scene, so latch it here — otherwise the cutscene restarts itself.
  const endedRef = useRef(false);
  const blinkRef = useRef({ next: 2, closing: 0 });

  const scratch = useMemo(
    () => ({
      up: new THREE.Vector3(0, 1, 0),
      dir: new THREE.Vector3(),
      target: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      euler: new THREE.Euler(),
    }),
    []
  );

  useEffect(() => {
    if (inCutscene) {
      runnerRef.current = newRunner(useCowStore.getState().tickets.length);
      endedRef.current = false;
      relaxPhysics(); // start the walk to the station from a settled body
    } else {
      runnerRef.current = null;
    }
  }, [inCutscene]);

  useEffect(() => {
    const stopKeys = startInput();
    const stopInteract = onInteract(() => useCowStore.getState().interact());
    const stopAction = onAction((action) => {
      const store = useCowStore.getState();
      // Spelled out, not `pet ? shy : slap`: that version sent the Dance key
      // to the slap, so pressing R hit the cow.
      if (action === "pet") store.triggerGag("shy");
      else if (action === "slap") store.triggerGag("slap");
      else store.toggleDance();
    });
    return () => {
      stopKeys();
      stopInteract();
      stopAction();
    };
  }, []);

  /**
   * The neck is not a bone in the pose stack — it is drawn between the chest and
   * wherever the head has ended up, every frame. That way it can never come away
   * from the skull, whatever a gag or a spring does to the head, and grazing
   * genuinely reaches down instead of the head detaching and floating off.
   */
  function stretchNeck(node: Nodes) {
    const neck = neckRef.current;
    const head = node.head;
    if (!neck || !head) return;

    // aim a little way *inside* the skull, so the join is always covered
    scratch.offset.set(0, 0, 0.07).applyEuler(head.rotation);
    scratch.target.copy(head.position).add(scratch.offset);
    scratch.dir.copy(scratch.target).sub(NECK_BASE);
    const len = Math.max(0.2, scratch.dir.length());
    neck.quaternion.setFromUnitVectors(scratch.up, scratch.dir.normalize());
    neck.scale.set(1, len, 1);
  }

  /**
   * Put the rig in its rest pose and bind the one-piece skin to it.
   *
   * The skin was meshed around the cow standing square (lib/cowBody.ts), so
   * the bones have to be standing square too at the moment of binding — every
   * later movement of a bone is measured from here. Runs once, on the first
   * frame, before any pose has been applied.
   */
  function bindCowSkin(pivot: THREE.Object3D, node: Nodes) {
    for (const name of PART_NAMES) applyPart(node[name], BASE[name]);
    stretchNeck(node);
    levelHooves(node, {});
    const bones = COW_BONES.map((n) => (n === "neck" ? neckRef.current : node[n]));
    if (bones.some((b) => !b)) {
      console.error("cow skin: missing bone", COW_BONES.filter((_, i) => !bones[i]));
      return;
    }
    const rest = snapshotRest(pivot, bones as THREE.Object3D[]);
    // The skin is meshed in a worker and arrives a moment later. Until it
    // does, the cow is hidden: its eyes, horns and hooves on their own would
    // be a much stranger sight than an empty pen.
    pivot.visible = false;
    void skinGeometry({ kind: "cow" }).then(([skin, jaw]) => {
      bindSkin(skin, mats.coat, pivot, rest);
      bindSkin(jaw, mats.coat, pivot, rest);
      pivot.visible = true;
    });
  }

  /**
   * Keep the hooves flat on the ground. The chain above them is already solved,
   * so the hoof just has to undo everything its parents did — which is also what
   * makes the rear-up land flat-footed instead of on tiptoe.
   */
  function levelHooves(node: Nodes, pose: Pose) {
    const bodyPitch = BASE.body.rot[0] + (pose.body?.rot?.[0] ?? 0);
    LEGS.forEach((leg, i) => {
      const hoof = node[`hoof${i}`];
      if (!hoof) return;
      const chain =
        BASE[leg.hip].rot[0] + (pose[leg.hip]?.rot?.[0] ?? 0) +
        BASE[leg.knee].rot[0] + (pose[leg.knee]?.rot?.[0] ?? 0) +
        BASE[leg.shin].rot[0] + (pose[leg.shin]?.rot?.[0] ?? 0);
      hoof.rotation.x = Math.max(-1.1, Math.min(1.1, -(chain + bodyPitch)));
    });
  }

  /**
   * The hand on the end of the front-right leg.
   *
   * It is only ever out for one pose, so the first job is to swap it for the
   * hoof and back. The second is the interesting one: the arm it is attached to
   * is a three-link chain at whatever angles the pose left it, and a hand that
   * inherits all of that points its middle finger somewhere off into the field.
   * So the fist cancels its own parents — exactly the trick `levelHooves` uses
   * to keep a hoof flat — and the finger comes out vertical no matter what the
   * arm is doing. The back of the hand then faces wherever the cow is facing,
   * and the cow has already turned to face you.
   */
  function aimFist(node: Nodes, pose: Pose) {
    const fist = node.fist;
    const hoof = node.hoof1; // the front-right hoof; see the CowLeg order below
    if (!fist) return;
    // Half, not "any": the hand replaces the hoof outright, so the cut has to
    // land at the top of the arm's swing rather than the moment the pose starts
    // growing it. `ARM_UP` in lib/reactions.ts is the keyframe that buys the
    // time for that.
    const out = pose.fist?.scale?.[0] ?? 0;
    fist.visible = out > 0.5;
    if (hoof) hoof.visible = !fist.visible;
    if (!fist.visible) return;

    const chain =
      BASE.legFR.rot[0] + (pose.legFR?.rot?.[0] ?? 0) +
      BASE.kneeFR.rot[0] + (pose.kneeFR?.rot?.[0] ?? 0) +
      BASE.shinFR.rot[0] + (pose.shinFR?.rot?.[0] ?? 0) +
      BASE.body.rot[0] + (pose.body?.rot?.[0] ?? 0);
    const roll =
      BASE.legFR.rot[2] + (pose.legFR?.rot?.[2] ?? 0) +
      BASE.body.rot[2] + (pose.body?.rot?.[2] ?? 0);
    // a few degrees off vertical, tipped back towards the camera — dead upright
    // reads as a diagram, and this is not a diagram
    fist.rotation.set(-chain + 0.16, 0, -roll - 0.12);
  }

  /**
   * The forelock. The gust term is the same one the grass shader computes, read
   * from the same clock and sampled at the cow's own position, so the fringe
   * lifts on the same breath of wind as the field it is standing in.
   */
  function swayHair(node: Nodes, dt: number) {
    const hair = node.hair;
    if (!hair) return;
    const t = wind.value;
    const gust =
      Math.sin(t * 1.5 + cowState.x * 0.35 + cowState.z * 0.28) +
      0.45 * Math.sin(t * 3.1 + cowState.x * 1.1) +
      0.25 * Math.sin(t * 5.3 + cowState.z * 1.7);

    // Hair is dead weight on the end of a head: it goes where the head has just
    // been, not where it is. Taking the head springs' VELOCITY rather than their
    // value is what makes the fringe fly on a slap and settle after it.
    const whip = Math.max(-6, Math.min(6, cowPhysics.headYaw.vel));
    const nod = Math.max(-6, Math.min(6, cowPhysics.headPitch.vel));

    const lean = stepSpring(
      hairSpring.lean,
      gust * 0.13 - whip * 0.045 - Math.max(-4, Math.min(4, cowState.turnRate)) * 0.035,
      dt
    );
    // The whole clump can only ever lift off the head, never press into it: the
    // roots sit a few millimetres above the skull and there is nothing below
    // them but skull. Anything that pushes the fringe down goes into the TIPS,
    // which hang out past the brow with air underneath them.
    const back = Math.min(
      0.05,
      stepSpring(hairSpring.back, gust * 0.05 - Math.min(0.5, cowState.speed * 0.17) - nod * 0.02, dt)
    );
    hair.rotation.set(back, lean * 0.35, lean);

    // The tips, hanging on behind the roots. `bend` is gravity plus whatever the
    // head just did to them; `swing` is the sideways flick that goes with a
    // whipped head. Both are clamped so a hard slap throws the hair without
    // folding it back through the forehead.
    const bend = Math.max(
      -0.75,
      Math.min(0.55, stepSpring(hairSpring.tipBend, 0.16 + gust * 0.1 - nod * 0.055, dt))
    );
    const swing = Math.max(
      -0.6,
      Math.min(0.6, stepSpring(hairSpring.tipSwing, gust * 0.12 - whip * 0.075, dt))
    );
    const tips = hairTipsRef.current;
    for (let i = 0; i < tips.length; i++) {
      // A per-strand offset, so the clump frays as it moves rather than swinging
      // as one solid flap. Cheap, and it is most of what sells it as hair.
      const jitter = Math.sin(t * 2.3 + i * 1.9) * 0.055;
      tips[i].rotation.set(bend + jitter, swing * 0.5, swing + jitter * 0.6);
    }
  }

  /** Blinks: irregular on their own, and forced shut by a fresh slap. */
  function blink(node: Nodes, dt: number) {
    const b = blinkRef.current;
    b.next -= dt;
    if (b.next <= 0) {
      b.closing = 1;
      b.next = 2.4 + Math.random() * 4.5;
    }
    b.closing = Math.max(0, b.closing - dt * 7);
    // a hard blink, then a lingering squint while it is still cross
    const shut = Math.min(1, Math.sin(Math.min(1, b.closing) * Math.PI) * 1.6);
    const squint = cowState.anger * 0.45;
    const k = Math.max(shut, squint);
    for (let i = 0; i < 2; i++) {
      const lid = node[`lid${i}`];
      if (lid) lid.rotation.x = LID_OPEN + k * (LID_SHUT - LID_OPEN);
    }
  }

  /** Nostrils flare and the cow snorts visibly when it is furious. */
  function breathe(now: number) {
    const anger = cowState.anger;
    if (nostrilRef.current) {
      const flare = 1 + anger * 0.22 * (0.6 + 0.4 * Math.sin(now * (2 + anger * 4)));
      nostrilRef.current.scale.set(flare, flare, 1);
    }
    if (breathRef.current) {
      // one puff per angry breath, drifting out and fading
      const cycle = (now * (0.9 + anger * 0.7)) % 1;
      const strength = Math.max(0, anger - 0.25) * 1.35;
      const m = breathRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = strength * Math.max(0, 1 - cycle) * 0.3;
      const s = 0.5 + cycle * 2.4;
      breathRef.current.scale.set(s, s, s);
      breathRef.current.position.z = 0.43 + cycle * 0.32;
      breathRef.current.position.y = -0.08 - cycle * 0.06;
    }
  }

  useFrame((state, delta) => {
    const root = pivotRef.current;
    if (!root) return;
    if (nodes.current.body === undefined) {
      const found: Partial<Record<string, THREE.Object3D>> = {};
      const tips: THREE.Object3D[] = [];
      root.traverse((obj) => {
        if (!obj.name) return;
        found[obj.name] = obj;
        if (obj.name.startsWith("hairTip")) tips.push(obj);
      });
      nodes.current = found;
      hairTipsRef.current = tips;
      bindCowSkin(root, found);
    }
    const node = nodes.current;

    const dt = Math.min(delta, 0.05); // a long stall shouldn't teleport the cow
    const wasFacing = cowState.facing;
    const now = state.clock.elapsedTime;
    let pose: Pose;
    let chewing = 0;

    // The dance. Two things ask for it — the title card, which owns the cow
    // completely, and the Dance button — and both get the same routine out of
    // lib/dance.ts rather than a keyframe track. It is checked BEFORE the
    // generic gag branch below, because `gags.dance` deliberately has no
    // keyframes worth sampling.
    const started = useCowStore.getState().started;
    const dancing = !started || activeGag === "dance";
    danceK.current = approach(danceK.current, dancing ? 1 : 0, dt / (dancing ? 1.2 : 0.8));
    if (dancing) {
      cowState.speed = 0;
      cowState.stand = danceK.current;
      pose = dancePose(now, dt, danceK.current);
    } else if (inCutscene && runnerRef.current) {
      const result = stepCutscene(runnerRef.current, dt);
      if (result.say !== undefined) {
        useCowStore.getState().say(result.say, result.speaker);
      }
      if (result.sound === "creak") creak();
      pose = result.pose;
      if (result.finished && !endedRef.current) {
        endedRef.current = true;
        useCowStore.getState().endCutscene();
      }
    } else if (activeGag) {
      // A reaction owns the whole body; the cow plants its feet until it's done.
      cowState.speed = 0;
      const gag = gags[activeGag];
      const elapsed = Math.min(performance.now() - gagStartedAt, gag.duration);
      pose = samplePose(gag.keyframes, elapsed);
      // Grazing is a grind, not a nibble: the jaw works the whole time the
      // head is down, and keeps going for a moment after it comes back up.
      if (activeGag === "eat") chewing = elapsed > 250 ? 1 : 0;
      // A middle finger has to be pointed at somebody. Once the cow has finished
      // recoiling it squares up with the lens — the same trick the kiss uses,
      // and for the same reason: without it the whole gag plays to the back of
      // the cow's own head whenever you happen to be standing behind it.
      if (activeGag === "slap" && elapsed < 2300) {
        // The camera does most of the work: it swings round to the front of the
        // cow so you actually watch the reaction land instead of watching its
        // backside. The cow still turns into the lens, but slowly — with the
        // camera also moving, a fast turn here spins the whole shot.
        //
        // The two chase each other, and that is deliberate: the camera aims at
        // the cow's heading while the cow aims at the camera's, so the gap
        // closes from both ends and they meet nose to lens in well under a
        // second from any starting angle.
        frameFront(cowState.facing, dt);
        if (elapsed > SLAP_IMPACT + 190) {
          cowState.facing = turnToward(cowState.facing, cam.yaw, 2.2 * dt);
        }
      }
      // The pet gag ends by launching the cow at the camera, and how far that is
      // depends on where the camera happens to be — so it can't be keyframed.
      if (activeGag === "shy") pose = addPose(pose, kissLunge(elapsed, dt));
    } else {
      pose = drive(dt, now, grassEatenAt);
    }

    // Still coming down off the dance — off the title card, off the Dance
    // button, or off a slap that interrupted one. `dancePose` fades to nothing
    // on its own, so adding it here just lowers the cow back onto four feet
    // instead of dropping it. It sits OUTSIDE the branch above because a gag
    // can interrupt the dance, and a cow that snaps from upright to all fours
    // on the frame the hand arrives has no weight at all.
    //
    // Not during the cutscene: that owns `cowState.stand` itself, and it rears
    // the cow up rather than letting it down.
    if (!dancing && !inCutscene && danceK.current > 0.001) {
      cowState.stand = danceK.current;
      pose = addPose(pose, dancePose(now, dt, danceK.current));
    }

    // The gate. The cutscene drives the panel itself while it is running — it
    // lets itself out — so this only chases the player's switch the rest of the
    // time, otherwise the two fight over the same number.
    if (!inCutscene) {
      cowState.gateOpen = approach(
        cowState.gateOpen,
        useCowStore.getState().gateOpen ? 1 : 0,
        dt / GATE_SWING
      );
    }

    // How fast the cow is turning drives the head lag, the lean and the tail.
    cowState.turnRate = angleDelta(wasFacing, cowState.facing) / Math.max(dt, 0.0001);

    // One shared stride clock, so the legs never jump when a gag ends mid-step.
    const lastPhase = cowState.walkPhase;
    cowState.walkPhase += dt * cowState.speed * STRIDE_RATE;
    // Diagonal pairs land together, so there are two hoofbeats per stride.
    if (Math.floor(lastPhase / Math.PI) !== Math.floor(cowState.walkPhase / Math.PI)) {
      footstep();
    }

    if (chewing > 0) {
      pose = addPose(pose, { jaw: { rot: [chewCycle(now * 7.5) * 0.16, 0, 0] } });
    }

    // Springs go on top of whatever ran above, in every mode — a slap landed
    // during a gag still has to wobble its way out afterwards.
    pose = addPose(pose, stepCowPhysics(dt));

    if (pivotRef.current) {
      pivotRef.current.position.set(cowState.x, 0, cowState.z);
      pivotRef.current.rotation.y = cowState.facing;
    }

    for (const name of PART_NAMES) {
      applyPart(node[name], BASE[name], pose[name]);
    }

    stretchNeck(node);
    levelHooves(node, pose);
    aimFist(node, pose);
    swayHair(node, dt);
    blink(node, dt);
    breathe(now);
    tongueAndStars(node, now);
  });

  /** The tongue out at a gallop, and the stars after a bonk. */
  function tongueAndStars(node: Nodes, now: number) {
    const dazed = activeGag === "bonk";
    const tongue = node.tongue;
    if (tongue) {
      const k = dazed ? 1 : gallopAmount();
      const out = Math.max(0.001, k);
      tongue.scale.set(out, out, out);
      tongue.visible = k > 0.02;
      // flapping in the wind, or hanging limp
      const flap = dazed ? 0.15 : 1;
      tongue.rotation.set(
        0.35 + Math.sin(now * 15) * 0.3 * flap,
        1.15 + Math.sin(now * 9.5) * 0.22 * flap,
        Math.sin(now * 19) * 0.35 * flap
      );
    }
    const stars = node.stars;
    if (stars) {
      stars.visible = dazed;
      if (dazed) {
        stars.rotation.y = now * 4.5;
        stars.position.y = 0.3 + Math.sin(now * 6) * 0.015;
        stars.children.forEach((c, i) => {
          c.rotation.set(0, -now * 4.5 + i, Math.sin(now * 8 + i) * 0.4);
        });
      }
    }
  }

  return (
    <>
      <group ref={pivotRef}>
      <group name="body">
        {/* The body, neck, head and legs are ONE skinned mesh now, built from
            lib/cowBody.ts and bound to the groups below on the first frame —
            see `bindCowSkin`. What is left in this tree is the skeleton itself,
            plus the parts a real cow also has as separate pieces: eyes, ears,
            horns, hair, hooves, teats and a tail. */}

        {/* teats, under the udder the skin already has */}
        <group position={[0, 0.6, -0.4]}>
          {[-0.072, 0.072].map((x) =>
            [-0.08, 0.06].map((z) => (
              <mesh
                key={`${x}${z}`}
                position={[x, -0.14, z]}
                rotation={[0, 0, x * 1.2]}
                material={mats.skin}
              >
                <cylinderGeometry args={[0.017, 0.012, 0.06, 8]} />
              </mesh>
            ))
          )}
        </group>

        {/* Neck: an empty bone, aimed and stretched every frame by stretchNeck(). */}
        <group ref={neckRef} position={NECK_ROOT} />

        <group name="head" position={HEAD_POS}>
          {/* Nostrils: dark, sitting in the dents the skin already has, and they
              flare when the cow is cross. */}
          <group ref={nostrilRef} position={FACE.nostrils}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.05, 0, 0]}
                rotation={[0, s * 0.5, s * 0.45]}
                scale={[0.8, 1.35, 0.6]}
                material={mats.nostril}
              >
                <sphereGeometry args={[0.017, 10, 8]} />
              </mesh>
            ))}
          </group>
          <mesh ref={breathRef} position={[0, -0.1, 0.42]} material={mats.breath}>
            <sphereGeometry args={[0.07, 8, 8]} />
          </mesh>

          {/* The lower jaw is its own piece of skin (the mouth has to open), so
              this is just its hinge — and where the tongue lives. */}
          <group name="jaw" position={BASE.jaw.pos}>
            {/* Out of the side of the mouth at a gallop, flapping, and lolling
                out when the cow has run into something. Nothing says "this
                animal is not in control" like a tongue in the wind. */}
            <group name="tongue" position={[0.035, -0.07, 0.17]} scale={HIDDEN}>
              <mesh geometry={tongueGeo()} material={mats.tongue} castShadow />
            </group>
          </group>
          {/* seeing stars */}
          <group name="stars" position={[0, 0.3, -0.02]} visible={false}>
            {STARS.map((a, i) => (
              <mesh
                key={i}
                geometry={starGeo()}
                material={mats.star}
                position={[Math.cos(a) * 0.2, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.2]}
              />
            ))}
          </group>

          {/* Eyes sit out on the sides of the head, the way a prey animal's do,
              planted ON the skin by a ray cast against the same field the skull
              was meshed from — never by eye. */}
          {FACE.eyes.map((e, i) => (
            <group key={i} position={e.pos} rotation={e.rot}>
              {/* A rim of white round a big dark iris. Real cows show almost
                  none, but a sliver of white is what lets an eye look worried,
                  shifty or appalled — and this cow is all three. */}
              <mesh geometry={eyeGeo()} material={mats.sclera} scale={[1, 1.1, 0.9]} />
              <mesh geometry={eyeGeo()} material={mats.eye} position={[0, 0, 0.011]} scale={[0.74, 0.84, 0.66]} />
              {/* catchlight: a dead eye is the fastest way to kill an animal */}
              <mesh position={[0.009, 0.013, 0.037]}>
                <sphereGeometry args={[0.006, 8, 8]} />
                <meshBasicMaterial color="#f4f8ff" />
              </mesh>
              <group name={`lid${i}`} rotation={[LID_OPEN, 0, 0]}>
                <mesh geometry={lidGeo()} material={i === 0 ? mats.pale : mats.dark} position={[0, 0, -0.002]} />
              </group>
              {/* lower lid, so the eye sits in a socket rather than on the surface */}
              <mesh
                geometry={lidGeo()}
                material={i === 0 ? mats.pale : mats.dark}
                position={[0, 0, -0.002]}
                rotation={[Math.PI + 0.5, 0, 0]}
              />
            </group>
          ))}

          {/* angry brows — scaled to nothing until the cow has something to glare about */}
          <group name="brow" position={BASE.brow.pos} scale={BASE.brow.scale}>
            {FACE.brows.map((b, i) => (
              <mesh
                key={i}
                position={b}
                rotation={[0.15, (i ? 1 : -1) * 0.5, (i ? -1 : 1) * 0.5]}
                scale={[0.9, 0.36, 0.5]}
                material={mats.ink}
              >
                <sphereGeometry args={[0.055, 12, 8]} />
              </mesh>
            ))}
          </group>

          {/* The inner ear faces DOWN in the ear's own frame, because the leaf
              is built flat in x/z and the resting rotation lays it out level:
              -y is the underside, which is the side you can see. */}
          {(["earL", "earR"] as const).map((ear) => (
            <group key={ear} name={ear} position={BASE[ear].pos} rotation={BASE[ear].rot}>
              <group scale={0.82}>
                <mesh geometry={earGeo()} material={mats.dark} castShadow />
                <mesh geometry={earInnerGeo()} material={mats.skin} position={[0, -0.008, 0]} />
              </group>
            </group>
          ))}

          {FACE.horns.map((pos, i) => (
            <mesh
              key={i}
              geometry={hornGeo()}
              material={mats.horn}
              position={pos}
              scale={[i ? 1 : -1, 1, 1]}
              castShadow
            />
          ))}
          {/* Every root here is planted ON the skull by `scalpY`, so the group
              itself sits at the head's own origin and each lock brings its own
              position. Each one is TWO links hinged half way along; the tip
              link is sprung in `swayHair`, which is what makes the fringe fall
              and settle instead of standing off the head like wire. */}
          <group name="hair">
            {HAIR_CLUMPS.map(({ tag, locks, shadow }) =>
              locks.map((l, i) => (
                <group key={tag + i} position={l.pos} rotation={l.rot} scale={l.scale}>
                  <mesh geometry={lockRootGeo()} material={mats.hair} castShadow={shadow} />
                  <group name={`hairTip${tag}${i}`} position={HAIR_HINGE}>
                    <mesh geometry={lockTipGeo()} material={mats.hair} castShadow={shadow} />
                  </group>
                </group>
              ))
            )}
          </group>

          <group name="blush" position={BASE.blush.pos} scale={BASE.blush.scale}>
            {FACE.blush.map((pos, i) => (
              <mesh key={i} position={pos} scale={[1, 0.7, 0.5]} material={mats.blush}>
                <sphereGeometry args={[0.05, 12, 8]} />
              </mesh>
            ))}
          </group>
        </group>

        <CowLeg mats={mats} front hipName="legFL" kneeName="kneeFL" shinName="shinFL" hoofName="hoof0" />
        {/* the front-right leg is the one that carries the hand */}
        <CowLeg
          mats={mats}
          front
          mirror
          hand
          hipName="legFR"
          kneeName="kneeFR"
          shinName="shinFR"
          hoofName="hoof1"
        />
        <CowLeg mats={mats} hipName="legBL" kneeName="kneeBL" shinName="shinBL" hoofName="hoof2" />
        <CowLeg mats={mats} mirror hipName="legBR" kneeName="kneeBR" shinName="shinBR" hoofName="hoof3" />

        <group name="tail" position={BASE.tail.pos} rotation={BASE.tail.rot}>
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh geometry={tailGeo()} material={mats.pale} castShadow />
          </group>
          <group name="tailTip" position={BASE.tailTip.pos}>
            <group rotation={[Math.PI / 2, 0, 0]}>
              <mesh geometry={tailTipGeo()} material={mats.pale} />
              <mesh geometry={switchGeo()} material={mats.hair} position={[0, 0, 0.24]} castShadow />
              {/* loose strands off the switch, so it frays instead of just ending */}
              {SWITCH.map((l, i) => (
                <group
                  key={i}
                  position={[l.pos[0], l.pos[1], 0.28]}
                  rotation={l.rot}
                  scale={l.scale}
                >
                  <mesh geometry={lockGeo()} material={mats.hair} />
                </group>
              ))}
            </group>
          </group>
        </group>
      </group>
      </group>
      {/* Not inside the pivot: it is not part of the cow, it is the thing that
          hits the cow, and it does its own aiming in world space. */}
      <SlapHand />
    </>
  );
}

/**
 * One leg: hip, knee and cannon, each hanging off the last, plus a cloven hoof
 * that is kept level with the ground by `levelHooves`. The groups are empty
 * pivots — all the rotation comes from the pose stack.
 */
function CowLeg({
  mats,
  front = false,
  mirror = false,
  hand = false,
  hipName,
  kneeName,
  shinName,
  hoofName,
}: {
  mats: Mats;
  front?: boolean;
  mirror?: boolean;
  /** Hangs the hand off the end of this leg. Exactly one leg has one. */
  hand?: boolean;
  hipName: string;
  kneeName: string;
  shinName: string;
  hoofName: string;
}) {
  const rig = front ? FRONT_RIG : BACK_RIG;
  const rest = front ? FRONT_REST : BACK_REST;
  const hip = front ? FRONT_HIP : BACK_HIP;
  const x = mirror ? hip[0] : -hip[0];
  const down: [number, number, number] = [Math.PI / 2, 0, 0];

  // The groups are the leg's bones; the skin hanging off them is part of the
  // one body mesh. Only the cloven hoof is still separate, because on a real
  // cow it is. (There used to be dewclaws too; at any distance the game is
  // actually played from they read as two black dots floating behind the leg.)
  return (
    <group name={hipName} position={[x, hip[1], hip[2]]} rotation={[rest.hip, 0, 0]}>
      <group name={kneeName} position={[0, -rig.seg[0], 0]} rotation={[rest.knee, 0, 0]}>
        <group name={shinName} position={[0, -rig.seg[1], 0]} rotation={[rest.shin, 0, 0]}>
          {/* The chain ends here, ON the ground — so the hoof is built upwards. */}
          <group name={hoofName} position={[0, -rig.seg[2], 0]}>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.023, HOOF_HEIGHT, 0]} rotation={down}>
                <mesh geometry={toeGeo()} material={mats.hoof} castShadow />
              </group>
            ))}
          </group>
          {/* Same place as the hoof, and the two are never out at the same time. */}
          {hand && (
            <group name="fist" position={BASE.fist.pos} scale={BASE.fist.scale}>
              <CowHand hide={mats.pale} nail={mats.hoof} skin={mats.skin} />
            </group>
          )}
        </group>
      </group>
    </group>
  );
}

/**
 * The kiss, as an actual move through 3D space rather than a canned pose: the
 * cow turns to face the lens, then throws itself along the line between its own
 * head and the camera until the muzzle is a few centimetres off the glass. It
 * grows enormous on the way in purely because it really is that close — this is
 * perspective, not a scale-up.
 */
function kissLunge(elapsed: number, dt: number): Pose {
  // Line itself up with the lens during the wind-up, so the lunge goes at YOU
  // wherever you happen to have dragged the camera round to.
  if (elapsed > 250 && elapsed < KISS_BACK) {
    cowState.facing = turnToward(cowState.facing, cam.yaw, 7 * dt);
  }

  const k = kissAmount(elapsed);
  if (k <= 0.0001) return {};

  const gap = cameraGap();
  const reach = Math.max(0.001, Math.hypot(gap.flat, gap.up));
  const t = Math.max(0, 1 - KISS_GAP / reach); // stop just short of the lens

  return {
    body: { pos: [0, gap.up * t * k, (gap.flat * t - HEAD_FORWARD) * k] },
    // chin up, looking straight down the barrel
    head: { rot: [-0.22 * k, 0, 0] },
  };
}

/** True while the cow is pressed against something, so each contact thumps once. */
let onFence = false;
let onProp = false;

/**
 * Whatever the cow is standing next to, as the one contextual action.
 *
 * Everything is a distance test against a point, and the nearest one inside its
 * own range wins — so walking up to the gate while standing on a tuft of grass
 * offers whichever you are actually closer to rather than whichever happens to
 * be checked first.
 */
function nearestPrompt(grassEatenAt: (number | null)[]): Prompt | null {
  const { x, z } = cowState;
  let best: Prompt | null = null;
  let bestD = Infinity;
  const consider = (px: number, pz: number, range: number, p: Prompt) => {
    const d = Math.hypot(px - x, pz - z);
    if (d < range && d < bestD) {
      bestD = d;
      best = p;
    }
  };

  for (const spot of GRASS) {
    if (grassEatenAt[spot.id] !== null) continue;
    consider(spot.x, spot.z, INTERACT_RANGE, {
      kind: "grass",
      id: spot.id,
      label: "Eat the grass",
      icon: "🌿",
    });
  }

  // The gate. Not offered while the cow is standing IN the doorway with it
  // open — shutting it on yourself just teleports you back to whichever side
  // the fence code thinks you were on.
  const open = useCowStore.getState().gateOpen;
  const gateD = Math.hypot(GATE_POINT.x - x, GATE_POINT.z - z);
  if (!open || gateD > 1.5) {
    consider(GATE_POINT.x, GATE_POINT.z, 2.7, {
      kind: "gate",
      id: 0,
      label: open ? "Shut the gate" : "Open the gate",
      icon: open ? "🔒" : "🚪",
    });
  }

  consider(SCARECROW.x, SCARECROW.z, 2.3, {
    kind: "scarecrow",
    id: 0,
    label: "Moo at it",
    icon: "📣",
  });
  // Close enough that the muzzle actually reaches water when the head goes
  // down. Offered from a metre further out, the cow drinks the grass.
  consider(POND.x, POND.z, POND.r + 0.5, {
    kind: "pond",
    id: 0,
    label: "Have a drink",
    icon: "💧",
  });
  // He is solid at 0.85, so this is the ring just outside where the cow can
  // stand. Not offered while he is already talking.
  if (!useCowStore.getState().chatting) {
    consider(OFFICER.x, OFFICER.z, 1.9, {
      kind: "officer",
      id: 0,
      label: "Talk to the officer",
      icon: "👮",
    });
  }

  return best;
}

/**
 * The speed camera by the road. It only cares about a cow doing more than a
 * walking pace, and only once every few seconds.
 */
function checkSpeedTrap() {
  if (!cowState.outside || cowState.speed < SPEED_LIMIT) return;
  const { x, z } = cowState;
  if (x < SPEED_ZONE.x0 || x > SPEED_ZONE.x1 || z < SPEED_ZONE.z0 || z > SPEED_ZONE.z1) return;
  // the store rate-limits it to one photo a pass
  useCowStore.getState().flash(cowState.speed);
}

/**
 * Player-driven movement for one frame. Input is camera-relative — "up" always
 * means away from the camera, whichever way you've dragged it around.
 */
function drive(dt: number, now: number, grassEatenAt: (number | null)[]): Pose {
  const axis = moveAxis();

  // Forward is wherever the camera is pointing, so W always walks the cow off in
  // the direction you're looking. Taken from the camera's own yaw rather than its
  // position, which lags a frame behind.
  const { x: fx, z: fz } = lookForward();
  const rx = -fz; // right-hand side, given +Y is up
  const rz = fx;

  let dx = fx * axis.y + rx * axis.x;
  let dz = fz * axis.y + rz * axis.x;
  const len = Math.hypot(dx, dz);
  const gait = Math.min(1, cowState.speed / WALK_SPEED);
  const flatOut = sprinting();

  if (len > 0.001) {
    dx /= len;
    dz /= len;
    // Half a tonne of cow doesn't start or stop instantly, and it turns wider the
    // faster it's already going. Getting up to a gallop takes a moment longer
    // than getting up to a walk, which is what makes it feel like effort.
    const top = flatOut ? GALLOP_SPEED : WALK_SPEED;
    cowState.speed = approach(cowState.speed, top * len, dt * (cowState.speed > WALK_SPEED ? 4 : 7));
    const turn = TURN_SPEED * (1 - 0.45 * gait) * (cowState.speed > WALK_SPEED ? 0.7 : 1);
    cowState.facing = turnToward(cowState.facing, Math.atan2(dx, dz), turn * dt);
    cowState.x += dx * cowState.speed * dt;
    cowState.z += dz * cowState.speed * dt;
  } else {
    // Let go and it coasts to a stop rather than freezing mid-stride.
    cowState.speed = approach(cowState.speed, 0, dt * 5.5);
    cowState.x += Math.sin(cowState.facing) * cowState.speed * dt;
    cowState.z += Math.cos(cowState.facing) * cowState.speed * dt;
  }

  // The fence: a ring with one gap in it. Which side of the ring the cow is on
  // is tracked rather than derived, so the gap works from both directions —
  // see `resolveFence`. Walking into it is a collision, so the cow stops dead
  // and rocks forward on impact.
  // How fast the cow was going BEFORE anything stopped it — that is the speed
  // it hits things at.
  const impact = cowState.speed;
  const fence = resolveFence(cowState.x, cowState.z, cowState.outside, cowState.gateOpen);
  cowState.x = fence.x;
  cowState.z = fence.z;
  if (fence.outside && !cowState.outside) useCowStore.getState().complete("escape");
  cowState.outside = fence.outside;
  if (fence.hit) {
    if (!onFence) {
      onFence = true;
      kickSpring(cowPhysics.shoveZ, 0.55 * gait);
      kickSpring(cowPhysics.headPitch, 2.2 * gait);
      kickSpring(cowPhysics.earL, 3 * gait);
      kickSpring(cowPhysics.earR, 3 * gait);
      if (impact >= BONK_SPEED) bonked();
    }
    cowState.speed *= 0.4;
  } else {
    onFence = false;
  }

  // The trough, the bales, every tree, the scarecrow, the camera post and the
  // police station are all solid. Same idea as the fence, but pushing straight
  // out of a circle rather than back into one.
  const solid = resolveSolids(cowState.x, cowState.z);
  cowState.x = solid.x;
  cowState.z = solid.z;
  if (solid.hit) {
    if (!onProp) {
      onProp = true;
      kickSpring(cowPhysics.shoveZ, 0.4 * gait);
      kickSpring(cowPhysics.headPitch, 1.6 * gait);
      if (impact >= BONK_SPEED) bonked();
    }
    cowState.speed *= 0.45;
  } else {
    onProp = false;
  }

  const prompt = nearestPrompt(grassEatenAt);
  const store = useCowStore.getState();
  store.setPrompt(prompt);
  // Grass.tsx lights the tuft the cow could eat, so it wants the id on its own.
  store.setNearGrass(prompt?.kind === "grass" ? prompt.id : null);
  checkSpeedTrap();
  if (cowState.speed > GALLOP_SPEED * 0.85) store.complete("gallop");

  const walkAmt = Math.min(1, cowState.speed / WALK_SPEED);
  const walk = quadWalk(cowState.walkPhase, walkAmt);
  const gallop = gallopPose(cowState.walkPhase, gallopAmount());
  // Idling fades out as the cow gets going: a walking animal is not also
  // shifting its weight from hoof to hoof.
  const still = 1 - Math.min(1, walkAmt * 3);
  return addPoses(scalePose(idlePose(now), still), walk, gallop, stare(dt));
}

/**
 * Being watched. Leave the controls alone and the cow notices: its head comes
 * round to look straight down the lens, and it gets steadily less comfortable
 * about it — until, if you still will not do anything, it gives you what it
 * assumes you are waiting for.
 */
const STARE_LINES: [number, string][] = [
  [16, "..."],
  [24, "Can I help you?"],
  [36, "Are you just going to stare at me?"],
  [50, "I'm going to start charging for this."],
  [66, "Fine. FINE. You want a show?"],
];
let stareK = 0;
let stareSaid = 0;

function stare(dt: number): Pose {
  const idle = idleSeconds();
  if (idle < 1) stareSaid = 0;
  const watching = idle > 9 && cowState.speed < 0.05;
  stareK = approach(stareK, watching ? 1 : 0, dt / (watching ? 1.6 : 0.35));
  const store = useCowStore.getState();
  while (stareSaid < STARE_LINES.length && idle > STARE_LINES[stareSaid][0]) {
    store.stare(STARE_LINES[stareSaid][1]);
    stareSaid++;
    if (stareSaid === STARE_LINES.length) {
      // the show: then it starts over, a full minute later
      setTimeout(() => useCowStore.getState().toggleDance(), 1600);
    }
  }
  if (stareSaid === STARE_LINES.length && idle > 75) stareSaid = 0;
  if (stareK <= 0.001) return {};
  // The camera sits out along `cam.yaw` from the cow, so that is the bearing
  // the head has to turn to. A neck only goes so far round.
  const turn = Math.max(-1.05, Math.min(1.05, angleDelta(cowState.facing, cam.yaw)));
  return {
    head: { rot: [-0.12 * stareK, turn * stareK, -turn * 0.12 * stareK] },
    earL: { rot: [0.25 * stareK, 0, 0] },
    earR: { rot: [0.25 * stareK, 0, 0] },
  };
}

/** How far past a walk the cow is going: 0 at a walk, 1 flat out. */
function gallopAmount(): number {
  return Math.max(0, Math.min(1, (cowState.speed - WALK_SPEED) / (GALLOP_SPEED - WALK_SPEED)));
}

/**
 * Ran into something at full tilt. The cow stops dead, the head is thrown
 * back, and the `bonk` gag takes the body for a couple of seconds of seeing
 * stars — which also, conveniently, stops it immediately galloping into the
 * same tree again.
 */
function bonked() {
  cowState.speed = 0;
  kickSpring(cowPhysics.headPitch, -6);
  kickSpring(cowPhysics.headRoll, 5);
  kickSpring(cowPhysics.earL, 8);
  kickSpring(cowPhysics.earR, -8);
  addShake(0.45);
  const store = useCowStore.getState();
  store.bumpStat("bonks");
  store.triggerGag("bonk");
}

/** Scale a whole pose layer's contribution — used to fade the idle out. */
function scalePose(pose: Pose, k: number): Pose {
  if (k >= 0.999) return pose;
  if (k <= 0.001) return {};
  const out: Pose = {};
  for (const name of Object.keys(pose) as PartName[]) {
    const p = pose[name];
    if (!p) continue;
    out[name] = {
      pos: p.pos && [p.pos[0] * k, p.pos[1] * k, p.pos[2] * k],
      rot: p.rot && [p.rot[0] * k, p.rot[1] * k, p.rot[2] * k],
      scale: p.scale && [p.scale[0] * k, p.scale[1] * k, p.scale[2] * k],
    };
  }
  return out;
}


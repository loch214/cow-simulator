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
  idlePose,
  quadWalk,
} from "@/lib/locomotion";
import { angleDelta, approach, cowState, turnToward } from "@/lib/cowState";
import { dancePose } from "@/lib/dance";
import { moveAxis, onAction, onInteract, startInput } from "@/lib/input";
import { cam, cameraGap, frameFront, lookForward } from "@/lib/camera";
import { cowPhysics, kickSpring, makeSpring, relaxPhysics, stepCowPhysics, stepSpring } from "@/lib/physics";
import { creak, step as footstep } from "@/lib/audio";
import { newRunner, stepCutscene, type CutsceneRunner } from "@/lib/cutscene";
import { loft, lumpGeometry, rng } from "@/lib/geometry";
import { wind } from "@/lib/sway";
import { hairBump, headMap, hideMap, legMap, upperLegMap } from "@/lib/textures";
import { CowHand, SlapHand } from "./Hands";
import {
  GATE_POINT,
  GRASS,
  INTERACT_RANGE,
  POND,
  resolveFence,
  resolveSolids,
  SCARECROW,
  SPEED_LIMIT,
  SPEED_TRAP,
  SPEED_TRAP_RANGE,
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

/** The poll — the joint at the top of the neck that the skull hangs off. */
const HEAD_POS: [number, number, number] = [0, 1.05, 0.86];
/** Where the neck leaves the body. Buried in the chest so its stretch does not show. */
const NECK_ROOT = new THREE.Vector3(0, 0.95, 0.32);

const part = (
  pos: [number, number, number],
  rot: [number, number, number] = ORIGIN,
  scale: [number, number, number] = UNIT
): Base => ({ pos, rot, scale });

/**
 * How far back the ears sweep from straight-out, and how far the tips droop.
 *
 * These are not free numbers. An ear is a leaf built along +z, and the group's
 * resting rotation is the ONLY thing deciding which way it leaves the skull —
 * so `[a, b, 0]` has to be solved rather than guessed. For Euler XYZ the local
 * +z axis lands at `(sin b, -cos b·sin a, cos b·cos a)`; putting `b = ±(PI/2 +
 * EAR_SWEEP)` aims it straight out of the side of the head and swings it back,
 * and `a = -EAR_DROOP` drops the tip. Guessed values are how both ears ended up
 * pointing forwards, with every millimetre of them buried inside the skull.
 */
const EAR_SWEEP = 0.34;
const EAR_DROOP = 0.62;
const EAR_L: [number, number, number] = [-EAR_DROOP, -(Math.PI / 2 + EAR_SWEEP), 0];
const EAR_R: [number, number, number] = [-EAR_DROOP, Math.PI / 2 + EAR_SWEEP, 0];

const BASE: Record<PartName, Base> = {
  body: part(ORIGIN),
  head: part(HEAD_POS),
  jaw: part([0, -0.045, 0.05]),
  // Rooted just inside the side of the skull, below the horns and behind the
  // eye — where a cow's ear actually comes out.
  earL: part([-0.118, 0.026, -0.052], EAR_L),
  earR: part([0.118, 0.026, -0.052], EAR_R),

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
  blush: part([0, -0.03, 0.16], ORIGIN, HIDDEN),
  brow: part(ORIGIN, ORIGIN, HIDDEN),

  // The hand sits exactly where the front-right hoof does — on the end of the
  // cannon — and is scaled to nothing until one pose asks for it. `aimFist`
  // overwrites its rotation every frame; only the position matters here.
  fist: part([0, -FRONT_RIG.seg[2], 0], ORIGIN, HIDDEN),
};

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

/**
 * The barrel. A cow is deep and narrow rather than round — taller through the
 * ribs than it is wide — which is most of why a stack of spheres never reads as
 * one. Rings run rump (-z) to brisket (+z).
 */
const torsoGeo = once(() =>
  loft(
    [
      { z: -0.72, y: 0.86, rx: 0.115, ry: 0.14 },
      { z: -0.6, y: 0.85, rx: 0.235, ry: 0.25 },
      { z: -0.44, y: 0.845, rx: 0.275, ry: 0.285 },
      { z: -0.15, y: 0.815, rx: 0.275, ry: 0.3 },
      { z: 0.15, y: 0.815, rx: 0.27, ry: 0.305 },
      { z: 0.42, y: 0.835, rx: 0.245, ry: 0.285 },
      { z: 0.58, y: 0.855, rx: 0.215, ry: 0.25 },
      { z: 0.7, y: 0.87, rx: 0.145, ry: 0.18 },
    ],
    { radial: 26, segments: 60 }
  )
);

/** Neck, built one unit long so it can be stretched between shoulder and poll. */
const neckGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.205, ry: 0.245 },
      { z: 0.35, rx: 0.175, ry: 0.208 },
      { z: 0.72, rx: 0.142, ry: 0.166 },
      { z: 1.0, rx: 0.112, ry: 0.125 },
    ],
    { radial: 20, segments: 24, caps: false }
  )
);

/** The loose fold of skin under a cow's throat. Hangs off the chest, not the neck. */
const dewlapGeo = once(() =>
  loft(
    [
      { z: 0, y: 0.94, rx: 0.05, ry: 0.09 },
      { z: 0.16, y: 0.85, rx: 0.062, ry: 0.14 },
      { z: 0.34, y: 0.76, rx: 0.055, ry: 0.15 },
      { z: 0.52, y: 0.72, rx: 0.045, ry: 0.11 },
      { z: 0.66, y: 0.76, rx: 0.03, ry: 0.06 },
    ],
    { radial: 14, segments: 22 }
  )
);

/**
 * One half of the udder. Two lobes rather than one blob, because the median
 * cleft down the middle is the whole silhouette of the thing.
 */
const udderGeo = once(() => lumpGeometry(9001, 0.15, 0.13, 2));

// ---------------------------------------------------------------------------
// the masses that make the cow one animal instead of a kit of parts
//
// Everything below is a lump that sits on the barrel and OVERLAPS the top of a
// limb, the neck or the tail. This is the single biggest thing separating the
// cow that reads as an animal from the one that read as a stack of components:
// a leg is a cone plugged into a flank, and no amount of texturing hides the
// crease where the two meet. Put a shoulder or a haunch over the join, let the
// bone rotate *inside* it, and the crease is gone at every angle — which is how
// real quadruped rigs do it too.
//
// These are all built centred on their own origin and positioned in the body,
// and none of them are animated: a shoulder barely moves against the ribs.
// ---------------------------------------------------------------------------

/** Shoulder blade and the muscle over it. Swallows the top of each front leg. */
const shoulderGeo = once(() =>
  loft(
    [
      // Both ends run out to nothing. A mass that still has area where it
      // crosses back into the barrel leaves a hard rim there — an elliptical
      // outline drawn on the flank, which is the giveaway that the cow is a pile
      // of separate lumps. Tapered to a point, the two surfaces meet edge-on and
      // the join simply disappears.
      { z: -0.3, rx: 0.002, ry: 0.004 },
      { z: -0.2, rx: 0.075, ry: 0.135 },
      { z: -0.06, rx: 0.128, ry: 0.192 },
      { z: 0.06, rx: 0.138, ry: 0.196 },
      { z: 0.18, rx: 0.104, ry: 0.158 },
      { z: 0.28, rx: 0.002, ry: 0.004 },
    ],
    { radial: 18, segments: 30 }
  )
);

/** The great round muscle of the hind quarter. Also forms the cow's backside. */
const haunchGeo = once(() =>
  loft(
    [
      // Tapered out to nothing at both ends, for the same reason the shoulder is.
      { z: -0.3, rx: 0.002, ry: 0.004 },
      { z: -0.2, rx: 0.09, ry: 0.165 },
      { z: -0.08, rx: 0.142, ry: 0.232 },
      { z: 0.04, rx: 0.156, ry: 0.244 },
      { z: 0.18, rx: 0.118, ry: 0.185 },
      { z: 0.32, rx: 0.002, ry: 0.004 },
    ],
    { radial: 18, segments: 30 }
  )
);

/**
 * The topline: withers, the dip of the loin, the hip bones and the tail head, as
 * one low ridge laid along the spine. A cow seen from behind or above is all
 * angles — a bony ridge between two round sides — and a barrel with a smooth
 * back is the other half of why the first pass read as a toy.
 *
 * Built in body coordinates, so it goes in at the origin.
 */
const toplineGeo = once(() =>
  loft(
    [
      { z: 0.68, y: 1.0, rx: 0.05, ry: 0.03 },
      { z: 0.5, y: 1.09, rx: 0.088, ry: 0.05 },
      { z: 0.3, y: 1.1, rx: 0.098, ry: 0.052 },
      { z: 0.05, y: 1.095, rx: 0.09, ry: 0.048 },
      { z: -0.2, y: 1.085, rx: 0.11, ry: 0.048 },
      // the hooks: wide, flat and square, which is what makes them read as bone
      { z: -0.42, y: 1.12, rx: 0.235, ry: 0.058 },
      { z: -0.6, y: 1.085, rx: 0.15, ry: 0.055 },
      { z: -0.73, y: 1.01, rx: 0.065, ry: 0.045 },
    ],
    { radial: 18, segments: 46, square: 0.45 }
  )
);

/** The point of the chest, filling the gap between the two front legs. */
const brisketGeo = once(() =>
  loft(
    [
      { z: 0.24, y: 0.72, rx: 0.135, ry: 0.13 },
      { z: 0.44, y: 0.685, rx: 0.16, ry: 0.155 },
      { z: 0.6, y: 0.705, rx: 0.14, ry: 0.145 },
      { z: 0.71, y: 0.765, rx: 0.075, ry: 0.085 },
    ],
    { radial: 16, segments: 22 }
  )
);

/**
 * The skull. Rings run from behind the poll (-z) to the nose (+z): broad and
 * squarish across the cheeks, pinched at the bridge, then flaring back out into
 * a blunt muzzle. A cow head is short, deep and wide — build it long and tapered
 * and you get an anteater, which is exactly what the first attempt looked like.
 *
 * This table is the single source of truth for the shape of the head: `skullGeo`
 * lofts it, `scalpAt` plants hair on it and `faceAt` puts the eyes on it. It
 * lives up here, above all three, because a copy of it that drifts is how the
 * fringe ends up growing out of the inside of the forehead.
 */
const SKULL_RINGS = [
  { z: -0.16, y: 0.005, rx: 0.126, ry: 0.124 },
  { z: -0.06, y: 0.012, rx: 0.154, ry: 0.15 },
  { z: 0.04, y: -0.014, rx: 0.146, ry: 0.138 },
  // the bridge, pinched in — this waist is what stops the head being a wedge
  { z: 0.13, y: -0.05, rx: 0.107, ry: 0.108 },
  { z: 0.21, y: -0.072, rx: 0.094, ry: 0.094 },
  // ...and the muzzle end flaring back OUT, wider than the bridge above it
  { z: 0.28, y: -0.086, rx: 0.099, ry: 0.096 },
  { z: 0.325, y: -0.092, rx: 0.099, ry: 0.092 },
];

/** The skull's cross-section at `z`, interpolated between rings. */
function skullAt(z: number) {
  const r = SKULL_RINGS;
  let i = 0;
  while (i < r.length - 2 && z > r[i + 1].z) i++;
  const a = r[i];
  const b = r[i + 1];
  const f = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
  return {
    cy: a.y + (b.y - a.y) * f,
    rx: a.rx + (b.rx - a.rx) * f,
    ry: a.ry + (b.ry - a.ry) * f,
  };
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

/**
 * The top of the skull, sampled from the same ring table `skullGeo` is lofted
 * from. Hair has to be PLANTED on this surface: the old fringe was pinned at one
 * fixed height on the poll, which is below the crown of the head, so two thirds
 * of every lock started out inside the skull and came out through the forehead
 * looking like a row of spikes driven into it.
 */
function scalpAt(x: number, z: number): number {
  const { cy, rx, ry } = skullAt(z);
  const t = Math.min(1, Math.abs(x) / rx);
  return cy + ry * Math.sqrt(Math.max(0, 1 - t * t));
}

/**
 * How far out the side of the head the surface is at (`y`, `z`) — the same
 * sampling as `scalpAt`, turned ninety degrees. The eyes are pushed out onto
 * this rather than placed by eye, because an eye a centimetre too far in
 * vanishes into the skull and the cow goes blank.
 */
function faceAt(y: number, z: number): number {
  const { cy, rx, ry } = skullAt(z);
  const t = Math.min(1, Math.abs(y - cy) / ry);
  return rx * Math.sqrt(Math.max(0, 1 - t * t));
}

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
      pos: [x, scalpAt(x, rz) + lift, rz],
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

const skullGeo = once(() => loft(SKULL_RINGS, { radial: 22, segments: 42, square: 0.2 }));

/**
 * The soft pad around the nostrils and lips — leathery, and a different colour.
 *
 * Kept small and squared off. A big round pink dome on a white face is a pig's
 * snout, which is exactly what the first version looked like; a real muzzle is a
 * broad flat plate of dark skin, and `headMap` paints the skull dark for the
 * last stretch behind it so the transition is skin-to-skin rather than a pink
 * disc stuck on white hair.
 */
/**
 * Where the front of the pad is. The nostrils are placed relative to this
 * rather than in absolute numbers, because a pad that gets narrowed by a
 * centimetre swallows a nostril that did not move with it — which is how the
 * cow ended up with a smooth rubber plate for a nose.
 */
const MUZZLE_TIP = 0.384;
const muzzleGeo = once(() =>
  loft(
    [
      // starts inside the skull, comes out through it, and ends blunt: the flat
      // front is what the nostrils and the philtrum have to sit on. Wider than
      // it is tall, which is the one proportion that keeps this a muzzle and
      // not a snout.
      { z: 0.268, y: -0.086, rx: 0.056, ry: 0.046 },
      { z: 0.318, y: -0.098, rx: 0.086, ry: 0.062 },
      { z: 0.358, y: -0.106, rx: 0.088, ry: 0.062 },
      { z: MUZZLE_TIP, y: -0.112, rx: 0.072, ry: 0.05 },
    ],
    { radial: 22, segments: 24, square: 0.22 }
  )
);

/** Lower jaw. Swings on the `jaw` part so the cow can chew. */
const jawGeo = once(() =>
  loft(
    [
      { z: -0.09, y: -0.02, rx: 0.112, ry: 0.062 },
      { z: 0.04, y: -0.052, rx: 0.108, ry: 0.062 },
      { z: 0.15, y: -0.072, rx: 0.086, ry: 0.05 },
      { z: 0.25, y: -0.086, rx: 0.07, ry: 0.042 },
      { z: 0.312, y: -0.096, rx: 0.058, ry: 0.034 },
    ],
    { radial: 16, segments: 20, square: 0.3 }
  )
);

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
 * Leg bones. `seg` picks the length; the taper is what makes it look boned.
 *
 * Both ends are DOMED and run past the joint they hang off by `over`. Two capped
 * tubes butted end to end is what made the legs read as a stack of blocks: at
 * rest you see the ring where the caps meet, and the moment the leg bends the
 * two discs pull apart and the joint opens up. A bone that pokes into the
 * swelling above and below it can never do either, at any angle.
 *
 * The rings are deliberately evenly spaced along the bone. `loft` runs a
 * Catmull-Rom through them by INDEX, so bunching a couple of rings up against
 * an end makes the spline overshoot between the far-apart ones and puts a
 * phantom bulge in the middle of the shin.
 */
const BONE_OVER = 0.045;

const boneGeo = (len: number, top: number, waist: number, bottom: number) => {
  const oval = 1.06; // a leg is slightly deeper front-to-back than it is wide
  const ring = (z: number, r: number) => ({ z, rx: r * oval, ry: r });
  return loft(
    [
      ring(-BONE_OVER, top * 0.45),
      ring(0, top),
      ring(len * 0.18, waist + (top - waist) * 0.45),
      ring(len * 0.42, waist),
      ring(len * 0.68, waist * 0.95),
      ring(len * 0.88, bottom + (waist * 0.95 - bottom) * 0.35),
      ring(len, bottom),
      ring(len + BONE_OVER, bottom * 0.45),
    ],
    { radial: 14, segments: 34 }
  );
};

/**
 * The swelling at a joint — knee, hock, fetlock. Hung off the LOWER bone's pivot
 * so it turns with the bend, and deliberately fatter than both bones it sits
 * between: its entire job is to swallow the two domed ends that meet inside it.
 * This is the same trick as the shoulder and the haunch further up, just at the
 * scale of a knee.
 *
 * `deep` stretches it front-to-back. Every joint on a cow's leg is deeper than
 * it is wide, and a joint built as a plain ball reads as a bearing, not a knee.
 */
const jointGeo = (above: number, below: number, r: number, deep = 1.15) =>
  loft(
    [
      { z: -above, rx: r * 0.3, ry: r * 0.3 * deep },
      { z: -above * 0.58, rx: r * 0.74, ry: r * 0.74 * deep },
      { z: -above * 0.14, rx: r * 0.98, ry: r * 0.98 * deep },
      { z: below * 0.24, rx: r, ry: r * deep },
      { z: below * 0.64, rx: r * 0.84, ry: r * 0.84 * deep },
      { z: below, rx: r * 0.32, ry: r * 0.32 * deep },
    ],
    { radial: 14, segments: 22 }
  );

// The tops are narrower than they look like they should be, on purpose: each one
// has to fit INSIDE the shoulder or haunch that covers its joint (see the masses
// above), or the bone pokes out through the muscle and the crease is back.
const frontUpperGeo = once(() => boneGeo(FRONT_RIG.seg[0], 0.125, 0.096, 0.07));
const frontMidGeo = once(() => boneGeo(FRONT_RIG.seg[1], 0.072, 0.056, 0.046));
// The cannon stops short of the ground: the hoof caps it.
const frontCannonGeo = once(() => boneGeo(FRONT_RIG.seg[2] - 0.05, 0.048, 0.04, 0.043));
const backUpperGeo = once(() => boneGeo(BACK_RIG.seg[0], 0.135, 0.112, 0.072));
const backMidGeo = once(() => boneGeo(BACK_RIG.seg[1], 0.075, 0.055, 0.045));
const backCannonGeo = once(() => boneGeo(BACK_RIG.seg[2] - 0.05, 0.047, 0.039, 0.043));

// Knee and hock. Both are wider than the bone above AND the bone below them —
// which is also simply true of a cow, whose knees are the widest part of the leg
// — but only just. A joint much fatter than its bones stops hiding the seam and
// becomes one: you get a ball with a step down to a tube on either side, which
// is the exact look this is here to remove.
const frontKneeGeo = once(() => jointGeo(0.06, 0.09, 0.082, 1.18));
const backKneeGeo = once(() => jointGeo(0.06, 0.095, 0.086, 1.34));
/** The swelling that covers the top of the cannon where it leaves the knee. */
const cannonTopGeo = once(() => jointGeo(0.05, 0.06, 0.052, 1.1));
/**
 * Fetlock and pastern in one piece: the knuckle the hoof hangs off, and the
 * short slope from it into the coronet. One shape rather than two, because two
 * capped tubes stacked here read as a white cuff pulled over the ankle — the
 * flat end of the lower one draws a hard ring right where nothing should be.
 *
 * It starts buried in the cannon and finishes buried in the hoof, so neither end
 * is ever visible from any angle.
 */
const pasternGeo = once(() =>
  loft(
    [
      { z: -0.062, rx: 0.017, ry: 0.017 },
      { z: -0.032, rx: 0.039, ry: 0.041 },
      { z: 0, rx: 0.047, ry: 0.05 },
      { z: 0.03, rx: 0.043, ry: 0.045 },
      { z: 0.058, rx: 0.039, ry: 0.041 },
      { z: 0.086, rx: 0.021, ry: 0.023 },
    ],
    { radial: 14, segments: 26 }
  )
);

/**
 * One half of a cloven hoof, built from the coronet DOWN — `z` here is distance
 * below the top of the hoof, because the leg solver puts the end of the chain on
 * the ground and the hoof has to stand on that point rather than hang under it.
 * Get this backwards and the cow walks with its feet buried.
 */
const HOOF_HEIGHT = 0.098;
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

const eyeGeo = once(() => new THREE.SphereGeometry(0.031, 16, 14));
const lidGeo = once(
  () => new THREE.SphereGeometry(0.035, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
);
/** The bony ridge a cow's eye sits in. Without it the eye reads as stuck on. */
const socketGeo = once(() => new THREE.SphereGeometry(0.048, 14, 10));

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

function useCowMaterials() {
  return useMemo(() => {
    const bump = hairBump();
    const hide = new THREE.MeshStandardMaterial({
      map: hideMap(),
      bumpMap: bump,
      bumpScale: 0.012,
      roughness: 0.82,
      metalness: 0,
    });
    const head = new THREE.MeshStandardMaterial({
      map: headMap(),
      bumpMap: bump,
      bumpScale: 0.01,
      roughness: 0.82,
      metalness: 0,
    });
    const pale = new THREE.MeshStandardMaterial({
      color: "#efeade",
      bumpMap: bump,
      bumpScale: 0.008,
      roughness: 0.85,
    });
    // Two leg maps rather than one material each for the upper and lower bones:
    // the patches die out before the knee on both of them, so the join between
    // them is cream against cream and no longer reads as a boot. See lib/textures.
    const upperLeg = new THREE.MeshStandardMaterial({
      map: upperLegMap(),
      bumpMap: bump,
      bumpScale: 0.011,
      roughness: 0.84,
    });
    const leg = new THREE.MeshStandardMaterial({
      map: legMap(),
      bumpMap: bump,
      bumpScale: 0.009,
      roughness: 0.84,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: "#2b2622",
      bumpMap: bump,
      bumpScale: 0.008,
      roughness: 0.8,
    });
    return {
      hide,
      head,
      pale,
      dark,
      upperLeg,
      leg,
      // Hair, as opposed to coat: darker than the black of the hide, and matte,
      // so a forelock does not catch the sun the way the shoulder next to it does.
      // Warmer and lighter than the black of the hide on purpose: the poll it
      // grows out of is one of the Holstein's black patches, and true black hair
      // on it disappears completely.
      hair: new THREE.MeshStandardMaterial({ color: "#453529", roughness: 0.96 }),
      // The teats and the inner ear are bare skin — pinker, and shinier than
      // hair, which is a surprisingly large part of looking like an animal.
      skin: new THREE.MeshStandardMaterial({ color: "#c98d94", roughness: 0.55 }),
      // The muzzle is bare skin too, but it is NOT pink: a cow's nose is a dusty
      // grey-rose plate. Painting it the same pink as a teat is most of what made
      // the face read as a cartoon pig.
      muzzle: new THREE.MeshStandardMaterial({ color: "#9b7d7c", roughness: 0.42 }),
      nostril: new THREE.MeshStandardMaterial({ color: "#54373b", roughness: 0.5 }),
      horn: new THREE.MeshStandardMaterial({ color: "#cbbfa6", roughness: 0.5 }),
      hoof: new THREE.MeshStandardMaterial({ color: "#3a332c", roughness: 0.45 }),
      eye: new THREE.MeshStandardMaterial({ color: "#160d07", roughness: 0.14 }),
      blush: new THREE.MeshStandardMaterial({
        color: "#e8798f",
        transparent: true,
        opacity: 0.75,
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
      runnerRef.current = newRunner();
      endedRef.current = false;
      relaxPhysics(); // start the walk to the station from a settled body
    } else {
      runnerRef.current = null;
    }
  }, [inCutscene]);

  useEffect(() => {
    const stopKeys = startInput();
    const stopInteract = onInteract(() => useCowStore.getState().interact());
    const stopAction = onAction((action) =>
      useCowStore.getState().triggerGag(action === "pet" ? "shy" : "slap")
    );
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
    scratch.dir.copy(scratch.target).sub(NECK_ROOT);
    const len = Math.max(0.2, scratch.dir.length());
    neck.quaternion.setFromUnitVectors(scratch.up, scratch.dir.normalize());
    neck.scale.set(1, len, 1);
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
      if (lid) lid.rotation.x = -0.55 + k * 2.05;
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
  });

  return (
    <>
      <group ref={pivotRef}>
      <group name="body">
        <mesh geometry={torsoGeo()} material={mats.hide} castShadow receiveShadow />
        <mesh geometry={dewlapGeo()} material={mats.hide} castShadow />
        <mesh geometry={brisketGeo()} material={mats.hide} castShadow />
        {/* The bony topline, and the muscle over each of the four joints. These
            all deliberately overlap what they sit on — see the note above. */}
        <mesh geometry={toplineGeo()} material={mats.hide} castShadow />
        {[-1, 1].map((s) => (
          <mesh
            key={`sh${s}`}
            geometry={shoulderGeo()}
            material={mats.hide}
            position={[s * FRONT_HIP[0], 0.87, 0.44]}
            castShadow
          />
        ))}
        {[-1, 1].map((s) => (
          <mesh
            key={`ha${s}`}
            geometry={haunchGeo()}
            material={mats.hide}
            position={[s * BACK_HIP[0], 0.855, -0.44]}
            castShadow
          />
        ))}

        {/* udder, tucked up between the hind legs */}
        <group position={[0, 0.6, -0.4]}>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              geometry={udderGeo()}
              material={mats.pale}
              position={[s * 0.062, 0, 0]}
              scale={[0.95, 0.88, 1.2]}
              castShadow
            />
          ))}
          {[-0.075, 0.075].map((x) =>
            [-0.075, 0.065].map((z) => (
              <mesh
                key={`${x}${z}`}
                position={[x, -0.145, z]}
                rotation={[0, 0, x * 1.2]}
                material={mats.skin}
              >
                <cylinderGeometry args={[0.017, 0.013, 0.062, 7]} />
              </mesh>
            ))
          )}
        </group>

        {/* Neck: positioned and stretched every frame by stretchNeck(). */}
        <group ref={neckRef} position={NECK_ROOT}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh geometry={neckGeo()} material={mats.hide} castShadow />
          </group>
        </group>

        <group name="head" position={HEAD_POS}>
          <mesh geometry={skullGeo()} material={mats.head} castShadow />
          <mesh geometry={muzzleGeo()} material={mats.muzzle} />
          {/* the philtrum, the groove running down between the nostrils */}
          <mesh
            position={[0, -0.128, MUZZLE_TIP - 0.006]}
            rotation={[0.24, 0, 0]}
            material={mats.nostril}
          >
            <boxGeometry args={[0.009, 0.042, 0.014]} />
          </mesh>

          {/* Nostrils — comma-shaped, and they flare when the cow is cross.
              They sit a few millimetres PROUD of the front of the pad; sunk
              flush with it they disappear and the cow has a blank nose. */}
          <group ref={nostrilRef} position={[0, -0.092, MUZZLE_TIP - 0.004]}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.04, 0, 0]}
                rotation={[0.2, 0, s * 0.55]}
                scale={[1, 1.45, 0.5]}
                material={mats.nostril}
              >
                <sphereGeometry args={[0.018, 10, 8]} />
              </mesh>
            ))}
          </group>
          <mesh ref={breathRef} position={[0, -0.1, 0.42]} material={mats.breath}>
            <sphereGeometry args={[0.07, 8, 8]} />
          </mesh>

          <group name="jaw" position={BASE.jaw.pos}>
            <mesh geometry={jawGeo()} material={mats.head} castShadow />
            {/* the lip line. A head with no mouth reads as a mask. */}
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.032, -0.048, 0.268]}
                rotation={[0.1, -s * 0.28, 0]}
                material={mats.nostril}
              >
                <boxGeometry args={[0.07, 0.008, 0.011]} />
              </mesh>
            ))}
          </group>

          {/* Eyes sit out on the sides of the head, the way a prey animal's do.
              `faceAt` puts them ON the skull rather than near it: a couple of
              millimetres in and the whole eye disappears inside the head. */}
          {[-1, 1].map((s, i) => (
            <group
              key={s}
              position={[s * (faceAt(0.03, 0.025) - 0.016), 0.03, 0.025]}
              rotation={[0, s * 0.78, -s * 0.12]}
            >
              <mesh geometry={socketGeo()} material={mats.head} scale={[0.62, 0.78, 0.62]} />
              <mesh
                geometry={eyeGeo()}
                material={mats.eye}
                position={[0, 0, 0.014]}
                scale={[0.8, 0.95, 0.85]}
              />
              {/* catchlight: a dead eye is the fastest way to kill an animal */}
              <mesh position={[0.007, 0.011, 0.031]}>
                <sphereGeometry args={[0.0045, 8, 8]} />
                <meshBasicMaterial color="#e8eef5" />
              </mesh>
              <group name={`lid${i}`} rotation={[-0.55, 0, 0]}>
                <mesh geometry={lidGeo()} material={mats.head} position={[0, 0, 0.008]} />
              </group>
              {/* lower lid, so the eye sits in a socket rather than on the surface */}
              <mesh
                geometry={lidGeo()}
                material={mats.head}
                position={[0, 0, 0.008]}
                rotation={[Math.PI + 0.42, 0, 0]}
              />
            </group>
          ))}

          {/* angry brows — scaled to nothing until the cow has something to glare about */}
          <group name="brow" position={BASE.brow.pos} scale={BASE.brow.scale}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.078, 0.086, 0.052]}
                rotation={[0.15, s * 0.55, -s * 0.5]}
                scale={[0.85, 0.4, 0.55]}
                material={mats.dark}
              >
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            ))}
          </group>

          {/* The inner ear faces DOWN in the ear's own frame, because the leaf
              is built flat in x/z and the resting rotation lays it out level:
              -y is the underside, which is the side you can see. */}
          <group name="earL" position={BASE.earL.pos} rotation={BASE.earL.rot}>
            <mesh geometry={earGeo()} material={mats.head} castShadow />
            <mesh geometry={earInnerGeo()} material={mats.skin} position={[0, -0.008, 0]} />
          </group>
          <group name="earR" position={BASE.earR.pos} rotation={BASE.earR.rot}>
            <mesh geometry={earGeo()} material={mats.head} castShadow />
            <mesh geometry={earInnerGeo()} material={mats.skin} position={[0, -0.008, 0]} />
          </group>

          {[-1, 1].map((s) => (
            <mesh
              key={s}
              geometry={hornGeo()}
              material={mats.horn}
              position={[s * 0.07, 0.095, -0.045]}
              scale={[s, 1, 1]}
              castShadow
            />
          ))}
          {/*
            The hair. One group, so the fringe and the tuft behind it move
            together as a clump; `swayHair` rotates it every frame off the wind
            clock and the head springs. Its origin sits at the roots rather than
            at the poll, so it pivots where hair actually pivots.
          */}
          {/* Every root here is planted ON the skull by `scalpAt`, so the group
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
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * (faceAt(-0.03, 0.09) - 0.012), -0.03, 0.09]}
                scale={[1, 0.7, 0.5]}
                material={mats.blush}
              >
                <sphereGeometry args={[0.05, 10, 8]} />
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
            <mesh geometry={tailGeo()} material={mats.hide} castShadow />
          </group>
          <group name="tailTip" position={BASE.tailTip.pos}>
            <group rotation={[Math.PI / 2, 0, 0]}>
              <mesh geometry={tailTipGeo()} material={mats.hide} />
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
  const upper = front ? frontUpperGeo() : backUpperGeo();
  const mid = front ? frontMidGeo() : backMidGeo();
  const cannon = front ? frontCannonGeo() : backCannonGeo();
  const down: [number, number, number] = [Math.PI / 2, 0, 0];

  const knee = front ? frontKneeGeo() : backKneeGeo();
  // Where the fetlock sits: high enough that its own lower half is buried in the
  // top of the hoof, so there is no bare stick of cannon between the two.
  const fetlockY = -rig.seg[2] + 0.115;

  return (
    <group name={hipName} position={[x, hip[1], hip[2]]} rotation={[rest.hip, 0, 0]}>
      <group rotation={down}>
        <mesh geometry={upper} material={mats.upperLeg} castShadow />
      </group>
      <group name={kneeName} position={[0, -rig.seg[0], 0]} rotation={[rest.knee, 0, 0]}>
        {/* The joint, swallowing the domed end of the bone above and the bone
            below. Same material as the shin so there is no seam to find. */}
        <group rotation={down}>
          <mesh geometry={knee} material={mats.leg} castShadow />
        </group>
        <group rotation={down}>
          <mesh geometry={mid} material={mats.leg} castShadow />
        </group>
        <group name={shinName} position={[0, -rig.seg[1], 0]} rotation={[rest.shin, 0, 0]}>
          {/* the top of the cannon, covered the same way the knee above it is */}
          <group rotation={down}>
            <mesh geometry={cannonTopGeo()} material={mats.leg} castShadow />
          </group>
          <group rotation={down}>
            <mesh geometry={cannon} material={mats.leg} castShadow />
          </group>
          {/* fetlock and pastern, and the dewclaws behind them */}
          <group position={[0, fetlockY, 0]} rotation={down}>
            <mesh geometry={pasternGeo()} material={mats.leg} castShadow />
          </group>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * 0.026, fetlockY - 0.012, -0.042]}
              scale={[0.7, 1.3, 0.7]}
              material={mats.hoof}
            >
              <sphereGeometry args={[0.015, 8, 6]} />
            </mesh>
          ))}
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
              <CowHand hide={mats.leg} nail={mats.hoof} skin={mats.skin} />
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
/** When the speed camera last went off, so it isn't one ticket per frame. */
let lastTicket = 0;

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

  return best;
}

/**
 * The speed camera by the road. It only cares about a cow doing more than a
 * walking pace, and only once every few seconds.
 */
function checkSpeedTrap() {
  if (!cowState.outside || cowState.speed < SPEED_LIMIT) return;
  const d = Math.hypot(SPEED_TRAP.x - cowState.x, SPEED_TRAP.z - cowState.z);
  if (d > SPEED_TRAP_RANGE) return;
  const t = performance.now();
  if (t - lastTicket < 9000) return;
  lastTicket = t;
  useCowStore.getState().flash();
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

  if (len > 0.001) {
    dx /= len;
    dz /= len;
    // Half a tonne of cow doesn't start or stop instantly, and it turns wider the
    // faster it's already going.
    cowState.speed = approach(cowState.speed, WALK_SPEED * len, dt * 7);
    const turn = TURN_SPEED * (1 - 0.45 * gait);
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
  const fence = resolveFence(cowState.x, cowState.z, cowState.outside, cowState.gateOpen);
  cowState.x = fence.x;
  cowState.z = fence.z;
  cowState.outside = fence.outside;
  if (fence.hit) {
    if (!onFence) {
      onFence = true;
      kickSpring(cowPhysics.shoveZ, 0.55 * gait);
      kickSpring(cowPhysics.headPitch, 2.2 * gait);
      kickSpring(cowPhysics.earL, 3 * gait);
      kickSpring(cowPhysics.earR, 3 * gait);
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

  const walkAmt = Math.min(1, cowState.speed / WALK_SPEED);
  const walk = quadWalk(cowState.walkPhase, walkAmt);
  // Idling fades out as the cow gets going: a walking animal is not also
  // shifting its weight from hoof to hoof.
  const still = 1 - Math.min(1, walkAmt * 3);
  return addPoses(scalePose(idlePose(now), still), walk);
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


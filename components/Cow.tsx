"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useCowStore } from "@/lib/store";
import { gags, kissAmount, KISS_BACK } from "@/lib/reactions";
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
import { moveAxis, onAction, onInteract, startInput } from "@/lib/input";
import { cam, cameraGap, lookForward } from "@/lib/camera";
import { cowPhysics, kickSpring, relaxPhysics, stepCowPhysics } from "@/lib/physics";
import { creak, step as footstep } from "@/lib/audio";
import { newRunner, stepCutscene, type CutsceneRunner } from "@/lib/cutscene";
import { loft, lumpGeometry } from "@/lib/geometry";
import { hairBump, headMap, hideMap } from "@/lib/textures";
import {
  GRASS,
  INTERACT_RANGE,
  OBSTACLES,
  PIT_INNER,
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
const HEAD_POS: [number, number, number] = [0, 1.02, 0.92];
/** Where the neck leaves the body. Buried in the chest so its stretch does not show. */
const NECK_ROOT = new THREE.Vector3(0, 0.95, 0.32);

const part = (
  pos: [number, number, number],
  rot: [number, number, number] = ORIGIN,
  scale: [number, number, number] = UNIT
): Base => ({ pos, rot, scale });

const BASE: Record<PartName, Base> = {
  body: part(ORIGIN),
  head: part(HEAD_POS),
  jaw: part([0, -0.045, 0.05]),
  earL: part([-0.135, 0.03, -0.045], [0.15, 0.35, 0.95]),
  earR: part([0.135, 0.03, -0.045], [0.15, -0.35, -0.95]),

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
      { z: 0, rx: 0.175, ry: 0.205 },
      { z: 0.35, rx: 0.155, ry: 0.185 },
      { z: 0.72, rx: 0.13, ry: 0.155 },
      { z: 1.0, rx: 0.105, ry: 0.12 },
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

const udderGeo = once(() => lumpGeometry(9001, 0.155, 0.14, 2));

/**
 * The skull. Rings run from behind the poll (-z) to the nose (+z): broad and
 * squarish across the cheeks, pinched at the bridge, then flaring back out into
 * a blunt muzzle. A cow head is short, deep and wide — build it long and tapered
 * and you get an anteater, which is exactly what the first attempt looked like.
 */
const skullGeo = once(() =>
  loft(
    [
      { z: -0.15, y: 0, rx: 0.115, ry: 0.115 },
      { z: -0.05, y: 0.005, rx: 0.148, ry: 0.142 },
      { z: 0.05, y: -0.012, rx: 0.152, ry: 0.138 },
      { z: 0.15, y: -0.038, rx: 0.13, ry: 0.124 },
      { z: 0.24, y: -0.06, rx: 0.114, ry: 0.11 },
      { z: 0.315, y: -0.072, rx: 0.114, ry: 0.106 },
      { z: 0.348, y: -0.075, rx: 0.11, ry: 0.102 },
    ],
    { radial: 22, segments: 42, square: 0.18 }
  )
);

/** The soft pad around the nostrils and lips — leathery, and a different colour. */
const muzzleGeo = once(() =>
  loft(
    [
      // starts inside the skull, comes out through it, and caps the nose
      { z: 0.3, y: -0.07, rx: 0.1, ry: 0.093 },
      { z: 0.352, y: -0.075, rx: 0.116, ry: 0.107 },
      { z: 0.392, y: -0.079, rx: 0.096, ry: 0.084 },
    ],
    { radial: 22, segments: 16, square: 0.18 }
  )
);

/** Lower jaw. Swings on the `jaw` part so the cow can chew. */
const jawGeo = once(() =>
  loft(
    [
      { z: -0.08, y: -0.02, rx: 0.105, ry: 0.06 },
      { z: 0.04, y: -0.046, rx: 0.108, ry: 0.062 },
      { z: 0.16, y: -0.062, rx: 0.095, ry: 0.054 },
      { z: 0.27, y: -0.072, rx: 0.086, ry: 0.048 },
      { z: 0.338, y: -0.076, rx: 0.076, ry: 0.042 },
    ],
    { radial: 16, segments: 20, square: 0.3 }
  )
);

/** A big soft leaf of an ear. Built along +z and swung outwards by its base rotation. */
const earGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.028, ry: 0.03 },
      { z: 0.05, rx: 0.055, ry: 0.032 },
      { z: 0.12, rx: 0.075, ry: 0.026 },
      { z: 0.19, rx: 0.062, ry: 0.019 },
      { z: 0.245, rx: 0.026, ry: 0.011 },
    ],
    { radial: 14, segments: 20 }
  )
);

const earInnerGeo = once(() =>
  loft(
    [
      { z: 0.045, rx: 0.032, ry: 0.016 },
      { z: 0.115, rx: 0.048, ry: 0.014 },
      { z: 0.185, rx: 0.036, ry: 0.01 },
      { z: 0.225, rx: 0.012, ry: 0.006 },
    ],
    { radial: 12, segments: 14, caps: false }
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

/** Leg bones. `seg` picks the length; the taper is what makes it look boned. */
const boneGeo = (len: number, top: number, waist: number, bottom: number) =>
  loft(
    [
      { z: 0, rx: top * 1.05, ry: top },
      { z: len * 0.3, rx: waist * 1.1, ry: waist },
      { z: len * 0.72, rx: waist * 0.94, ry: waist * 0.92 },
      { z: len, rx: bottom * 1.05, ry: bottom },
    ],
    { radial: 12, segments: 16 }
  );

const frontUpperGeo = once(() => boneGeo(FRONT_RIG.seg[0], 0.135, 0.098, 0.07));
const frontMidGeo = once(() => boneGeo(FRONT_RIG.seg[1], 0.072, 0.056, 0.046));
// The cannon stops short of the ground: the hoof caps it.
const frontCannonGeo = once(() => boneGeo(FRONT_RIG.seg[2] - 0.05, 0.048, 0.04, 0.043));
const backUpperGeo = once(() => boneGeo(BACK_RIG.seg[0], 0.15, 0.115, 0.072));
const backMidGeo = once(() => boneGeo(BACK_RIG.seg[1], 0.075, 0.055, 0.045));
const backCannonGeo = once(() => boneGeo(BACK_RIG.seg[2] - 0.05, 0.047, 0.039, 0.043));

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
      { z: HOOF_HEIGHT, y: 0.006, rx: 0.028, ry: 0.042 },
    ],
    { radial: 12, segments: 14 }
  )
);

const tailGeo = once(() =>
  loft(
    [
      { z: 0, rx: 0.045, ry: 0.045 },
      { z: 0.16, rx: 0.032, ry: 0.032 },
      { z: 0.3, rx: 0.024, ry: 0.024 },
    ],
    { radial: 10, segments: 12 }
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
      // The muzzle, teats and inner ear are all bare skin — pinker, and shinier
      // than hair, which is a surprisingly large part of looking like an animal.
      skin: new THREE.MeshStandardMaterial({ color: "#c98d94", roughness: 0.55 }),
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

  const activeGag = useCowStore((s) => s.activeGag);
  const gagStartedAt = useCowStore((s) => s.gagStartedAt);
  const inCutscene = useCowStore((s) => s.inCutscene);
  const grassEatenAt = useCowStore((s) => s.grassEatenAt);

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
      root.traverse((obj) => {
        if (obj.name) found[obj.name] = obj;
      });
      nodes.current = found;
    }
    const node = nodes.current;

    const dt = Math.min(delta, 0.05); // a long stall shouldn't teleport the cow
    const wasFacing = cowState.facing;
    const now = state.clock.elapsedTime;
    let pose: Pose;
    let chewing = 0;

    if (inCutscene && runnerRef.current) {
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
      // The pet gag ends by launching the cow at the camera, and how far that is
      // depends on where the camera happens to be — so it can't be keyframed.
      if (activeGag === "shy") pose = addPose(pose, kissLunge(elapsed, dt));
    } else {
      pose = drive(dt, now, grassEatenAt);
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
    blink(node, dt);
    breathe(now);
  });

  return (
    <group ref={pivotRef}>
      <group name="body">
        <mesh geometry={torsoGeo()} material={mats.hide} castShadow receiveShadow />
        <mesh geometry={dewlapGeo()} material={mats.hide} castShadow />
        {/* udder, tucked between the hind legs */}
        <group position={[0, 0.56, -0.26]}>
          <mesh geometry={udderGeo()} material={mats.pale} scale={[1, 0.85, 1.15]} castShadow />
          {[-0.06, 0.06].map((x) =>
            [-0.07, 0.06].map((z) => (
              <mesh key={`${x}${z}`} position={[x, -0.13, z]} material={mats.skin}>
                <cylinderGeometry args={[0.017, 0.013, 0.06, 7]} />
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
          <mesh geometry={muzzleGeo()} material={mats.skin} />

          {/* nostrils — comma-shaped, and they flare when the cow is cross */}
          <group ref={nostrilRef} position={[0, -0.062, 0.368]}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.042, 0.016, 0.028]}
                rotation={[0.3, 0, s * 0.6]}
                scale={[1, 1.6, 0.55]}
                material={mats.nostril}
              >
                <sphereGeometry args={[0.017, 10, 8]} />
              </mesh>
            ))}
          </group>
          <mesh ref={breathRef} position={[0, -0.08, 0.43]} material={mats.breath}>
            <sphereGeometry args={[0.07, 8, 8]} />
          </mesh>

          <group name="jaw" position={BASE.jaw.pos}>
            <mesh geometry={jawGeo()} material={mats.head} castShadow />
            {/* the lip line. A head with no mouth reads as a mask. */}
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.062, -0.052, 0.275]}
                rotation={[0.1, -s * 0.28, 0]}
                material={mats.nostril}
              >
                <boxGeometry args={[0.1, 0.009, 0.012]} />
              </mesh>
            ))}
          </group>

          {/* Eyes sit out on the sides of the head, the way a prey animal's do. */}
          {[-1, 1].map((s, i) => (
            <group key={s} position={[s * 0.124, 0.026, 0.028]} rotation={[0, s * 0.78, -s * 0.12]}>
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
                position={[s * 0.112, 0.098, 0.055]}
                rotation={[0.15, s * 0.55, -s * 0.5]}
                scale={[1, 0.42, 0.55]}
                material={mats.dark}
              >
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            ))}
          </group>

          <group name="earL" position={BASE.earL.pos} rotation={BASE.earL.rot}>
            <mesh geometry={earGeo()} material={mats.head} castShadow />
            <mesh geometry={earInnerGeo()} material={mats.skin} position={[0, 0.004, 0]} />
          </group>
          <group name="earR" position={BASE.earR.pos} rotation={BASE.earR.rot}>
            <mesh geometry={earGeo()} material={mats.head} castShadow />
            <mesh geometry={earInnerGeo()} material={mats.skin} position={[0, 0.004, 0]} />
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
          {/* poll tuft between the horns */}
          <mesh position={[0, 0.105, -0.045]} scale={[1.35, 0.55, 0.9]} material={mats.head}>
            <sphereGeometry args={[0.06, 12, 8]} />
          </mesh>

          <group name="blush" position={BASE.blush.pos} scale={BASE.blush.scale}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.135, -0.035, 0.11]} scale={[1, 0.7, 0.5]} material={mats.blush}>
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            ))}
          </group>
        </group>

        <CowLeg
          mats={mats}
          front
          hipName="legFL"
          kneeName="kneeFL"
          shinName="shinFL"
          hoofName="hoof0"
          sock
        />
        <CowLeg
          mats={mats}
          front
          mirror
          hipName="legFR"
          kneeName="kneeFR"
          shinName="shinFR"
          hoofName="hoof1"
        />
        <CowLeg
          mats={mats}
          hipName="legBL"
          kneeName="kneeBL"
          shinName="shinBL"
          hoofName="hoof2"
        />
        <CowLeg
          mats={mats}
          mirror
          hipName="legBR"
          kneeName="kneeBR"
          shinName="shinBR"
          hoofName="hoof3"
          sock
        />

        <group name="tail" position={BASE.tail.pos} rotation={BASE.tail.rot}>
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh geometry={tailGeo()} material={mats.hide} castShadow />
          </group>
          <group name="tailTip" position={BASE.tailTip.pos}>
            <group rotation={[Math.PI / 2, 0, 0]}>
              <mesh geometry={tailTipGeo()} material={mats.hide} />
              <mesh geometry={switchGeo()} material={mats.dark} position={[0, 0, 0.24]} castShadow />
            </group>
          </group>
        </group>
      </group>
    </group>
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
  sock = false,
  hipName,
  kneeName,
  shinName,
  hoofName,
}: {
  mats: Mats;
  front?: boolean;
  mirror?: boolean;
  sock?: boolean;
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
  // A couple of black socks, because a Holstein whose legs all match looks printed.
  const lower = sock ? mats.dark : mats.pale;
  const down: [number, number, number] = [Math.PI / 2, 0, 0];

  return (
    <group name={hipName} position={[x, hip[1], hip[2]]} rotation={[rest.hip, 0, 0]}>
      <group rotation={down}>
        <mesh geometry={upper} material={mats.hide} castShadow />
      </group>
      <group name={kneeName} position={[0, -rig.seg[0], 0]} rotation={[rest.knee, 0, 0]}>
        {/* the joint itself, filling the step between two bones */}
        <mesh scale={[0.92, 1.12, 1]} material={mats.pale} castShadow>
          <sphereGeometry args={[0.076, 12, 10]} />
        </mesh>
        <group rotation={down}>
          <mesh geometry={mid} material={mats.pale} castShadow />
        </group>
        <group name={shinName} position={[0, -rig.seg[1], 0]} rotation={[rest.shin, 0, 0]}>
          <group rotation={down}>
            <mesh geometry={cannon} material={lower} castShadow />
          </group>
          {/* fetlock joint, and the dewclaws behind it */}
          <mesh
            position={[0, -rig.seg[2] + 0.15, 0]}
            scale={[1, 1.15, 1.05]}
            material={lower}
            castShadow
          >
            <sphereGeometry args={[0.05, 10, 8]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * 0.025, -rig.seg[2] + 0.13, -0.038]}
              scale={[0.7, 1.3, 0.7]}
              material={mats.hoof}
            >
              <sphereGeometry args={[0.014, 8, 6]} />
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
 * Player-driven movement for one frame. Input is camera-relative — "up" always
 * means away from the camera, whichever way you've dragged it around.
 */
function drive(dt: number, now: number, grassEatenAt: (number | null)[]): Pose {
  const axis = moveAxis();
  let hitProp = false;

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

  // The fence is the whole point of the pen: you can't walk out of it. Walking
  // into it is a collision, so the cow stops dead and rocks forward on impact.
  const r = Math.hypot(cowState.x, cowState.z);
  if (r > PIT_INNER) {
    cowState.x = (cowState.x / r) * PIT_INNER;
    cowState.z = (cowState.z / r) * PIT_INNER;
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

  // The trough and the bales are solid too. Same idea as the fence, but pushing
  // straight out of a circle rather than back into one.
  for (const ob of OBSTACLES) {
    const ox = cowState.x - ob.x;
    const oz = cowState.z - ob.z;
    const d = Math.hypot(ox, oz);
    if (d > 0.0001 && d < ob.r) {
      cowState.x = ob.x + (ox / d) * ob.r;
      cowState.z = ob.z + (oz / d) * ob.r;
      if (!onProp) {
        onProp = true;
        kickSpring(cowPhysics.shoveZ, 0.4 * gait);
        kickSpring(cowPhysics.headPitch, 1.6 * gait);
      }
      cowState.speed *= 0.45;
      hitProp = true;
    }
  }
  if (!hitProp) onProp = false;

  // Contextual prompt: closest tuft still standing, within reach.
  let near: number | null = null;
  let best = INTERACT_RANGE;
  for (const spot of GRASS) {
    if (grassEatenAt[spot.id] !== null) continue;
    const d = Math.hypot(spot.x - cowState.x, spot.z - cowState.z);
    if (d < best) {
      best = d;
      near = spot.id;
    }
  }
  useCowStore.getState().setNearGrass(near);

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


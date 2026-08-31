// Secondary motion. Everything in here is a spring: a value that chases a target
// with mass behind it, so the head keeps travelling after the body stops, a slap
// whips it round and it wobbles back, and the tail lags behind a turn.
//
// Like `cowState` this is plain mutable module state — it changes every frame and
// nothing should re-render for it.

import { cowState } from "./cowState";
import { Pose } from "./poses";
import { WALK_SPEED } from "./world";

export interface Spring {
  value: number;
  vel: number;
  /** How hard it's pulled back to the target. Bigger = snappier. */
  stiffness: number;
  /** How fast the wobble dies. Below 2*sqrt(stiffness) it overshoots. */
  damping: number;
}

export function makeSpring(stiffness: number, damping: number): Spring {
  return { value: 0, vel: 0, stiffness, damping };
}

// Springs are integrated in small fixed slices so a long frame can't blow them up.
const MAX_SUB_STEP = 1 / 120;

export function stepSpring(s: Spring, target: number, dt: number): number {
  let left = Math.min(dt, 0.05);
  while (left > 0) {
    const h = Math.min(MAX_SUB_STEP, left);
    left -= h;
    const accel = (target - s.value) * s.stiffness - s.vel * s.damping;
    s.vel += accel * h;
    s.value += s.vel * h;
  }
  return s.value;
}

/** Hit a spring with an instant change of velocity — an impact, not a new target. */
export function kickSpring(s: Spring, impulse: number) {
  s.vel += impulse;
}

/**
 * The cow's soft bits. Under-damped on purpose: the head is meant to overshoot
 * and settle over two or three wobbles rather than snap to position.
 */
export const cowPhysics = {
  headPitch: makeSpring(150, 12),
  headYaw: makeSpring(110, 9),
  headRoll: makeSpring(130, 8),
  /** Body shove, in cow-local space: +x is the cow's right, +z is forward. */
  shoveX: makeSpring(190, 15),
  shoveZ: makeSpring(190, 15),
  /** Bank into a turn, plus whatever an impact adds. */
  lean: makeSpring(90, 13),
  tail: makeSpring(55, 5),
  earL: makeSpring(120, 7),
  earR: makeSpring(120, 7),
};

/** How long the cow stays visibly furious after a slap, in seconds. */
const ANGER_FADE = 7;

export function slapImpulse() {
  const p = cowPhysics;
  // Struck on its left cheek: the head snaps to the cow's right and rolls with it.
  kickSpring(p.headYaw, -9);
  kickSpring(p.headRoll, -11);
  kickSpring(p.headPitch, -3.5);
  kickSpring(p.shoveX, 2.2);
  kickSpring(p.shoveZ, -1.1);
  kickSpring(p.lean, -1.6);
  kickSpring(p.earL, 7);
  kickSpring(p.earR, 5);
  cowState.anger = 1;
}

export function kissImpulse() {
  const p = cowPhysics;
  kickSpring(p.headPitch, 2.4);
  kickSpring(p.earL, -3);
  kickSpring(p.earR, -3);
}

/** Reset the springs — used when a scene hands the body over to something else. */
export function relaxPhysics() {
  for (const s of Object.values(cowPhysics)) {
    s.value = 0;
    s.vel = 0;
  }
}

/**
 * Advance every spring one frame and hand back the pose layer they add up to.
 * Called in all three modes (free roam, gag, cutscene) so a slap landed during a
 * gag still wobbles out afterwards.
 */
export function stepCowPhysics(dt: number): Pose {
  const p = cowPhysics;
  const t = performance.now() / 1000;

  cowState.anger = Math.max(0, cowState.anger - dt / ANGER_FADE);
  const anger = cowState.anger;

  // Turning drags the head and tail behind, and leans the cow into the corner.
  const turn = Math.max(-8, Math.min(8, cowState.turnRate));
  const gait = Math.min(1, cowState.speed / WALK_SPEED);

  const headYaw = stepSpring(p.headYaw, -turn * 0.05, dt);
  const headRoll = stepSpring(p.headRoll, -turn * 0.02, dt);
  // Angry cows drop their heads. Breathing gets heavier with it.
  const breath = Math.sin(t * (2 + anger * 3)) * (0.012 + anger * 0.03);
  const headPitch = stepSpring(p.headPitch, anger * 0.16 + breath, dt);

  const lean = stepSpring(p.lean, -turn * 0.035 * gait, dt);
  const shoveX = stepSpring(p.shoveX, 0, dt);
  const shoveZ = stepSpring(p.shoveZ, 0, dt);

  // The tail is a pendulum: it trails the turn and flicks when the cow is cross.
  const tail = stepSpring(p.tail, -turn * 0.18 + Math.sin(t * 7) * 0.35 * anger, dt);

  // Ears are floppy, and pin backwards while the cow is angry.
  const earBack = -0.34 * anger;
  const earL = stepSpring(p.earL, earBack, dt);
  const earR = stepSpring(p.earR, earBack, dt);

  return {
    body: {
      pos: [shoveX, 0, shoveZ],
      rot: [0, 0, lean],
    },
    head: { rot: [headPitch, headYaw, headRoll] },
    tail: { rot: [0, tail, 0] },
    earL: { rot: [earL, 0, 0] },
    earR: { rot: [earR, 0, 0] },
    // The brows are scaled to nothing at rest, so anger just fades them in.
    brow: { scale: [anger, anger, anger] },
  };
}

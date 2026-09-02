// The splash-screen dance.
//
// Two ideas do all the work here, and they are deliberately kept apart:
//
//   1. CHOREOGRAPHY — a short keyframed loop that says where the hips should be
//      and when a foot should come off the ground. Nothing else. It is timed off
//      the reference clip rather than guessed: the character there does not
//      oscillate, it HOLDS still, snaps into a swing, holds again. Measured off
//      the footage, the rock is a 3.0s loop and each foot steps once every 1.5s,
//      while the head stays almost level — the bounce everyone thinks they see
//      is the feet coming up, not the body going down.
//
//   2. FLESH — every part below the hips-and-shoulders follows that
//      choreography through a spring, one link at a time. This is the whole
//      reason the cow stopped looking like a puppet. A puppet is what you get
//      when each joint is its own sine wave and they all hit their marks on the
//      same frame; an animal is what you get when a movement starts at the hips
//      and arrives at the ear tips a beat later, overshoots, and settles.
//
// So the choreography is small and readable, and none of it mentions ears,
// elbows or tail tips. Those are consequences.

import { addPoses, Pose, PartPose } from "./poses";
import {
  BACK_REST,
  BACK_RIG,
  LegAngles,
  solveLeg,
  standPose,
  STAND_HIND,
  STAND_HIP_Y,
  STAND_TILT,
} from "./locomotion";
import { makeSpring, Spring, stepSpring } from "./physics";

// ---------------------------------------------------------------------------
// choreography
// ---------------------------------------------------------------------------

/** Seconds for one full left-right-and-back rock. Measured: 75 frames @ 25fps. */
const LOOP = 3.0;
/** Seconds for one foot to lift, swing and plant again. Measured: ~1.54s. */
const STEP = 1.5;

type Key = [t: number, v: number];

/**
 * The rock, as a fraction of full lean: +1 is all the way onto the cow's right,
 * -1 all the way onto its left.
 *
 * These times come from tracking the head's horizontal position through the
 * reference clip frame by frame. The flat stretches are the important part and
 * are not padding — a dance that never stops moving reads as a wobble. It waits,
 * throws itself one way, drifts back, waits again, throws itself the other way.
 */
const SWAY: Key[] = [
  [0.00, 0.0],
  [0.28, 0.0], // wait
  [0.72, 1.0], // throw right
  [1.28, -0.18], // drift back through the middle
  [1.88, -0.15], // wait
  [2.12, -0.85], // throw left, faster and slightly shorter
  [2.80, 0.35], // come back with an overshoot
  [LOOP, 0.0],
];

/**
 * Sample a keyframed loop, easing between neighbours.
 *
 * Smoothstep rather than a straight line because the ease is doing real work:
 * a linear ramp between two holds still reads mechanical, and the whole point
 * of the holds is the contrast with the acceleration out of them.
 */
function sampleLoop(track: Key[], t: number): number {
  const u = ((t % LOOP) + LOOP) % LOOP;
  for (let i = 0; i < track.length - 1; i++) {
    const [t0, v0] = track[i];
    const [t1, v1] = track[i + 1];
    if (u >= t0 && u <= t1) {
      if (t1 === t0) return v1;
      const k = (u - t0) / (t1 - t0);
      return v0 + (v1 - v0) * k * k * (3 - 2 * k);
    }
  }
  return track[track.length - 1][1];
}

// ---------------------------------------------------------------------------
// flesh
// ---------------------------------------------------------------------------

/**
 * Step a chain of springs where each link chases the one above it, and give
 * back each link's LOCAL angle — its rotation relative to its own parent.
 *
 * The subtraction at the end is the part that matters. The cow is a transform
 * hierarchy, so when the body turns, the head is already carried round with it
 * for free. A head that is "lagging" therefore has to rotate BACKWARDS against
 * its parent by however much it has not caught up yet, and then unwind to zero
 * as it does. Skip that and you get a head welded to the shoulders, which is
 * exactly what a puppet is.
 *
 * `parent` is where the top of the chain is anchored: the body's own angle for
 * the spine, or zero for a limb whose root is being driven directly.
 */
function stepChain(links: Spring[], target: number, dt: number, parent = 0): number[] {
  const world: number[] = [];
  let above = target;
  for (const link of links) {
    above = stepSpring(link, above, dt);
    world.push(above);
  }
  const local: number[] = [];
  let prev = parent;
  for (const w of world) {
    local.push(w - prev);
    prev = w;
  }
  return local;
}

/**
 * Every spring in the dance.
 *
 * Damping is under 2*sqrt(stiffness) everywhere, so each one overshoots and
 * settles rather than sliding into place — and it loosens as you go outwards.
 * The shoulder is nearly stiff, the elbow is soft, the ear tips barely resist at
 * all. That gradient IS the follow-through; the numbers are the animation.
 */
const rig = {
  /** Head roll and yaw, then the ears trailing the head. */
  roll: [makeSpring(85, 11), makeSpring(38, 5)],
  yaw: [makeSpring(70, 10), makeSpring(34, 4.4)],
  /** The head's nod, hung off the step rather than the rock. */
  nod: [makeSpring(95, 12)],
  /** shoulder, elbow, wrist */
  armL: [makeSpring(130, 14), makeSpring(78, 9), makeSpring(46, 5.5)],
  armR: [makeSpring(130, 14), makeSpring(78, 9), makeSpring(46, 5.5)],
  /** How far each arm is held out from the ribs. Slower, so it lags the swing. */
  flareL: [makeSpring(60, 8.5), makeSpring(40, 5)],
  flareR: [makeSpring(60, 8.5), makeSpring(40, 5)],
  /** base, then tip */
  tail: [makeSpring(48, 6), makeSpring(28, 3.4)],
};

// ---------------------------------------------------------------------------
// the legs
// ---------------------------------------------------------------------------

/**
 * Resting fold in the elbow and the wrist while dancing. Deliberately shallow:
 * fold the elbow much past this and the forelegs come up across the chest and
 * the cow looks like it is hugging itself rather than dancing.
 */
const ELBOW_BEND = -0.28;
const WRIST_BEND = 0.22;

/** How high a hoof comes off the ground at the top of a step, in hip lengths. */
const LIFT = 0.085;
/** How far a foot travels fore and aft while it is up. */
const STRIDE = 0.1;
/** Fraction of a leg's cycle spent off the ground. Short: this is a shuffle. */
const UP = 0.3;

/**
 * One hind leg through its own step cycle, solved against the ground.
 *
 * `u` is 0..1 through this leg's cycle. It is planted for most of it and up for
 * a short burst, which is what small quick steps look like — the reference cow
 * has its feet close together and picks them up rather than striding.
 */
function stepLeg(u: number, hipY: number): LegAngles {
  const up = u < UP ? Math.sin((u / UP) * Math.PI) : 0;
  const lift = Math.pow(up, 0.7) * LIFT;
  // Forward while the hoof is up, easing back to neutral once it is down.
  const swing = up > 0 ? up * STRIDE : -STRIDE * 0.25 * (1 - (u - UP) / (1 - UP));
  return solveLeg(BACK_RIG, swing, (hipY / Math.cos(swing)) * (1 - lift));
}

/**
 * Both hind legs, converted out of world space and expressed as a delta from
 * what `standPose` already did — the same conversion `bipedWalk` does, and for
 * the same reason: skip it and the cow stamps through the road.
 */
function legs(t: number, hipY: number, amt: number): Pose {
  const left = stepLeg(((t / STEP) % 1 + 1) % 1, hipY);
  const right = stepLeg((((t / STEP) + 0.5) % 1 + 1) % 1, hipY);

  const hind = (a: LegAngles): [PartPose, PartPose, PartPose] => [
    { rot: [(a.hip - STAND_TILT - BACK_REST.hip - STAND_HIND.hip) * amt, 0, 0] },
    { rot: [(a.knee - BACK_REST.knee - STAND_HIND.knee) * amt, 0, 0] },
    { rot: [(a.shin - BACK_REST.shin - STAND_HIND.shin) * amt, 0, 0] },
  ];
  const [lH, lK, lS] = hind(left);
  const [rH, rK, rS] = hind(right);

  return { legBL: lH, kneeBL: lK, shinBL: lS, legBR: rH, kneeBR: rK, shinBR: rS };
}

// ---------------------------------------------------------------------------
// putting it together
// ---------------------------------------------------------------------------

/**
 * The routine. `t` is seconds on the wall clock, `dt` the frame time that steps
 * the springs, and `k` fades the whole thing in as the cow rears up and out
 * again when the player taps through.
 */
export function dancePose(t: number, dt: number, k = 1): Pose {
  if (k <= 0.001) return {};
  // Below k = 1 the cow is still on its way up, and throwing its weight around
  // mid-rear reads as a fall rather than a dance.
  const amt = Math.max(0, (k - 0.4) / 0.6);

  const sway = sampleLoop(SWAY, t) * amt;
  // Which foot is carrying, -1..1, from the step clock rather than the rock.
  const stepPhase = ((t / STEP) % 1 + 1) % 1;
  const weight = Math.sin(stepPhase * Math.PI * 2);

  // The hips barely rise and fall — measured, the head stays level and it is
  // the feet that move. A little dip as each foot lands is all it takes.
  const dip = -Math.abs(Math.sin(stepPhase * Math.PI)) * 0.035 * amt;
  const hipY = STAND_HIP_Y + dip;

  // --- what the choreography actually commands: the hips, and nothing else ---
  const bodyRoll = -sway * 0.16;
  const bodyYaw = sway * 0.2;

  // --- and what the flesh does about it ---
  const [headRoll, earRoll] = stepChain(rig.roll, bodyRoll * 1.7, dt, bodyRoll);
  const [headYaw, earYaw] = stepChain(rig.yaw, bodyYaw * -0.55, dt, bodyYaw);
  const [headNod] = stepChain(rig.nod, weight * 0.07 * amt, dt);

  // Arms. The shoulder is told where to go; the elbow and wrist find out late.
  // Each arm leads on the side the cow is rocking away from, which is what
  // makes the pair look like they are being thrown rather than pumped.
  const armDrive = (side: number) => -sway * side * 0.8 * amt - 0.1 * amt;
  const [shL, elL, wrL] = stepChain(rig.armL, armDrive(-1), dt);
  const [shR, elR, wrR] = stepChain(rig.armR, armDrive(1), dt);

  // How far the elbows are held out from the ribs. Lagged separately so the
  // arms open and close a beat behind the rock instead of with it.
  const flare = (0.55 + sway * 0.14) * amt;
  const [flL, flL2] = stepChain(rig.flareL, flare, dt);
  const [flR, flR2] = stepChain(rig.flareR, flare, dt);

  const [tailBase, tailTip] = stepChain(rig.tail, -sway * 0.6, dt);

  return addPoses(standPose(k), legs(t, hipY, amt), {
    body: {
      // A little lateral shift with the rock. Kept small on purpose: the leg
      // solver only works in the fore-and-aft plane, so anything the hips do
      // sideways slides the hooves rather than stepping them.
      pos: [sway * 0.035 * amt, dip, 0],
      rot: [0, bodyYaw, bodyRoll],
    },
    head: { rot: [headNod, headYaw, headRoll] },
    // The jaw is heavy and hinged and nobody is holding it shut.
    jaw: { rot: [Math.abs(weight) * 0.09 * amt, 0, 0] },
    earL: { rot: [0, earYaw, earRoll + flL2 * 0.3] },
    earR: { rot: [0, earYaw, earRoll - flR2 * 0.3] },
    // Shoulder carries the swing; elbow and wrist carry the lag.
    // ELBOW_BEND / WRIST_BEND are the posture; the spring output on top is the
    // life. Without a resting bend the forelegs read as two straight sticks
    // bolted to the ribs, which is most of what made this look like a puppet.
    legFL: { rot: [shL, 0, -flL] },
    kneeFL: { rot: [ELBOW_BEND * amt + elL, 0, 0] },
    shinFL: { rot: [WRIST_BEND * amt + wrL, 0, 0] },
    legFR: { rot: [shR, 0, flR] },
    kneeFR: { rot: [ELBOW_BEND * amt + elR, 0, 0] },
    shinFR: { rot: [WRIST_BEND * amt + wrR, 0, 0] },
    tail: { rot: [0, tailBase, 0] },
    tailTip: { rot: [0, tailTip, 0] },
    // brows up: it knows exactly what it is doing
    brow: { rot: [-0.16 * amt, 0, 0] },
  });
}

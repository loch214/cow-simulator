// How the cow stands, walks and rears up.
//
// The walk is not a keyframed cycle. Each leg is a three-link chain solved every
// frame so that the hoof lands **exactly on the ground and stays there** while
// the body travels over it. That one property is what separates an animal from a
// toy: nothing skates. See `solveLeg` for how it works, and `STRIDE_RATE` in
// lib/world.ts for the one constant that ties stride length to walking speed.

import { Pose, PartPose } from "./poses";
import { STRIDE_RATE, WALK_SPEED } from "./world";

// ---------------------------------------------------------------------------
// leg rig
// ---------------------------------------------------------------------------

/**
 * A leg, as the solver sees it: a pivot buried in the body at `hipY`, then three
 * bones. `bias` splits the total bend between the two lower joints — the front
 * leg carries most of its angle high up at the elbow, so the cannon bone below
 * the knee stays near-vertical, while the hind leg carries more of it low down,
 * which is what gives a cow its stuck-out hock.
 */
export interface LegRig {
  /** Where the pivot sits inside the body: out to the side, up, and fore/aft. */
  hipX: number;
  hipY: number;
  hipZ: number;
  seg: [number, number, number];
  bias: [number, number];
}

export const FRONT_RIG: LegRig = {
  hipX: 0.175, hipY: 0.8, hipZ: 0.5,
  seg: [0.34, 0.31, 0.27],
  bias: [0.64, 0.36],
};
export const BACK_RIG: LegRig = {
  hipX: 0.205, hipY: 0.78, hipZ: -0.5,
  seg: [0.33, 0.3, 0.27],
  bias: [0.44, 0.56],
};

/**
 * A leg has to fold somewhere to reach the ground, and which way it folds is the
 * whole silhouette. Folding **backwards** puts the elbow behind and under the
 * shoulder and the hock out behind the hip, which is what a cow looks like;
 * folding the other way gives you a bandy-legged dog.
 */
const BEND = -1;

/**
 * How far forward and back the leg swings, in radians off vertical. Everything
 * else about the gait falls out of this: the stride length is `hipY * tan(SWING)`
 * either side of the hip, and `STRIDE_RATE` is set so the planted hoof travels
 * backwards at exactly the speed the cow is travelling forwards.
 */
const SWING = 0.48;

/** How high the hoof is picked up mid-swing, as a fraction of leg length. */
const LIFT = 0.15;

/** How far the body drops onto each pair of hooves as they take the weight. */
const BOB = 0.035;

export interface LegAngles {
  hip: number;
  knee: number;
  shin: number;
}

/** Where the hoof ends up for a given total bend, in the leg's own frame. */
function chainEnd(rig: LegRig, bend: number): { len: number; angle: number } {
  const a1 = BEND * bend * rig.bias[0];
  const a2 = a1 + BEND * bend * rig.bias[1];
  // A joint at angle `a` points its bone along (0, -cos a, -sin a): straight down
  // at a = 0, swinging the hoof backwards as `a` grows.
  const y = -(rig.seg[0] + rig.seg[1] * Math.cos(a1) + rig.seg[2] * Math.cos(a2));
  const z = -(rig.seg[1] * Math.sin(a1) + rig.seg[2] * Math.sin(a2));
  return { len: Math.hypot(y, z), angle: Math.atan2(-z, -y) };
}

const REACH_MAX = (rig: LegRig) => rig.seg[0] + rig.seg[1] + rig.seg[2];

/**
 * Fold the leg until the hoof is `dist` from the hip, then rotate the whole
 * chain so the hoof sits at `swing` radians off vertical.
 *
 * Bending is monotonic — every extra degree brings the hoof closer to the hip —
 * so a dozen rounds of bisection nail it, and that is cheap enough to run for
 * four legs every frame. Solving it rather than keyframing it means the hoof can
 * be placed on the ground first and the joint angles worked out afterwards.
 */
export function solveLeg(rig: LegRig, swing: number, dist: number): LegAngles {
  const reach = REACH_MAX(rig);
  const want = Math.max(reach * 0.45, Math.min(reach * 0.999, dist));

  let lo = 0;
  let hi = 2.4;
  let end = chainEnd(rig, 0);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    end = chainEnd(rig, mid);
    if (end.len > want) lo = mid;
    else hi = mid;
  }
  const bend = (lo + hi) / 2;
  end = chainEnd(rig, bend);

  return {
    hip: swing - end.angle,
    knee: BEND * bend * rig.bias[0],
    shin: BEND * bend * rig.bias[1],
  };
}

/** Standing square, hooves flat on the ground. Everything else is a delta from this. */
export const FRONT_REST = solveLeg(FRONT_RIG, 0, FRONT_RIG.hipY);
export const BACK_REST = solveLeg(BACK_RIG, 0, BACK_RIG.hipY);

function legDelta(rest: LegAngles, now: LegAngles): [PartPose, PartPose, PartPose] {
  return [
    { rot: [now.hip - rest.hip, 0, 0] },
    { rot: [now.knee - rest.knee, 0, 0] },
    { rot: [now.shin - rest.shin, 0, 0] },
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * One leg's angles at stride phase `theta`, given the hip is currently `hipY`
 * above the ground.
 *
 * The first half of the cycle is stance: the hoof is on the ground and the hip
 * angle sweeps at a constant rate from front to back, which drags the body
 * forward over a planted foot. The second half is swing: the leg shortens, which
 * folds the knee and picks the hoof up on its own, and the angle eases back to
 * the front ready for the next footfall.
 */
function legCycle(rig: LegRig, theta: number, hipY: number): LegAngles {
  const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  if (t < Math.PI) {
    const u = t / Math.PI;
    const swing = -SWING + 2 * SWING * u;
    // straight down to the ground, however far that is from here
    return solveLeg(rig, swing, hipY / Math.cos(swing));
  }

  const u = (t - Math.PI) / Math.PI;
  const eased = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep
  const swing = SWING - 2 * SWING * eased;
  // Lifting the hoof is just asking for a shorter leg — the fold comes free.
  const lift = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.8);
  const ground = hipY / Math.cos(swing);
  return solveLeg(rig, swing, ground * (1 - LIFT * lift));
}

// ---------------------------------------------------------------------------
// idling
// ---------------------------------------------------------------------------

/**
 * Standing about. Breathing, the tail swing and the brows come from the springs
 * in lib/physics.ts, so what is left here is the slow business a real animal
 * never stops doing: shifting its weight from one side to the other, flicking an
 * ear at a fly, and chewing cud whether or not there is anything to chew.
 *
 * The "random" twitches are sums of sines at unrelated frequencies, so they never
 * repeat on a rhythm you can spot but need no state and no RNG.
 */
export function idlePose(t: number): Pose {
  const shift = Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.23 + 1.9) * 0.4;
  // sharp, occasional: mostly zero, spiking when the slow waves line up
  const flick = Math.max(0, Math.sin(t * 1.7) * Math.sin(t * 0.41 + 0.7) - 0.72) * 6;
  const flick2 = Math.max(0, Math.sin(t * 2.1 + 2) * Math.sin(t * 0.33) - 0.74) * 6;
  const cud = chewCycle(t * 1.35);

  return {
    // No vertical component: the legs are rigid while idling, so lifting the
    // body here would lift all four hooves off the ground together.
    body: {
      pos: [shift * 0.012, 0, 0],
      rot: [0, 0, -shift * 0.014],
    },
    head: {
      rot: [Math.sin(t * 0.61) * 0.05, Math.sin(t * 0.43) * 0.09, shift * 0.03],
      pos: [0, 0, 0],
    },
    jaw: { rot: [cud * 0.13, 0, 0] },
    earL: { rot: [flick * 0.5, 0, Math.sin(t * 3.1) * 0.04 - flick * 0.3] },
    earR: { rot: [flick2 * 0.5, 0, -Math.sin(t * 2.7 + 1) * 0.04 + flick2 * 0.3] },
    tail: { rot: [0, Math.sin(t * 0.9) * 0.1, 0] },
    tailTip: { rot: [0, Math.sin(t * 0.9 - 0.8) * 0.22, 0] },
  };
}

/** A chewing jaw: a slow grind, not an on/off flap. 0..1. */
export function chewCycle(t: number): number {
  return (Math.sin(t) * 0.5 + 0.5) * (0.75 + 0.25 * Math.sin(t * 0.5 + 1));
}

// ---------------------------------------------------------------------------
// the walk
// ---------------------------------------------------------------------------

/**
 * The whole quadruped, on the move. `amt` is speed as a fraction of `WALK_SPEED`
 * and only fades the gait in and out at the very bottom of the range — the size
 * of a stride must NOT scale with speed, or the planted hoof stops matching the
 * ground and the cow starts to skate. Speed changes the stride *rate* instead,
 * which is what `cowState.walkPhase` already does.
 *
 * The diagonal pairs move together, so this is a trot: front-left and back-right
 * are in phase, and the other two are half a cycle behind.
 */
export function quadWalk(phase: number, amt: number): Pose {
  const gait = smoothstep(0.05, 0.32, amt);
  if (gait <= 0.001) return {};

  // The body drops onto each pair of hooves as they take the weight, twice a
  // cycle, and the legs are solved against that height so the hooves stay put.
  const bob = -BOB * Math.abs(Math.cos(phase)) * gait;
  const roll = Math.sin(phase) * 0.055 * gait;
  const yaw = Math.sin(phase) * 0.05 * gait;
  const pitch = Math.sin(phase * 2) * 0.022 * gait;

  const front = FRONT_RIG.hipY + bob;
  const back = BACK_RIG.hipY + bob;

  const fl = legCycle(FRONT_RIG, phase, front);
  const fr = legCycle(FRONT_RIG, phase + Math.PI, front);
  const bl = legCycle(BACK_RIG, phase + Math.PI, back);
  const br = legCycle(BACK_RIG, phase, back);

  const blend = (rest: LegAngles, now: LegAngles) =>
    legDelta(rest, {
      hip: rest.hip + (now.hip - rest.hip) * gait,
      knee: rest.knee + (now.knee - rest.knee) * gait,
      shin: rest.shin + (now.shin - rest.shin) * gait,
    });

  const [flH, flK, flS] = blend(FRONT_REST, fl);
  const [frH, frK, frS] = blend(FRONT_REST, fr);
  const [blH, blK, blS] = blend(BACK_REST, bl);
  const [brH, brK, brS] = blend(BACK_REST, br);

  return {
    body: { pos: [0, bob, 0], rot: [pitch, yaw, roll] },
    legFL: flH, kneeFL: flK, shinFL: flS,
    legFR: frH, kneeFR: frK, shinFR: frS,
    legBL: blH, kneeBL: blK, shinBL: blS,
    legBR: brH, kneeBR: brK, shinBR: brS,
    // The head nods once per footfall and swings against the shoulders. A cow
    // walking with a rigid neck is the single most obvious tell of a fake animal.
    head: {
      rot: [Math.sin(phase * 2 + 0.6) * 0.055 * gait, -yaw * 1.3, -roll * 0.5],
      pos: [0, Math.sin(phase * 2) * 0.012 * gait, 0],
    },
    // Ears and tail are dead weight being thrown around by the body under them.
    earL: { rot: [Math.cos(phase * 2) * 0.16 * gait, 0, 0] },
    earR: { rot: [Math.cos(phase * 2 + 0.4) * 0.16 * gait, 0, 0] },
    tail: { rot: [Math.sin(phase * 2) * 0.05 * gait, Math.sin(phase * 0.9) * 0.3 * gait, 0] },
    tailTip: { rot: [0, Math.sin(phase * 0.9 - 1.1) * 0.45 * gait, 0] },
  };
}

// ---------------------------------------------------------------------------
// the rear-up
// ---------------------------------------------------------------------------

/**
 * How far the whole cow is tilted back when it rears up. Rotating the root about
 * X swings the torso (whose long axis is +Z, head end forward) up to vertical;
 * the back legs end up underneath as feet and the front legs end up as arms.
 * Every child part then gets the opposite rotation so heads and limbs still
 * point sensibly.
 */
export const STAND_TILT = -1.2;
// Solved numerically (see "Verifying without watching it" in HANDOFF.md) so the
// hind hooves land on y=0 and stay under the cow's own world position instead of
// sliding backwards as the torso swings up. Re-solve both if STAND_TILT changes.
const STAND_LIFT = 1.023;
const STAND_SHIFT = 0.688;

/** The rear-up itself. `k` goes 0 (on all fours) to 1 (fully upright). */
export function standPose(k: number): Pose {
  if (k <= 0.001) return {};
  const tilt = STAND_TILT * k;
  const counter = -tilt; // undo the root tilt on the parts that must stay upright

  // On two legs the hind legs have to come under the body and take all the
  // weight, so they crouch: more bend than standing square, split low down.
  const hind: PartPose[] = [
    { rot: [STAND_HIND.hip * k, 0, 0] },
    { rot: [STAND_HIND.knee * k, 0, 0] },
    { rot: [STAND_HIND.shin * k, 0, 0] },
  ];
  // Front legs become arms: shoulders back, elbows a little out from the body.
  const arm = (side: number): PartPose[] => [
    { rot: [counter - 0.42 * k, 0, side * 0.34 * k] },
    { rot: [-0.5 * k, 0, 0] },
    { rot: [-0.18 * k, 0, 0] },
  ];
  const [armLH, armLK, armLS] = arm(-1);
  const [armRH, armRK, armRS] = arm(1);

  return {
    body: { rot: [tilt, 0, 0], pos: [0, STAND_LIFT * k, STAND_SHIFT * k] },
    head: { rot: [counter * 0.94, 0, 0], pos: [0, 0, 0.04 * k] },
    legBL: hind[0], kneeBL: hind[1], shinBL: hind[2],
    legBR: hind[0], kneeBR: hind[1], shinBR: hind[2],
    legFL: armLH, kneeFL: armLK, shinFL: armLS,
    legFR: armRH, kneeFR: armRK, shinFR: armRS,
    tail: { rot: [-0.55 * k, 0, 0] },
    tailTip: { rot: [-0.3 * k, 0, 0] },
    earL: { rot: [-0.15 * k, 0, 0] },
    earR: { rot: [-0.15 * k, 0, 0] },
  };
}

/**
 * How high the hind hip ends up once the cow is fully upright: the hip's resting
 * offset swung through STAND_TILT, then raised by STAND_LIFT. It does not depend
 * on what the legs are doing, which is what lets the bipedal walk solve against
 * the ground the same way the quadruped one does.
 */
const STAND_HIP_Y =
  STAND_LIFT +
  BACK_RIG.hipY * Math.cos(STAND_TILT) -
  BACK_RIG.hipZ * Math.sin(STAND_TILT);

/** The hind-leg angles baked into `standPose` at k = 1, to measure the walk against. */
const STAND_HIND = {
  hip: -STAND_TILT * 0.62 - 0.1,
  knee: 0.34,
  shin: 0.3,
};

const BIPED_SWING = 0.44;
const BIPED_BOB = 0.05;

/** One hind leg through a bipedal stride, solved in world space. */
function bipedLeg(theta: number, hipY: number): LegAngles {
  const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (t < Math.PI) {
    const swing = -BIPED_SWING + 2 * BIPED_SWING * (t / Math.PI);
    return solveLeg(BACK_RIG, swing, hipY / Math.cos(swing));
  }
  const u = (t - Math.PI) / Math.PI;
  const eased = u * u * u * (u * (u * 6 - 15) + 10);
  const swing = BIPED_SWING - 2 * BIPED_SWING * eased;
  // picks its feet up higher than the quadruped walk — it is stamping
  const lift = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.8);
  return solveLeg(BACK_RIG, swing, (hipY / Math.cos(swing)) * (1 - 0.24 * lift));
}

/**
 * Two-legged stomping walk, layered on top of `standPose`. `amt` is how far up
 * the cow is, not how fast it is going.
 *
 * The hind legs are solved against the ground rather than swung by eye. Angles
 * come out of `solveLeg` in world space, so they are converted back into body
 * space (which the tilted torso has rotated by STAND_TILT) and expressed as a
 * delta from what `standPose` already did — otherwise the cow stamps its hooves
 * straight through the road.
 */
export function bipedWalk(phase: number, amt: number): Pose {
  if (amt <= 0.001) return {};
  const s = Math.sin(phase);
  const bob = -BIPED_BOB * Math.abs(Math.sin(phase));
  const hipY = STAND_HIP_Y + bob;

  const left = bipedLeg(phase, hipY);
  const right = bipedLeg(phase + Math.PI, hipY);

  // world angle -> body angle -> delta from the standing pose, faded in by `amt`
  const hind = (a: LegAngles): [PartPose, PartPose, PartPose] => [
    { rot: [(a.hip - STAND_TILT - BACK_REST.hip - STAND_HIND.hip) * amt, 0, 0] },
    { rot: [(a.knee - BACK_REST.knee - STAND_HIND.knee) * amt, 0, 0] },
    { rot: [(a.shin - BACK_REST.shin - STAND_HIND.shin) * amt, 0, 0] },
  ];
  const [lH, lK, lS] = hind(left);
  const [rH, rK, rS] = hind(right);

  return {
    body: {
      pos: [s * 0.02 * amt, bob * amt, 0],
      rot: [0, s * 0.07 * amt, s * 0.07 * amt],
    },
    legBL: lH, kneeBL: lK, shinBL: lS,
    legBR: rH, kneeBR: rK, shinBR: rS,
    // arms swing opposite the leg on the same side
    legFL: { rot: [-s * 0.5 * amt, 0, 0] },
    legFR: { rot: [s * 0.5 * amt, 0, 0] },
    kneeFL: { rot: [-Math.max(0, -s) * 0.35 * amt, 0, 0] },
    kneeFR: { rot: [-Math.max(0, s) * 0.35 * amt, 0, 0] },
    head: { rot: [0, -s * 0.06 * amt, s * 0.05 * amt] },
    tail: { rot: [0, s * 0.2 * amt, 0] },
    tailTip: { rot: [0, Math.sin(phase - 1) * 0.3 * amt, 0] },
  };
}

/** How hard the cow is working, 0..1 — used to pick a walk-cycle blend weight. */
export function gaitAmount(speed: number): number {
  return Math.min(1, speed / WALK_SPEED);
}

/** Stride phase advance for one frame, given how fast the cow is moving. */
export function stridePhase(phase: number, speed: number, dt: number): number {
  return phase + dt * speed * STRIDE_RATE;
}

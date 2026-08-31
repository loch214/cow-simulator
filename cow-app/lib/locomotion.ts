import { Pose } from "./poses";

/**
 * How far the whole cow is tilted back when it rears up. Rotating the root about
 * X swings the torso (whose long axis is +Z, head end forward) up to vertical;
 * the back legs end up underneath as feet and the front legs end up as arms.
 * Every child part then gets the opposite rotation so heads and limbs still
 * point sensibly.
 */
export const STAND_TILT = -1.25;
// Solved so the hind hooves land exactly on y=0 and stay under the cow's own
// world position instead of sliding backwards as the torso swings up.
const STAND_LIFT = 0.8;
const STAND_SHIFT = 0.33;

export function idlePose(t: number): Pose {
  return {
    body: { pos: [0, Math.sin(t * 1.5) * 0.02, 0] },
    tail: { rot: [0, Math.sin(t * 2) * 0.3, 0] },
    earL: { rot: [0, 0, Math.sin(t * 3) * 0.05] },
    earR: { rot: [0, 0, Math.sin(t * 3 + 1) * 0.05] },
    head: { rot: [Math.sin(t * 1.3) * 0.025, Math.sin(t * 0.7) * 0.05, 0] },
  };
}

/** Four-legged walk. `amt` fades the whole cycle in with speed. */
export function quadWalk(phase: number, amt: number): Pose {
  if (amt <= 0.001) return {};
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const swing = 0.55 * amt;
  return {
    body: {
      pos: [0, Math.abs(Math.sin(phase * 2)) * 0.05 * amt, 0],
      rot: [0, 0, s * 0.035 * amt],
    },
    // diagonal pairs move together, like a real cow's walk
    legFL: { rot: [s * swing, 0, 0] },
    legBR: { rot: [s * swing, 0, 0] },
    legFR: { rot: [-s * swing, 0, 0] },
    legBL: { rot: [-s * swing, 0, 0] },
    head: { rot: [Math.sin(phase * 2) * 0.06 * amt, 0, 0] },
    tail: { rot: [0, Math.sin(phase * 1.3) * 0.45 * amt, 0] },
    earL: { rot: [c * 0.12 * amt, 0, 0] },
    earR: { rot: [c * 0.12 * amt, 0, 0] },
  };
}

/** The rear-up itself. `k` goes 0 (on all fours) to 1 (fully upright). */
export function standPose(k: number): Pose {
  if (k <= 0.001) return {};
  const tilt = STAND_TILT * k;
  const counter = -tilt; // undo the root tilt on the parts that must stay upright
  return {
    body: { rot: [tilt, 0, 0], pos: [0, STAND_LIFT * k, STAND_SHIFT * k] },
    head: { rot: [counter * 0.92, 0, 0], pos: [0, 0, 0.06 * k] },
    legBL: { rot: [counter, 0, 0] },
    legBR: { rot: [counter, 0, 0] },
    // front legs become arms: hanging, elbows a little out from the body
    legFL: { rot: [counter - 0.35 * k, 0, -0.3 * k] },
    legFR: { rot: [counter - 0.35 * k, 0, 0.3 * k] },
    tail: { rot: [-0.5 * k, 0, 0] },
    earL: { rot: [-0.15 * k, 0, 0] },
    earR: { rot: [-0.15 * k, 0, 0] },
  };
}

/** Two-legged stomping walk, layered on top of `standPose`. */
export function bipedWalk(phase: number, amt: number): Pose {
  if (amt <= 0.001) return {};
  const s = Math.sin(phase);
  return {
    body: {
      pos: [0, Math.abs(Math.sin(phase * 2)) * 0.06 * amt, 0],
      rot: [0, 0, s * 0.06 * amt],
    },
    legBL: { rot: [s * 0.75 * amt, 0, 0] },
    legBR: { rot: [-s * 0.75 * amt, 0, 0] },
    // arms swing opposite the leg on the same side
    legFL: { rot: [-s * 0.55 * amt, 0, 0] },
    legFR: { rot: [s * 0.55 * amt, 0, 0] },
    head: { rot: [0, 0, s * 0.05 * amt] },
  };
}

/** Angry brow + head-down glare, used whenever the cow is furious. */
export const ANGRY_FACE: Pose = {
  brow: { scale: [1, 1, 1] },
};

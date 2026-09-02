// The splash-screen dance.
//
// This is the first thing anybody sees, so it is the cow doing the single most
// undignified thing the rig can do: up on its hind legs, stomping on the beat,
// throwing its front hooves around like arms.
//
// It reuses the machinery the game already has rather than inventing a second
// animation system — `standPose` rears the cow up, `bipedWalk` solves the hind
// legs against the ground so it stamps in place instead of skating through it,
// and everything here is one more additive layer on top of those two.

import { addPoses, Pose } from "./poses";
import { bipedWalk, standPose } from "./locomotion";

const TAU = Math.PI * 2;

/** Beats per minute. Fast enough to read as a dance, slow enough to follow. */
const BPM = 118;

/**
 * How far through the routine we are, in radians, one full turn per beat.
 * Derived from a wall clock rather than accumulated per-frame so a dropped
 * frame can't put the legs and the arms on different beats.
 */
function beatAt(t: number): number {
  return t * (BPM / 60) * TAU;
}

/**
 * The stomping legs. Two beats per step — a step on the one, a step on the
 * three — which is what makes it read as dancing rather than marching.
 */
function legs(beat: number): Pose {
  return bipedWalk(beat / 2, 1);
}

/**
 * Everything above the hips.
 *
 * Deltas here sit on top of what `standPose` already did, so the arm numbers
 * are "further than upright", not absolute. Note there is no `body.pos.y`
 * anywhere: `bipedWalk` owns the vertical, because it is the only thing here
 * that knows where the ground is. Bouncing the body from this layer would lift
 * both hooves off the field on every beat.
 */
function upper(beat: number): Pose {
  const half = beat / 2;
  // side to side, one full sweep every two beats
  const sway = Math.sin(half);
  const twist = Math.sin(half - 0.55);
  // A pulse that spikes on each beat and decays — the "hit" of the music.
  const pop = Math.pow(Math.abs(Math.sin(beat)), 0.55);

  // The arms alternate: one punches up while the other drops. Offset by a
  // quarter beat from the sway so the whole body isn't moving as one plank.
  const armL = Math.sin(half + 0.4);
  const armR = Math.sin(half + 0.4 + Math.PI);

  const arm = (side: number, k: number): Pose => {
    const up = (k + 1) / 2; // 0 = down by the ribs, 1 = hoof over the head
    const tag = side < 0 ? "L" : "R";
    return {
      [`legF${tag}`]: { rot: [-1.38 * up - 0.12, 0, side * (0.3 + 0.42 * up)] },
      [`kneeF${tag}`]: { rot: [-1.02 * up - 0.14, 0, 0] },
      [`shinF${tag}`]: { rot: [0.62 * up, 0, 0] },
    };
  };

  return addPoses(
    {
      // Lean into the sway and let the shoulders lead the hips slightly.
      body: { rot: [0.05 * pop - 0.025, twist * 0.2, -sway * 0.15] },
      // The head is on the offbeat, nodding against the body's roll. The
      // constant is chin-up (negative is up here, same as the flip-off pose):
      // reared this far back the muzzle otherwise points at its own feet.
      head: { rot: [0.14 * pop - 0.16, -twist * 0.26, sway * 0.12] },
      // chewing right through it, because of course it is
      jaw: { rot: [pop * 0.14, 0, 0] },
      // Ears thrown about by the head rather than posed — they're the loosest
      // thing on the cow and they should look it.
      earL: { rot: [-0.35 - armL * 0.4, 0, 0.22 + sway * 0.28] },
      earR: { rot: [-0.35 - armR * 0.4, 0, -0.22 + sway * 0.28] },
      // The tail keeps its own time, a half beat behind everything else.
      tail: { rot: [-0.25 - pop * 0.15, sway * 0.55, 0] },
      tailTip: { rot: [0, Math.sin(half - 1.1) * 0.8, 0] },
      // eyebrows up: it knows exactly what it's doing
      brow: { rot: [-0.18 - pop * 0.1, 0, 0] },
    },
    arm(-1, armL),
    arm(1, armR)
  );
}

/**
 * The whole routine at time `t` seconds. `k` fades it in from nothing, so the
 * cow can rise into it when the splash opens and settle back down when the
 * player taps to play.
 */
export function dancePose(t: number, k = 1): Pose {
  if (k <= 0.001) return {};
  const beat = beatAt(t);
  // Below k = 1 the cow is still on its way up, and swinging its arms around
  // mid-rear looks like a fall rather than a dance — so the upper body and the
  // stomp both fade in on the back half of the rise.
  const perform = Math.max(0, (k - 0.45) / 0.55);
  return addPoses(standPose(k), scale(legs(beat), perform), scale(upper(beat), perform));
}

/** How far the cow is off the ground, so the camera knows where to look. */
export function danceFocusHeight(k: number): number {
  return 1.05 + k * 0.95;
}

/** Multiply a pose layer's contribution. Local copy so `dance` owns its fades. */
function scale(pose: Pose, k: number): Pose {
  if (k >= 0.999) return pose;
  if (k <= 0.001) return {};
  const out: Pose = {};
  for (const [name, part] of Object.entries(pose)) {
    if (!part) continue;
    out[name as keyof Pose] = {
      pos: part.pos && [part.pos[0] * k, part.pos[1] * k, part.pos[2] * k],
      rot: part.rot && [part.rot[0] * k, part.rot[1] * k, part.rot[2] * k],
      scale: part.scale && [part.scale[0] * k, part.scale[1] * k, part.scale[2] * k],
    };
  }
  return out;
}

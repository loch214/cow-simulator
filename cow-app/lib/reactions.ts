import { Pose } from "./poses";

export interface Keyframe {
  t: number; // ms from gag start
  pose: Pose;
}

export interface ScriptStep {
  t: number; // ms from gag start
  say?: string;
  dynamicSay?: boolean; // store fills `say` from a line pool
  sound?: "smack" | "moo" | "chew" | "kiss" | "grunt";
  lips?: boolean; // stamp the lip mark on the screen
}

export interface GagDef {
  id: string;
  duration: number; // ms; gag returns to idle after this
  keyframes: Keyframe[];
  script: ScriptStep[];
}

/** ms the lip mark stays stuck to the screen once the cow plants it. */
export const LIP_MARK_DURATION = 4500;

// Slap: the head is NOT keyframed. It's thrown by a spring in lib/physics.ts so
// the whip and the wobble that follows are real motion, not a canned curve. What
// is keyframed is the rest of the body: the shoulder turn and the raised hoof.
const GLARE_AND_FLIP: Pose = {
  body: { rot: [0, 0.12, 0] },
  legFR: { rot: [-2.4, 0, 0.5] },
};

// Grazing keeps all four hooves down — the cow only ever rears up when it's
// storming off to the police station.
const headDown = (dip: number): Pose => ({
  head: { rot: [0.9, 0, 0], pos: [0, -0.4 - dip, 0.14] },
  earL: { rot: [-0.35, 0, 0] },
  earR: { rot: [-0.35, 0, 0] },
  body: { pos: [0, -0.03, 0.06] },
});

const BLUSH: Pose = { blush: { scale: [1, 1, 1] } };

/** Looking away, hooves shuffling. */
const COY: Pose = {
  head: { rot: [0.3, 0.34, 0], pos: [0, -0.06, 0] },
  earL: { rot: [-0.42, 0, 0] },
  earR: { rot: [-0.42, 0, 0] },
  body: { pos: [0, 0, -0.16] },
  blush: { scale: [1, 1, 1] },
};

/** The wind-up: weight back on the hind legs, chin coming up. */
const WIND_UP: Pose = {
  head: { rot: [-0.26, 0, 0], pos: [0, 0.06, 0] },
  earL: { rot: [-0.1, 0, 0] },
  earR: { rot: [-0.1, 0, 0] },
  body: { pos: [0, 0.02, -0.34], rot: [-0.06, 0, 0] },
  blush: { scale: [1, 1, 1] },
};

/**
 * Pressed flat against the lens. The head squashes sideways the way a face does
 * against glass, and the front hooves come up either side of it.
 */
const PUCKER: Pose = {
  head: { rot: [-0.12, 0, 0], pos: [0, 0, 0], scale: [0.14, -0.06, -0.1] },
  earL: { rot: [-0.5, 0, -0.2] },
  earR: { rot: [-0.5, 0, 0.2] },
  body: { pos: [0, 0, 0] },
  legFL: { rot: [-1.35, 0, -0.55] },
  legFR: { rot: [-1.35, 0, 0.55] },
  blush: { scale: [1, 1, 1] },
};

/** Milestones of the kiss, in ms from the start of the pet gag. */
export const KISS_LUNGE = 1000; // leaves the ground toward the camera
export const KISS_CONTACT = 1520; // lips hit the glass
export const KISS_HOLD = 1980; // ...and peel off again
export const KISS_BACK = 2620; // back on all fours

/**
 * How far along the lunge the cow is, 0 (in the pen) to 1 (nose on the lens).
 * This is a scalar rather than a keyframe because the distance the cow has to
 * travel depends on where the camera is — see `cameraLunge` in Cow.tsx.
 */
export function kissAmount(elapsed: number): number {
  if (elapsed <= KISS_LUNGE) return 0;
  if (elapsed < KISS_CONTACT) {
    // accelerating: it launches at you rather than gliding over
    const k = (elapsed - KISS_LUNGE) / (KISS_CONTACT - KISS_LUNGE);
    return k * k * (3 - 2 * k) * 0.55 + k * k * 0.45;
  }
  if (elapsed < KISS_HOLD) return 1;
  if (elapsed < KISS_BACK) {
    const k = (elapsed - KISS_HOLD) / (KISS_BACK - KISS_HOLD);
    return 1 - k * k * (3 - 2 * k);
  }
  return 0;
}

export const gags: Record<string, GagDef> = {
  // Triggered by walking onto a grass tuft and pressing E.
  eat: {
    id: "eat",
    duration: 4200,
    keyframes: [
      { t: 0, pose: {} },
      { t: 350, pose: headDown(0) },
      { t: 650, pose: headDown(0.06) },
      { t: 950, pose: headDown(0) },
      { t: 1250, pose: headDown(0.06) },
      { t: 1550, pose: headDown(0) },
      { t: 1850, pose: headDown(0.06) },
      { t: 2150, pose: headDown(0) },
      { t: 2450, pose: headDown(0.06) },
      { t: 2750, pose: headDown(0) },
      { t: 3100, pose: {} },
      { t: 3500, pose: { head: { rot: [-0.14, 0, 0] }, ...BLUSH } },
      { t: 4100, pose: {} },
    ],
    script: [
      { t: 350, sound: "chew" },
      { t: 950, sound: "chew" },
      { t: 1550, sound: "chew" },
      { t: 2150, sound: "chew" },
      { t: 2750, sound: "chew" },
      { t: 3100, say: "Mmm. Okay, you're alright.", sound: "moo" },
    ],
  },

  // Pet. Goes coy, then comes clean out of the screen and kisses the glass.
  shy: {
    id: "shy",
    duration: 3400,
    keyframes: [
      { t: 0, pose: {} },
      { t: 220, pose: COY },
      { t: 700, pose: COY },
      { t: 900, pose: WIND_UP },
      { t: 1000, pose: WIND_UP },
      { t: KISS_CONTACT, pose: PUCKER },
      { t: KISS_HOLD, pose: PUCKER },
      { t: KISS_BACK, pose: COY },
      { t: 3150, pose: COY },
      { t: 3400, pose: {} },
    ],
    script: [
      { t: 0, say: "Moooo~", sound: "moo" },
      // the jingle's smooch pop lands exactly on contact
      { t: 910, sound: "kiss" },
      { t: KISS_CONTACT, lips: true },
      { t: KISS_CONTACT + 60, say: "Mwah." },
      { t: KISS_BACK, say: "You've got a little something. Right there." },
    ],
  },

  slap: {
    id: "slap",
    duration: 2000,
    keyframes: [
      { t: 0, pose: {} },
      { t: 120, pose: { body: { pos: [0, 0, -0.05] } } },
      { t: 620, pose: GLARE_AND_FLIP },
      { t: 1650, pose: GLARE_AND_FLIP },
      { t: 1950, pose: {} },
    ],
    script: [
      { t: 0, sound: "smack" },
      { t: 90, sound: "grunt" },
      { t: 650, dynamicSay: true },
    ],
  },
};

export const insultLines = [
  "Try doing that again.",
  "You piece of shit.",
  "Real mature.",
  "Do that again, I dare you.",
  "Wow. Okay.",
  "That's assault.",
];

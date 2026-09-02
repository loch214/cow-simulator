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

/**
 * How long the slapping hand takes to reach the cheek, in ms.
 *
 * Everything about a slap — the head-spring kick, the camera shake, the crack —
 * used to happen on the frame you pressed the button, which left the hand in
 * `components/Hands.tsx` no time to travel and made the impact read as a hiccup
 * rather than a hit. Now the swing starts on the button and the impact lands
 * here, and every one of those four things is scheduled off this one number.
 */
export const SLAP_IMPACT = 190;

/**
 * Head snapped aside and the whole body rocked back off the blow.
 *
 * The body drop is small on purpose: the legs are rigid here, so every
 * centimetre it sinks is a centimetre of hoof buried in the field.
 */
const RECOIL: Pose = {
  body: { pos: [0, -0.008, -0.07], rot: [0.035, -0.06, 0] },
  // braced: it plants the near foreleg and takes the weight on it
  legFL: { rot: [0.18, 0, 0] },
  kneeFL: { rot: [-0.14, 0, 0] },
  legBL: { rot: [-0.1, 0, 0] },
  legBR: { rot: [-0.1, 0, 0] },
  earL: { rot: [-0.5, 0, 0.3] },
  earR: { rot: [-0.5, 0, -0.3] },
};

/**
 * The reply. The head is NOT keyframed here — it is thrown by a spring in
 * lib/physics.ts, so the whip and the wobble that follows are real motion rather
 * than a canned curve. What *is* keyframed is everything else: the cow squares
 * its shoulders, brings its front-right leg up in front of its chest, and the
 * hoof on the end of it turns out to be a hand.
 *
 * The arm is raised the way an arm is raised — the shoulder lifts, the elbow
 * folds under it and the forearm comes up vertical — rather than by swinging the
 * whole leg out straight, which reads as a cow falling over.
 *
 * `fist` is scaled to nothing everywhere else in the game; this is the only pose
 * that grows it. `Cow.tsx` hides the hoof for exactly as long as it is out.
 */
const FLIP_OFF: Pose = {
  // No lift: three hooves are still carrying this cow, and raising the body here
  // would take all three of them off the ground together.
  body: { rot: [0, 0.1, 0], pos: [0, -0.006, -0.05] },
  legFR: { rot: [-1.46, 0, 0.5] },
  kneeFR: { rot: [-1.05, 0, 0] },
  shinFR: { rot: [1.22, 0, 0] },
  fist: { scale: [1, 1, 1] },
  // the far foreleg takes the weight the raised one is no longer carrying
  legFL: { rot: [0.1, 0, 0] },
  // chin up, ears pinned back: this is not an apology
  head: { rot: [-0.12, 0, 0] },
  earL: { rot: [-0.62, 0, 0.18] },
  earR: { rot: [-0.62, 0, -0.18] },
  tail: { rot: [-0.2, 0, 0] },
};

/**
 * Halfway through raising the arm, and still holding a hoof.
 *
 * This keyframe exists purely so the hoof-for-hand swap happens somewhere it
 * cannot be seen. The swap is a hard cut — `aimFist` shows one or the other,
 * never both — so it has to land while the leg is at the top of its swing and
 * moving fast, not while the foot is still on the ground. Leaving `fist` out of
 * this pose keeps it scaled to nothing until the last 140 ms of the lift.
 */
const ARM_UP: Pose = {
  body: { rot: [0, 0.06, 0], pos: [0, -0.004, -0.04] },
  legFR: { rot: [-1.0, 0, 0.34] },
  kneeFR: { rot: [-0.86, 0, 0] },
  shinFR: { rot: [0.92, 0, 0] },
  legFL: { rot: [0.08, 0, 0] },
  head: { rot: [-0.08, 0, 0] },
  earL: { rot: [-0.5, 0, 0.14] },
  earR: { rot: [-0.5, 0, -0.14] },
};

// Grazing keeps all four hooves down — the cow only ever rears up when it's
// storming off to the police station.
/**
 * Head right down in the grass. The numbers are measured rather than eyeballed:
 * pitched 1.15 rad and dropped 0.40, the muzzle sits a few centimetres off the
 * ground at the bottom of each dip — in the grass, not through it. The neck is
 * not keyframed at all — it is drawn
 * between the chest and wherever the head ended up (see `stretchNeck`), so it
 * reaches down of its own accord.
 */
const headDown = (dip: number): Pose => ({
  head: { rot: [1.15, 0, 0], pos: [0, -0.46 - dip, 0.03] },
  // ears go out sideways and down, the way they do when a cow has its head in
  // something it likes
  earL: { rot: [-0.15, 0, 0.45] },
  earR: { rot: [-0.15, 0, -0.45] },
  jaw: { rot: [0.12, 0, 0] },
  // weight forward onto the front legs
  body: { pos: [0, -0.035, 0.05], rot: [0.045, 0, 0] },
  legFL: { rot: [0.12, 0, 0] },
  legFR: { rot: [0.12, 0, 0] },
});

const BLUSH: Pose = { blush: { scale: [1, 1, 1] } };

/** Looking away, hooves shuffling. */
const COY: Pose = {
  head: { rot: [0.34, 0.42, -0.12], pos: [0, -0.07, -0.03] },
  earL: { rot: [-0.42, 0, 0.25] },
  earR: { rot: [-0.42, 0, -0.25] },
  body: { pos: [0, 0, -0.2], rot: [0, 0.06, 0] },
  tail: { rot: [0, 0.5, 0] },
  tailTip: { rot: [0, 0.6, 0] },
  blush: { scale: [1, 1, 1] },
};

/** The wind-up: weight back on the hind legs, chin coming up. */
const WIND_UP: Pose = {
  head: { rot: [-0.3, 0, 0], pos: [0, 0.08, -0.04] },
  earL: { rot: [-0.1, 0, 0] },
  earR: { rot: [-0.1, 0, 0] },
  body: { pos: [0, 0.02, -0.38], rot: [-0.09, 0, 0] },
  // coiled: the hind legs load up before the launch
  legBL: { rot: [0.3, 0, 0] },
  legBR: { rot: [0.3, 0, 0] },
  kneeBL: { rot: [-0.3, 0, 0] },
  kneeBR: { rot: [-0.3, 0, 0] },
  blush: { scale: [1, 1, 1] },
};

/**
 * Pressed flat against the lens. The head squashes sideways the way a face does
 * against glass, and the front hooves come up either side of it.
 */
const PUCKER: Pose = {
  head: { rot: [-0.14, 0, 0], pos: [0, 0, 0], scale: [0.18, -0.08, -0.12] },
  jaw: { rot: [-0.1, 0, 0] },
  earL: { rot: [-0.55, 0, -0.3] },
  earR: { rot: [-0.55, 0, 0.3] },
  body: { pos: [0, 0, 0] },
  // front hooves come up either side of the lens
  legFL: { rot: [-1.5, 0, -0.5] },
  legFR: { rot: [-1.5, 0, 0.5] },
  kneeFL: { rot: [-0.7, 0, 0] },
  kneeFR: { rot: [-0.7, 0, 0] },
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
    duration: 2600,
    keyframes: [
      // Nothing happens until the hand actually arrives. The cow is standing
      // there, unaware, for the whole of the wind-up.
      { t: 0, pose: {} },
      { t: SLAP_IMPACT, pose: {} },
      { t: SLAP_IMPACT + 90, pose: RECOIL },
      { t: SLAP_IMPACT + 320, pose: RECOIL },
      { t: 780, pose: ARM_UP },
      { t: 900, pose: FLIP_OFF },
      { t: 2200, pose: FLIP_OFF },
      { t: 2550, pose: {} },
    ],
    script: [
      { t: SLAP_IMPACT, sound: "smack" },
      { t: SLAP_IMPACT + 90, sound: "grunt" },
      { t: 980, dynamicSay: true },
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
  "Guess what this is.",
  "Yeah. Read it and weep.",
  "Bet you thought I didn't have one of these.",
];

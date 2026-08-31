import { Pose } from "./poses";

export interface Keyframe {
  t: number; // ms from gag start
  pose: Pose;
}

export interface ScriptStep {
  t: number; // ms from gag start
  say?: string;
  dynamicSay?: boolean; // store fills `say` from a line pool
  sound?: "smack" | "moo" | "chew" | "kiss";
  lips?: boolean; // show the giant lip mark overlay
}

export interface GagDef {
  id: string;
  duration: number; // ms; gag returns to idle after this
  keyframes: Keyframe[];
  script: ScriptStep[];
}

export const LIP_MARK_DURATION = 3500; // ms the lip mark stays on screen once shown

const GLARE_AND_FLIP: Pose = {
  head: { rot: [-0.22, 0, 0] },
  body: { rot: [0, 0.1, 0] },
  legFR: { rot: [-2.4, 0, 0.5] },
  brow: { scale: [1, 1, 1] },
};

// Grazing keeps all four hooves down — the cow only ever rears up when it's
// storming off to the police station.
const headDown = (dip: number): Pose => ({
  head: { rot: [0.9, 0, 0], pos: [0, -0.4 - dip, 0.14] },
  earL: { rot: [-0.35, 0, 0] },
  earR: { rot: [-0.35, 0, 0] },
  body: { pos: [0, -0.03, 0.06] },
});

const FLIRTY: Pose = {
  head: { rot: [-0.05, 0, 0.18] },
  earL: { rot: [0, 0, 0.2] },
  earR: { rot: [0, 0, -0.2] },
};

const LUNGE: Pose = {
  body: { pos: [0, 0.05, 1.7], scale: [1.3, 1.3, 1.3] },
};

export const gags: Record<string, GagDef> = {
  // Triggered by walking onto a grass tuft and pressing E.
  eat: {
    id: "eat",
    duration: 5200,
    keyframes: [
      { t: 0, pose: {} },
      { t: 350, pose: headDown(0) },
      { t: 650, pose: headDown(0.06) },
      { t: 950, pose: headDown(0) },
      { t: 1250, pose: headDown(0.06) },
      { t: 1550, pose: headDown(0) },
      { t: 1850, pose: headDown(0.06) },
      { t: 2150, pose: headDown(0) },
      { t: 2500, pose: {} },
      { t: 2900, pose: FLIRTY },
      { t: 3300, pose: FLIRTY },
      { t: 3650, pose: LUNGE },
      { t: 4400, pose: LUNGE },
      { t: 5100, pose: {} },
    ],
    script: [
      { t: 350, sound: "chew" },
      { t: 950, sound: "chew" },
      { t: 1550, sound: "chew" },
      { t: 2150, sound: "chew" },
      { t: 2500, say: "Mmm. Okay, you're alright.", sound: "moo" },
      { t: 2900, sound: "kiss" },
      { t: 3650, lips: true, sound: "kiss" },
    ],
  },

  shy: {
    id: "shy",
    duration: 2100,
    keyframes: [
      { t: 0, pose: {} },
      {
        t: 200,
        pose: {
          head: { rot: [0.32, 0.16, 0], pos: [0, -0.08, 0] },
          earL: { rot: [-0.4, 0, 0] },
          earR: { rot: [-0.4, 0, 0] },
          blush: { scale: [1, 1, 1] },
        },
      },
      { t: 450, pose: { body: { pos: [0, 0, -0.18] } } },
      {
        t: 1700,
        pose: {
          head: { rot: [0.32, 0.16, 0], pos: [0, -0.08, 0] },
          earL: { rot: [-0.4, 0, 0] },
          earR: { rot: [-0.4, 0, 0] },
          blush: { scale: [1, 1, 1] },
          body: { pos: [0, 0, -0.18] },
        },
      },
      { t: 2000, pose: {} },
    ],
    script: [{ t: 0, say: "Moooo~", sound: "moo" }],
  },

  slap: {
    id: "slap",
    duration: 1900,
    keyframes: [
      { t: 0, pose: { head: { rot: [-0.08, 0, 0.08] }, body: { pos: [0, 0, -0.08] } } },
      { t: 550, pose: GLARE_AND_FLIP },
      { t: 1500, pose: GLARE_AND_FLIP },
      { t: 1800, pose: {} },
    ],
    script: [
      { t: 0, sound: "smack" },
      { t: 600, dynamicSay: true },
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

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
};

export const gags: Record<string, GagDef> = {
  kiss: {
    id: "kiss",
    duration: 3400,
    keyframes: [
      { t: 0, pose: {} },
      { t: 250, pose: { head: { rot: [0.12, 0, 0] } } },
      { t: 500, pose: { head: { rot: [-0.04, 0, 0] } } },
      { t: 750, pose: { head: { rot: [0.12, 0, 0] } } },
      {
        t: 1000,
        pose: { head: { rot: [-0.05, 0, 0.18] }, earL: { rot: [0, 0, 0.2] }, earR: { rot: [0, 0, -0.2] } },
      },
      {
        t: 1550,
        pose: { head: { rot: [-0.05, 0, 0.18] }, earL: { rot: [0, 0, 0.2] }, earR: { rot: [0, 0, -0.2] } },
      },
      {
        t: 1900,
        pose: { body: { pos: [0, 0.05, 1.7], scale: [1.3, 1.3, 1.3] }, head: { rot: [0, 0, 0] } },
      },
      {
        t: 2650,
        pose: { body: { pos: [0, 0.05, 1.7], scale: [1.3, 1.3, 1.3] }, head: { rot: [0, 0, 0] } },
      },
      { t: 3300, pose: {} },
    ],
    script: [
      { t: 50, sound: "chew" },
      { t: 1000, sound: "kiss" },
      { t: 1900, lips: true, sound: "kiss" },
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

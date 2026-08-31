// The fifth-slap payoff: the cow rears up, lets itself out of the gate, walks to
// the police station, files a complaint with a lot of arm-waving, and comes home.
//
// This runs as a per-frame state machine over `cowState` rather than a pile of
// setTimeouts, so it can't drift out of sync with the animation and it survives
// a dropped frame or a backgrounded tab.
//
// The one rule the whole thing is built around: NOTHING advances while somebody
// is still talking. Every spoken line books a slot of time (`runner.hold`) long
// enough to read it, and no phase may end until that slot is over. That's why
// the complaint is written as a list of beats — each beat owns its line AND the
// gestures that go with it, so the arm-waving can't drift off the words.

import { addPoses, Pose, PoseKey, samplePose } from "./poses";
import { bipedWalk, standPose } from "./locomotion";
import { approach, cowState, turnToward } from "./cowState";
import { OFFICER, WAYPOINTS } from "./world";

export type Phase =
  | "rise"
  | "toGate"
  | "openGate"
  | "toStation"
  | "complain"
  | "backToGate"
  | "backInside"
  | "closeGate"
  | "settle"
  | "done";

export type Speaker = "cow" | "officer";

const ANGRY_SPEED = 2.6;
const HOME_SPEED = 2.5;

/** How long a line stays up: roughly how long it takes to read it out loud. */
export function readingMs(text: string): number {
  return Math.max(1400, Math.min(4600, 700 + text.length * 45));
}

export interface CutsceneRunner {
  phase: Phase;
  t: number; // ms spent in the current phase
  said: number; // index of the last line delivered in this phase
  beat: number; // index into COMPLAINT while at the station
  beatT: number; // ms spent in the current beat
  hold: number; // ms of talking still owed before this phase may end
}

export function newRunner(): CutsceneRunner {
  return { phase: "rise", t: 0, said: -1, beat: -1, beatT: 0, hold: 0 };
}

/**
 * One exchange at the desk: a line, and the gestures that belong to that line.
 * Gesture times are relative to the START OF THE BEAT, so rewriting a line (or
 * giving a slower reader longer) can't slide the arms out of sync with it.
 */
interface Beat {
  who: Speaker;
  line: string;
  /** Defaults to the reading time of the line. */
  ms?: number;
  gestures?: PoseKey[];
}

// Arm poses. These layer on top of the standing pose, where the front legs have
// become arms hanging at the cow's sides. Negative rot.x throws an arm up and
// forward; positive points it backwards.
const ARMS_DOWN: Pose = {};
const ARMS_UP: Pose = {
  legFL: { rot: [-1.5, 0, -0.4] },
  legFR: { rot: [-1.5, 0, 0.4] },
  head: { rot: [0.1, 0, 0] },
};
const ARMS_FOLDED: Pose = {
  legFL: { rot: [-1.25, 0, -0.95] },
  legFR: { rot: [-1.25, 0, 0.95] },
};

const COMPLAINT: Beat[] = [
  {
    who: "cow",
    line: "Officer. I'd like to report an assault.",
    gestures: [
      { t: 0, pose: ARMS_DOWN },
      { t: 420, pose: ARMS_UP },
      {
        t: 1100,
        pose: {
          legFL: { rot: [-1.1, 0, -0.5] },
          legFR: { rot: [-1.1, 0, 0.5] },
          head: { rot: [0, 0.25, 0] },
        },
      },
      { t: 2200, pose: ARMS_DOWN },
    ],
  },
  {
    who: "cow",
    line: "FIVE times. In my own field.",
    // jabs a hoof back down the road toward the pen
    gestures: [
      { t: 0, pose: ARMS_DOWN },
      {
        t: 260,
        pose: {
          legFR: { rot: [1.5, 0, 0.2] },
          legFL: { rot: [-0.4, 0, -0.2] },
          body: { rot: [0, 0.3, 0] },
          head: { rot: [0, -0.3, 0] },
        },
      },
      {
        t: 900,
        pose: {
          legFR: { rot: [1.9, 0, 0.2] },
          legFL: { rot: [-0.4, 0, -0.2] },
          body: { rot: [0, 0.35, 0] },
          head: { rot: [0, -0.35, 0] },
        },
      },
      {
        t: 1700,
        pose: { legFL: { rot: [-0.9, 0, -0.8] }, legFR: { rot: [-0.9, 0, 0.8] } },
      },
      { t: 2200, pose: ARMS_DOWN },
    ],
  },
  {
    who: "cow",
    line: "Just — WHACK. Right on the face. Like this.",
    // mimes the slap on its own face, twice
    gestures: [
      { t: 0, pose: ARMS_DOWN },
      { t: 700, pose: { legFR: { rot: [-1.9, 0, 0.9] } } },
      { t: 860, pose: { legFR: { rot: [-1.4, 0, -0.5] }, head: { rot: [0, 0, -0.3] } } },
      { t: 1400, pose: { legFR: { rot: [-1.9, 0, 0.9] } } },
      { t: 1560, pose: { legFR: { rot: [-1.4, 0, -0.5] }, head: { rot: [0, 0, -0.3] } } },
      { t: 2200, pose: ARMS_DOWN },
    ],
  },
  {
    who: "cow",
    line: "I want it on the record.",
    // one hoof tapping an imaginary desk
    gestures: [
      { t: 0, pose: ARMS_DOWN },
      { t: 300, pose: { legFL: { rot: [-1.6, 0, -0.2] } } },
      { t: 620, pose: { legFL: { rot: [-1.2, 0, -0.2] } } },
      { t: 940, pose: { legFL: { rot: [-1.6, 0, -0.2] } } },
      { t: 1260, pose: { legFL: { rot: [-1.2, 0, -0.2] } } },
      { t: 1800, pose: ARMS_DOWN },
    ],
  },
  {
    who: "officer",
    line: "…Uh huh. And you are a cow.",
    // the cow has to stand there and take it
    gestures: [
      { t: 0, pose: ARMS_FOLDED },
      { t: 1200, pose: { ...ARMS_FOLDED, head: { rot: [0.15, 0, 0] } } },
      { t: 2200, pose: ARMS_FOLDED },
    ],
  },
  {
    who: "cow",
    line: "That is EXACTLY my point.",
    gestures: [
      { t: 0, pose: ARMS_FOLDED },
      {
        t: 260,
        pose: {
          legFL: { rot: [-1.5, 0, -1.1] },
          legFR: { rot: [-1.5, 0, 1.1] },
          head: { rot: [-0.15, 0, 0] },
        },
      },
      { t: 1400, pose: ARMS_DOWN },
    ],
  },
  {
    who: "officer",
    line: "Right. I'll file it under livestock dispute.",
    gestures: [
      { t: 0, pose: ARMS_FOLDED },
      { t: 1800, pose: ARMS_FOLDED },
    ],
  },
];

const NO_GESTURE: PoseKey[] = [{ t: 0, pose: {} }];

function beatLength(b: Beat): number {
  return b.ms ?? readingMs(b.line);
}

/** Head shake / nod overlay so the cow isn't a statue while it's talking. */
function chatter(tMs: number): Pose {
  const t = tMs / 1000;
  return { head: { rot: [Math.sin(t * 5.5) * 0.05, Math.sin(t * 3.1) * 0.16, 0] } };
}

/** Slow, grudging nod while the officer does the talking. */
function listening(tMs: number): Pose {
  const t = tMs / 1000;
  return { head: { rot: [0.06 + Math.sin(t * 1.6) * 0.06, Math.sin(t * 0.9) * 0.05, 0] } };
}

function seek(tx: number, tz: number, speed: number, dt: number): boolean {
  const dx = tx - cowState.x;
  const dz = tz - cowState.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.14) {
    cowState.speed = 0;
    return true;
  }
  const step = Math.min(speed * dt, dist);
  cowState.x += (dx / dist) * step;
  cowState.z += (dz / dist) * step;
  cowState.facing = turnToward(cowState.facing, Math.atan2(dx, dz), 6 * dt);
  cowState.speed = speed;
  return false;
}

function faceToward(tx: number, tz: number, dt: number) {
  cowState.facing = turnToward(
    cowState.facing,
    Math.atan2(tx - cowState.x, tz - cowState.z),
    5 * dt
  );
}

export interface StepResult {
  pose: Pose;
  /** Set only on the frame a new line starts. */
  say?: string;
  speaker?: Speaker;
  sound?: "creak";
  finished: boolean;
}

/**
 * Advance the cutscene by `dt` seconds. Mutates `cowState` and returns the pose
 * to draw, plus a line of dialogue on the frames where a new one starts.
 */
export function stepCutscene(runner: CutsceneRunner, dt: number): StepResult {
  const ms = dt * 1000;
  runner.t += ms;
  runner.hold = Math.max(0, runner.hold - ms);
  // The cow stays furious for the whole trip. It is not going to calm down on
  // the way there.
  cowState.anger = 1;

  let say: string | undefined;
  let speaker: Speaker | undefined;
  let sound: StepResult["sound"];

  const next = (phase: Phase) => {
    runner.phase = phase;
    runner.t = 0;
    runner.said = -1;
    runner.beat = -1;
    runner.beatT = 0;
  };

  /** Say a line, and book enough time to read it before anything may move on. */
  const speak = (text: string, who: Speaker = "cow", forMs?: number) => {
    say = text;
    speaker = who;
    runner.hold = Math.max(runner.hold, forMs ?? readingMs(text));
  };

  /** A phase may only end once its talking is done. */
  const quiet = () => runner.hold <= 0;

  switch (runner.phase) {
    case "rise":
      cowState.speed = 0;
      faceToward(WAYPOINTS.gateInside.x, WAYPOINTS.gateInside.z, dt);
      cowState.stand = approach(cowState.stand, 1, dt / 0.9);
      if (runner.said < 0) {
        runner.said = 0;
        speak("Right. RIGHT. That's it.");
      }
      if (cowState.stand >= 1 && runner.t > 900 && quiet()) next("toGate");
      break;

    case "toGate":
      if (seek(WAYPOINTS.gateInside.x, WAYPOINTS.gateInside.z, ANGRY_SPEED, dt) && quiet()) {
        next("openGate");
      }
      break;

    case "openGate":
      cowState.speed = 0;
      if (runner.said < 0) {
        runner.said = 0;
        sound = "creak";
      }
      cowState.gateOpen = approach(cowState.gateOpen, 1, dt / 0.7);
      if (runner.t > 850 && quiet()) next("toStation");
      break;

    case "toStation":
      if (runner.t > 400 && runner.said < 0) {
        runner.said = 0;
        speak("I'm reporting this.");
      }
      if (seek(WAYPOINTS.stationFront.x, WAYPOINTS.stationFront.z, ANGRY_SPEED, dt) && quiet()) {
        next("complain");
      }
      break;

    case "complain": {
      cowState.speed = 0;
      faceToward(OFFICER.x, OFFICER.z, dt);
      runner.beatT += ms;

      // Start the first beat, then only step to the next once the current line
      // has had its full slot. This is the bit that used to run ahead of the
      // dialogue and leave halfway through the conversation.
      if (runner.beat < 0) {
        runner.beat = 0;
        runner.beatT = 0;
        speak(COMPLAINT[0].line, COMPLAINT[0].who);
      } else if (runner.beatT >= beatLength(COMPLAINT[runner.beat]) && quiet()) {
        if (runner.beat < COMPLAINT.length - 1) {
          runner.beat++;
          runner.beatT = 0;
          speak(COMPLAINT[runner.beat].line, COMPLAINT[runner.beat].who);
        } else if (runner.beatT >= beatLength(COMPLAINT[runner.beat]) + 600) {
          next("backToGate");
        }
      }
      break;
    }

    case "backToGate":
      if (runner.t > 300 && runner.said < 0) {
        runner.said = 0;
        speak("They're looking into it.");
      }
      if (seek(WAYPOINTS.gateOutside.x, WAYPOINTS.gateOutside.z, HOME_SPEED, dt) && quiet()) {
        next("backInside");
      }
      break;

    case "backInside":
      if (runner.t > 500 && runner.said < 0) {
        runner.said = 0;
        speak("Case number and everything.");
      }
      if (seek(WAYPOINTS.penCentre.x, WAYPOINTS.penCentre.z, HOME_SPEED, dt) && quiet()) {
        next("closeGate");
      }
      break;

    case "closeGate":
      cowState.speed = 0;
      if (runner.said < 0) {
        runner.said = 0;
        sound = "creak";
      }
      cowState.gateOpen = approach(cowState.gateOpen, 0, dt / 0.6);
      if (cowState.gateOpen <= 0 && quiet()) next("settle");
      break;

    case "settle":
      cowState.speed = 0;
      cowState.stand = approach(cowState.stand, 0, dt / 0.7);
      if (cowState.stand <= 0 && runner.said < 0) {
        runner.said = 0;
        speak("Don't. Just don't.");
      }
      if (cowState.stand <= 0 && quiet()) next("done");
      break;

    case "done":
      cowState.speed = 0;
      break;
  }

  const layers: Pose[] = [standPose(cowState.stand)];
  if (cowState.speed > 0.01) layers.push(bipedWalk(cowState.walkPhase, cowState.stand));
  if (runner.phase === "complain" && runner.beat >= 0) {
    const beat = COMPLAINT[runner.beat];
    layers.push(samplePose(beat.gestures ?? NO_GESTURE, runner.beatT));
    layers.push(beat.who === "cow" ? chatter(runner.beatT) : listening(runner.beatT));
  }

  return {
    pose: addPoses(...layers),
    say,
    speaker,
    sound,
    finished: runner.phase === "done" && runner.t > 600,
  };
}

/** Who is doing the talking right now, so the officer can animate to match. */
export function currentSpeaker(runner: CutsceneRunner | null): Speaker | null {
  if (!runner || runner.phase !== "complain" || runner.beat < 0) return null;
  return COMPLAINT[runner.beat].who;
}

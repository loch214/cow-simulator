// The fifth-slap payoff: the cow rears up, lets itself out of the gate, walks to
// the police station, files a complaint with a lot of arm-waving, and comes home.
//
// This runs as a per-frame state machine over `cowState` rather than a pile of
// setTimeouts, so it can't drift out of sync with the animation and it survives
// a dropped frame or a backgrounded tab.

import { addPoses, Pose, samplePose } from "./poses";
import { ANGRY_FACE, bipedWalk, standPose } from "./locomotion";
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

const ANGRY_SPEED = 2.6;
const HOME_SPEED = 2.5;

export interface CutsceneRunner {
  phase: Phase;
  t: number; // ms spent in the current phase
  said: number; // index of the last line delivered in this phase
}

export function newRunner(): CutsceneRunner {
  return { phase: "rise", t: 0, said: -1 };
}

/** Lines the cow delivers at the desk, with the officer's reply mixed in. */
const COMPLAINT: { t: number; line: string }[] = [
  { t: 200, line: "Officer. I'd like to report an assault." },
  { t: 1900, line: "FIVE times. In my own field." },
  { t: 3600, line: "Just — WHACK. Right on the face. Like this." },
  { t: 5300, line: "I want it on the record." },
  { t: 6600, line: "\u{1F46E} …Uh huh. And you are a cow." },
  { t: 8100, line: "That is EXACTLY my point." },
];
const COMPLAIN_MS = 9000;

/**
 * Arm gestures during the complaint. These layer on top of the standing pose, so
 * the front legs (now arms) start hanging and these rotations swing them around.
 * Negative rot.x on an arm throws it forward/up; positive points it backwards.
 */
const GESTURES: { t: number; pose: Pose }[] = [
  { t: 0, pose: {} },
  // "report an assault" - both arms up, exasperated
  { t: 500, pose: { legFL: { rot: [-1.5, 0, -0.4] }, legFR: { rot: [-1.5, 0, 0.4] }, head: { rot: [0.1, 0, 0] } } },
  { t: 1200, pose: { legFL: { rot: [-1.1, 0, -0.5] }, legFR: { rot: [-1.1, 0, 0.5] }, head: { rot: [0, 0.25, 0] } } },
  // "FIVE times" - jabs a hoof back toward the pen
  { t: 2000, pose: { legFR: { rot: [1.5, 0, 0.2] }, legFL: { rot: [-0.4, 0, -0.2] }, body: { rot: [0, 0.3, 0] }, head: { rot: [0, -0.3, 0] } } },
  { t: 2600, pose: { legFR: { rot: [1.9, 0, 0.2] }, legFL: { rot: [-0.4, 0, -0.2] }, body: { rot: [0, 0.35, 0] }, head: { rot: [0, -0.35, 0] } } },
  { t: 3300, pose: { legFL: { rot: [-0.9, 0, -0.8] }, legFR: { rot: [-0.9, 0, 0.8] } } },
  // "Just - WHACK" - mimes the slap on its own face, twice
  { t: 3800, pose: { legFR: { rot: [-1.9, 0, 0.9] } } },
  { t: 3950, pose: { legFR: { rot: [-1.4, 0, -0.5] }, head: { rot: [0, 0, -0.3] } } },
  { t: 4400, pose: { legFR: { rot: [-1.9, 0, 0.9] } } },
  { t: 4550, pose: { legFR: { rot: [-1.4, 0, -0.5] }, head: { rot: [0, 0, -0.3] } } },
  { t: 5000, pose: {} },
  // "on the record" - one hoof tapping the imaginary desk
  { t: 5400, pose: { legFL: { rot: [-1.6, 0, -0.2] } } },
  { t: 5700, pose: { legFL: { rot: [-1.2, 0, -0.2] } } },
  { t: 6000, pose: { legFL: { rot: [-1.6, 0, -0.2] } } },
  { t: 6400, pose: { legFL: { rot: [-1.2, 0, -0.2] } } },
  // listening to the officer, arms folded
  { t: 6900, pose: { legFL: { rot: [-1.25, 0, -0.95] }, legFR: { rot: [-1.25, 0, 0.95] } } },
  { t: 8100, pose: { legFL: { rot: [-1.25, 0, -0.95] }, legFR: { rot: [-1.25, 0, 0.95] }, head: { rot: [0.15, 0, 0] } } },
  // "EXACTLY my point" - both arms flung out
  { t: 8400, pose: { legFL: { rot: [-1.5, 0, -1.1] }, legFR: { rot: [-1.5, 0, 1.1] }, head: { rot: [-0.15, 0, 0] } } },
  { t: 9200, pose: {} },
];

/** Head shake / nod overlay so the cow isn't a statue between gestures. */
function chatter(tMs: number): Pose {
  const t = tMs / 1000;
  return { head: { rot: [Math.sin(t * 5.5) * 0.05, Math.sin(t * 3.1) * 0.16, 0] } };
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
  say?: string;
  finished: boolean;
}

/**
 * Advance the cutscene by `dt` seconds. Mutates `cowState` and returns the pose
 * to draw, plus a line of dialogue on the frames where a new one starts.
 */
export function stepCutscene(runner: CutsceneRunner, dt: number): StepResult {
  runner.t += dt * 1000;
  let say: string | undefined;
  const next = (phase: Phase) => {
    runner.phase = phase;
    runner.t = 0;
    runner.said = -1;
  };

  switch (runner.phase) {
    case "rise":
      cowState.speed = 0;
      faceToward(WAYPOINTS.gateInside.x, WAYPOINTS.gateInside.z, dt);
      cowState.stand = approach(cowState.stand, 1, dt / 0.9);
      if (runner.said < 0) {
        runner.said = 0;
        say = "Right. RIGHT. That's it.";
      }
      if (cowState.stand >= 1 && runner.t > 900) next("toGate");
      break;

    case "toGate":
      if (seek(WAYPOINTS.gateInside.x, WAYPOINTS.gateInside.z, ANGRY_SPEED, dt)) {
        next("openGate");
      }
      break;

    case "openGate":
      cowState.speed = 0;
      cowState.gateOpen = approach(cowState.gateOpen, 1, dt / 0.7);
      if (runner.t > 850) next("toStation");
      break;

    case "toStation":
      if (runner.t > 400 && runner.said < 0) {
        runner.said = 0;
        say = "I'm reporting this.";
      }
      if (seek(WAYPOINTS.stationFront.x, WAYPOINTS.stationFront.z, ANGRY_SPEED, dt)) {
        next("complain");
      }
      break;

    case "complain":
      cowState.speed = 0;
      faceToward(OFFICER.x, OFFICER.z, dt);
      for (let i = 0; i < COMPLAINT.length; i++) {
        if (runner.t >= COMPLAINT[i].t && runner.said < i) {
          runner.said = i;
          say = COMPLAINT[i].line;
        }
      }
      if (runner.t > COMPLAIN_MS) next("backToGate");
      break;

    case "backToGate":
      if (runner.t > 300 && runner.said < 0) {
        runner.said = 0;
        say = "They're looking into it.";
      }
      if (seek(WAYPOINTS.gateOutside.x, WAYPOINTS.gateOutside.z, HOME_SPEED, dt)) {
        next("backInside");
      }
      break;

    case "backInside":
      if (runner.t > 500 && runner.said < 0) {
        runner.said = 0;
        say = "Case number and everything.";
      }
      if (seek(WAYPOINTS.penCentre.x, WAYPOINTS.penCentre.z, HOME_SPEED, dt)) {
        next("closeGate");
      }
      break;

    case "closeGate":
      cowState.speed = 0;
      cowState.gateOpen = approach(cowState.gateOpen, 0, dt / 0.6);
      if (cowState.gateOpen <= 0) next("settle");
      break;

    case "settle":
      cowState.speed = 0;
      cowState.stand = approach(cowState.stand, 0, dt / 0.7);
      if (cowState.stand <= 0) {
        next("done");
        say = "Don't. Just don't.";
      }
      break;

    case "done":
      cowState.speed = 0;
      break;
  }

  const layers: Pose[] = [standPose(cowState.stand), ANGRY_FACE];
  if (cowState.speed > 0.01) layers.push(bipedWalk(cowState.walkPhase, cowState.stand));
  if (runner.phase === "complain") {
    layers.push(samplePose(GESTURES, runner.t), chatter(runner.t));
  }

  return {
    pose: addPoses(...layers),
    say,
    finished: runner.phase === "done" && runner.t > 1200,
  };
}

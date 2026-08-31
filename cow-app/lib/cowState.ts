// Per-frame cow state. This deliberately lives OUTSIDE React/zustand: it changes
// 60 times a second and nothing should re-render because of it. The camera, the
// gate and the cutscene all read and write this same mutable object.

import { WAYPOINTS } from "./world";

export const cowState = {
  x: WAYPOINTS.penCentre.x,
  z: WAYPOINTS.penCentre.z,
  /** Yaw in radians. The cow model faces +Z at yaw 0. */
  facing: Math.PI,
  /** Current planar speed in units/sec — drives how hard the walk cycle plays. */
  speed: 0,
  /** Accumulated walk-cycle angle so the legs never snap when speed changes. */
  walkPhase: 0,
  /** 0 = on all fours, 1 = reared up on the hind legs. */
  stand: 0,
  /** 0 = gate shut, 1 = gate swung wide. */
  gateOpen: 0,
  /** True while the cutscene is driving the cow; player input is ignored. */
  scripted: false,
};

export function resetCowState() {
  cowState.x = WAYPOINTS.penCentre.x;
  cowState.z = WAYPOINTS.penCentre.z;
  cowState.facing = Math.PI;
  cowState.speed = 0;
  cowState.stand = 0;
  cowState.gateOpen = 0;
  cowState.scripted = false;
}

/** Shortest-path turn from `from` toward `to`, capped at `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return to;
  return from + Math.sign(diff) * maxStep;
}

export function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

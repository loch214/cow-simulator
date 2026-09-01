// Static layout of the world. Everything that other modules need to agree on
// (where the fence is, where the gate is, where the grass grows) lives here so
// the pen can be extended later without hunting through components.

export const PIT_RADIUS = 7;
/**
 * How close the cow's centre can get to the fence before it's stopped. The cow
 * is about 2 units nose to tail, so this keeps the barrel off the rails — the
 * head still leans over them, which is exactly what cows do to fences.
 */
export const PIT_INNER = PIT_RADIUS - 1.15;

/** The gate sits on the +X side of the ring. */
export const GATE_WIDTH = 2.2;

/** How tall the fence posts stand. The rails are hung off this. */
export const FENCE_HEIGHT = 1.32;

export const WAYPOINTS = {
  gateInside: { x: PIT_RADIUS - 1.5, z: 0 },
  gateOutside: { x: PIT_RADIUS + 1.6, z: 0 },
  // Far enough back that the cow does not stand *inside* the officer once it
  // rears up: the rear-up shifts the whole body forward by STAND_SHIFT.
  stationFront: { x: 14.2, z: 0 },
  penCentre: { x: 1.8, z: 0.8 },
};

export const STATION = { x: 19, z: 0 };
// Out on the step, not standing in his own doorway (the front wall is at
// STATION.x - 2.7), and far enough from `stationFront` that a reared-up cow
// still has room to wave its hooves about.
export const OFFICER = { x: 15.9, z: 0.85 };

export interface GrassSpot {
  id: number;
  x: number;
  z: number;
}

export const GRASS: GrassSpot[] = [
  { id: 0, x: -3.1, z: 2.4 },
  { id: 1, x: 1.9, z: 4 },
  { id: 2, x: 4.1, z: -2.8 },
  { id: 3, x: -4.3, z: -2.1 },
  { id: 4, x: -0.8, z: -4.3 },
];

/**
 * Things in the pen the cow cannot walk through, as circles on the ground. Both
 * the models and the collision read this list, so a trough can never be moved in
 * one place and left behind in the other.
 */
export interface Obstacle {
  x: number;
  z: number;
  /** Includes the cow's own girth, so this is the distance its centre is held off. */
  r: number;
  spin?: number;
}

export const OBSTACLES: Obstacle[] = [
  { x: -3.4, z: 3.6, r: 0.95 }, // water trough
  { x: -5.4, z: -3, r: 0.95, spin: 0.4 }, // hay bales
  { x: 9.2, z: -5.6, r: 0.95, spin: 1.9 },
  { x: 10.1, z: -4.4, r: 0.95, spin: 0.2 },
];

/** Cow must be this close to a grass tuft for the eat prompt to appear. */
export const INTERACT_RANGE = 1.5;
/** How long a nibbled tuft takes to grow back, in ms. */
export const REGROW_MS = 14000;

/** Slaps needed before the cow gives up and files a police report. */
export const SLAPS_BEFORE_POLICE = 5;

export const WALK_SPEED = 2.3;
export const TURN_SPEED = 7;

/**
 * How fast the stride clock runs, per unit of walking speed. This is NOT a taste
 * setting: it is solved from the leg geometry in lib/locomotion.ts as
 * `PI / (2 * hipY * SWING)`, which is the rate at which a hoof planted on the
 * ground travels backwards at exactly the speed the cow travels forwards. Change
 * the leg length or the swing angle and this has to be re-derived, or the cow
 * will start to skate.
 */
export const STRIDE_RATE = 4.14;

// Static layout of the world. Everything that other modules need to agree on
// (where the fence is, where the gate is, where the grass grows) lives here so
// the pen can be extended later without hunting through components.

export const PIT_RADIUS = 5.5;
/** How close the cow's centre can get to the fence before it's stopped. */
export const PIT_INNER = PIT_RADIUS - 0.7;

/** The gate sits on the +X side of the ring. */
export const GATE_WIDTH = 1.8;

export const WAYPOINTS = {
  gateInside: { x: PIT_RADIUS - 1.3, z: 0 },
  gateOutside: { x: PIT_RADIUS + 1.3, z: 0 },
  stationFront: { x: 12.6, z: 0 },
  penCentre: { x: 1.6, z: 0.6 },
};

export const STATION = { x: 16.5, z: 0 };
export const OFFICER = { x: 13.9, z: 0.7 };

export interface GrassSpot {
  id: number;
  x: number;
  z: number;
}

export const GRASS: GrassSpot[] = [
  { id: 0, x: -2.4, z: 1.9 },
  { id: 1, x: 1.5, z: 3.1 },
  { id: 2, x: 3.2, z: -2.2 },
  { id: 3, x: -3.4, z: -1.6 },
  { id: 4, x: -0.6, z: -3.4 },
];

/** Cow must be this close to a grass tuft for the eat prompt to appear. */
export const INTERACT_RANGE = 1.15;
/** How long a nibbled tuft takes to grow back, in ms. */
export const REGROW_MS = 14000;

/** Slaps needed before the cow gives up and files a police report. */
export const SLAPS_BEFORE_POLICE = 5;

export const WALK_SPEED = 2.3;
export const TURN_SPEED = 9;

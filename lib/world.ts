// Static layout of the world. Everything that other modules need to agree on
// (where the fence is, where the gate is, where the grass grows) lives here so
// the pen can be extended later without hunting through components.

import { rng } from "./rand";

export const PIT_RADIUS = 7;
/**
 * How close the cow's centre can get to the fence before it's stopped. The cow
 * is about 2 units nose to tail, so this keeps the barrel off the rails — the
 * head still leans over them, which is exactly what cows do to fences.
 */
export const PIT_INNER = PIT_RADIUS - 1.15;

/** The gate sits on the +X side of the ring. */
export const GATE_WIDTH = 2.8;

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
export const SLAPS_BEFORE_POLICE = 4;

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

// ---------------------------------------------------------------------------
// outside the pen
//
// The pen used to be the whole game, so "you can't leave" was one line of
// arithmetic: clamp the cow's distance from the origin. Now the gate opens, so
// the fence has to be a ring **with a hole in it**, and everything out in the
// field has to be solid — otherwise the moment the cow gets out it walks
// through the trees, through the pond and straight through the police station.
// ---------------------------------------------------------------------------

/** How far the cow may wander from the middle of the world. */
export const WORLD_RADIUS = 30;

/** Roughly the cow's own girth. Every clearance below is measured off it. */
export const COW_GIRTH = 0.5;

/**
 * How wide the doorway is *for the cow's centre*, as a half-angle around the
 * ring. Narrower than the gate itself by the cow's girth, so it can't clip a
 * gate post on the way through.
 */
export const GATE_HALF_ANGLE = (GATE_WIDTH / 2 - COW_GIRTH - 0.05) / PIT_RADIUS;

/** How close the cow's centre can get to the fence from OUTSIDE the ring. */
export const PIT_OUTER = PIT_RADIUS + COW_GIRTH + 0.35;

/** Where the gate is, in the world. Used for the prompt and the cutscene. */
export const GATE_POINT = { x: PIT_RADIUS, z: 0 };

// --- things out in the field ----------------------------------------------

/** A circle on the ground that something is held out of. */
export interface Solid {
  x: number;
  z: number;
  /** Includes the cow's girth: this is how far its centre is held off. */
  r: number;
}

export const SCARECROW = { x: -4.6, z: 13.8 };
export const POND = { x: 14.5, z: -12.2, r: 3.3 };
/**
 * The speed camera, on the verge at the far end of the road.
 *
 * It used to sit at x=11.4, four metres past the gate, which meant it went off
 * before the player had finished noticing they were outside — the gag fired as
 * part of leaving the pen rather than as its own thing. Down here it belongs to
 * the station, which is whose camera it would be, and the cow has to have got
 * up to speed to trip it.
 */
export const SPEED_TRAP = { x: 12.4, z: 1.9 };
/** How fast the cow has to be going past it to set it off. */
export const SPEED_LIMIT = 1.9;
/**
 * How close it has to be to notice. Tight, so you can creep past it — but it
 * has to be bigger than `SPEED_TRAP.z`, or a cow running down the middle of
 * the road never comes inside it and the camera can only catch one that drives
 * along the verge.
 */
export const SPEED_TRAP_RANGE = 2.6;

/** Where the flock starts. They wander from here and run from the cow. */
export const SHEEP_HOME = { x: -15, z: -9 };

/**
 * The trees, as a fixed list rather than a random scatter. It lives here rather
 * than in `Environment.tsx` for the same reason `OBSTACLES` does: the model and
 * the collision have to read the same numbers or the cow walks through a trunk.
 */
export interface TreeSpot {
  x: number;
  z: number;
  kind: number;
  scale: number;
  spin: number;
}

/**
 * Places nothing else is allowed to be planted, and how much room each needs.
 * A tree in the middle of the pond is the sort of thing a hand-placed list gets
 * wrong once and then keeps getting wrong, so the list filters itself.
 */
const CLEARINGS: Solid[] = [
  { x: POND.x, z: POND.z, r: POND.r + 1.2 },
  { x: SCARECROW.x, z: SCARECROW.z, r: 2.6 },
  { x: SPEED_TRAP.x, z: SPEED_TRAP.z, r: 2.4 },
];

export const TREES: TreeSpot[] = (() => {
  const r = rng(1234);
  const ring: [number, number][] = [
    [-13, -7], [-16, 5], [-9, 14], [5, -15], [14, -12],
    [11, 13], [21, 10], [25, -9], [-3, 18], [28, 4],
    [-21, -14], [18, 18], [-24, 8], [7, 22], [-14, -19],
    [30, -16], [24, 20], [-29, -3],
  ];
  return ring
    .map(([x, z]) => ({
      x: x + (r() - 0.5) * 2,
      z: z + (r() - 0.5) * 2,
      kind: Math.floor(r() * 4),
      scale: 0.85 + r() * 0.7,
      spin: r() * Math.PI * 2,
    }))
    .filter((t) => !CLEARINGS.some((c) => Math.hypot(t.x - c.x, t.z - c.z) < c.r));
})();

/**
 * Everything solid in the world, as circles. Built once from the same tables
 * the models are built from.
 */
export const SOLIDS: Solid[] = [
  ...OBSTACLES.map((o) => ({ x: o.x, z: o.z, r: o.r })),
  ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.42 * t.scale + COW_GIRTH })),
  { x: SCARECROW.x, z: SCARECROW.z, r: 0.55 },
  { x: SPEED_TRAP.x, z: SPEED_TRAP.z, r: 0.5 },
  // The officer. He is not going to move out of the way.
  { x: OFFICER.x, z: OFFICER.z, r: 0.85 },
];

/**
 * The police station, as a box. A building is the one thing in the world that a
 * circle is a bad fit for: the smallest circle round it either lets the cow
 * into a corner or holds it off the wall by two metres.
 */
export const STATION_BOX = {
  x: STATION.x,
  z: STATION.z,
  hw: 5.4 / 2 + 0.15 + COW_GIRTH,
  hd: 6.4 / 2 + 0.15 + COW_GIRTH,
};

/** Push a point out of the station's footprint, along whichever face is nearest. */
function pushOutOfStation(x: number, z: number): { x: number; z: number; hit: boolean } {
  const dx = x - STATION_BOX.x;
  const dz = z - STATION_BOX.z;
  const ox = STATION_BOX.hw - Math.abs(dx);
  const oz = STATION_BOX.hd - Math.abs(dz);
  if (ox <= 0 || oz <= 0) return { x, z, hit: false };
  if (ox < oz) return { x: STATION_BOX.x + Math.sign(dx || 1) * STATION_BOX.hw, z, hit: true };
  return { x, z: STATION_BOX.z + Math.sign(dz || 1) * STATION_BOX.hd, hit: true };
}

/**
 * Slide a point out of everything solid in the world. Returns the corrected
 * position and whether anything was actually hit, so the caller can thump the
 * springs once per contact rather than every frame.
 */
export function resolveSolids(x: number, z: number): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (const s of SOLIDS) {
    const dx = x - s.x;
    const dz = z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < s.r) {
      // dead centre: shove it out along +x rather than dividing by zero
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      x = s.x + nx * s.r;
      z = s.z + nz * s.r;
      hit = true;
    }
  }
  const box = pushOutOfStation(x, z);
  return { x: box.x, z: box.z, hit: hit || box.hit };
}

/**
 * Keep the cow on its own side of the fence.
 *
 * `outside` is where it was last frame, and it is the whole trick: a ring with
 * a gap in it cannot be enforced with one clamp, because "too far out" and "too
 * far in" are the same test from opposite sides. Knowing which side the cow
 * started on turns it back into one clamp, and the gateway is simply the arc
 * where neither clamp applies.
 */
export function resolveFence(
  x: number,
  z: number,
  outside: boolean,
  gateOpen: number
): { x: number; z: number; outside: boolean; hit: boolean } {
  const r = Math.hypot(x, z);
  const angle = Math.atan2(z, x); // the gate is at angle 0, on the +X side
  const inDoorway = Math.abs(angle) < GATE_HALF_ANGLE && gateOpen > 0.55;

  if (inDoorway) {
    // free to walk through; note which side it comes out on
    return { x, z, outside: r > PIT_RADIUS, hit: false };
  }

  if (outside) {
    if (r < PIT_OUTER) {
      const k = r > 1e-4 ? PIT_OUTER / r : 1;
      return { x: x * k, z: z * k, outside: true, hit: true };
    }
    if (r > WORLD_RADIUS) {
      const k = WORLD_RADIUS / r;
      return { x: x * k, z: z * k, outside: true, hit: true };
    }
    return { x, z, outside: true, hit: false };
  }

  if (r > PIT_INNER) {
    const k = PIT_INNER / r;
    return { x: x * k, z: z * k, outside: false, hit: true };
  }
  return { x, z, outside: false, hit: false };
}

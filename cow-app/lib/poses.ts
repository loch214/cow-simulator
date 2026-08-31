// Names of the body parts that poses are allowed to move.
// Every value is a DELTA from the part's resting transform, not an absolute transform.
export type PartName =
  | "body"
  | "head"
  | "earL"
  | "earR"
  | "legFL"
  | "legFR"
  | "legBL"
  | "legBR"
  | "tail"
  | "blush"
  | "brow";

export const PART_NAMES: PartName[] = [
  "body", "head", "earL", "earR",
  "legFL", "legFR", "legBL", "legBR",
  "tail", "blush", "brow",
];

export interface PartPose {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

export type Pose = Partial<Record<PartName, PartPose>>;

export const ZERO_POSE: Pose = {};

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const part of partsIn(a, b)) {
    const pa = a[part] ?? {};
    const pb = b[part] ?? {};
    out[part] = {
      pos: lerpTriple(pa.pos, pb.pos, t),
      rot: lerpTriple(pa.rot, pb.rot, t),
      // scale is also an additive delta from the part's base scale (0 = unchanged)
      scale: lerpTriple(pa.scale, pb.scale, t),
    };
  }
  return out;
}

/**
 * Sum two poses. Because every value is a delta from rest, layers just add:
 * "standing up" + "walk cycle" + "waving an arm" compose without extra plumbing.
 */
export function addPose(a: Pose, b: Pose): Pose {
  const out: Pose = {};
  for (const part of partsIn(a, b)) {
    const pa = a[part] ?? {};
    const pb = b[part] ?? {};
    out[part] = {
      pos: addTriple(pa.pos, pb.pos),
      rot: addTriple(pa.rot, pb.rot),
      scale: addTriple(pa.scale, pb.scale),
    };
  }
  return out;
}

export function addPoses(...poses: Pose[]): Pose {
  return poses.reduce((acc, p) => addPose(acc, p), {} as Pose);
}

/** Multiply every delta in a pose by `k` — used to fade a layer in and out. */
export function scalePose(p: Pose, k: number): Pose {
  const out: Pose = {};
  for (const part of Object.keys(p) as PartName[]) {
    const v = p[part] ?? {};
    out[part] = {
      pos: mulTriple(v.pos, k),
      rot: mulTriple(v.rot, k),
      scale: mulTriple(v.scale, k),
    };
  }
  return out;
}

function partsIn(a: Pose, b: Pose): PartName[] {
  return [...new Set<PartName>([
    ...(Object.keys(a) as PartName[]),
    ...(Object.keys(b) as PartName[]),
  ])];
}

type Triple = [number, number, number];

function lerpTriple(a: Triple | undefined, b: Triple | undefined, t: number): Triple {
  const av = a ?? [0, 0, 0];
  const bv = b ?? [0, 0, 0];
  return [
    av[0] + (bv[0] - av[0]) * t,
    av[1] + (bv[1] - av[1]) * t,
    av[2] + (bv[2] - av[2]) * t,
  ];
}

function addTriple(a: Triple | undefined, b: Triple | undefined): Triple {
  const av = a ?? [0, 0, 0];
  const bv = b ?? [0, 0, 0];
  return [av[0] + bv[0], av[1] + bv[1], av[2] + bv[2]];
}

function mulTriple(a: Triple | undefined, k: number): Triple {
  const av = a ?? [0, 0, 0];
  return [av[0] * k, av[1] * k, av[2] * k];
}

export interface PoseKey {
  t: number;
  pose: Pose;
}

/** Interpolate a keyframe track at `elapsed` ms. Clamps at both ends. */
export function samplePose(keys: PoseKey[], elapsed: number): Pose {
  if (elapsed <= keys[0].t) return keys[0].pose;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (elapsed >= a.t && elapsed <= b.t) {
      const ratio = b.t === a.t ? 1 : (elapsed - a.t) / (b.t - a.t);
      return lerpPose(a.pose, b.pose, ratio);
    }
  }
  return keys[keys.length - 1].pose;
}

// Names of the body parts that gags are allowed to move.
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
  | "blush";

export interface PartPose {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

export type Pose = Partial<Record<PartName, PartPose>>;

export const ZERO_POSE: Pose = {};

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const parts = new Set<PartName>([
    ...(Object.keys(a) as PartName[]),
    ...(Object.keys(b) as PartName[]),
  ]);
  const out: Pose = {};
  for (const part of parts) {
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

function lerpTriple(
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined,
  t: number
): [number, number, number] {
  const av = a ?? [0, 0, 0];
  const bv = b ?? [0, 0, 0];
  return [
    av[0] + (bv[0] - av[0]) * t,
    av[1] + (bv[1] - av[1]) * t,
    av[2] + (bv[2] - av[2]) * t,
  ];
}

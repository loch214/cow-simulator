/**
 * The seeded RNG, on its own.
 *
 * It used to live in `lib/geometry.ts`, which is fine for anything that is
 * already building meshes — but `lib/world.ts` needs it too (the trees are
 * jittered from a fixed seed), and importing geometry drags `three` into the
 * layout module. That matters for one specific reason: the cutscene can be
 * simulated headlessly by compiling `lib/cutscene.ts` to CommonJS and stepping
 * it in Node (see "Verifying without watching it" in HANDOFF.md), and
 * `cutscene` imports `world`. A `three` import anywhere in that chain ends the
 * simulation before it starts.
 *
 * `lib/geometry.ts` re-exports this, so nothing that already imported `rng`
 * from there had to change.
 */

/** Deterministic RNG, so the same fence gets the same knots on every reload. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

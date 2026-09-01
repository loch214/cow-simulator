// Wind, shared by everything that bends in it.
//
// One clock and one patch, applied to ordinary MeshStandardMaterials so they keep
// their lighting, shadows and vertex colours. Every blade of grass, every tuft
// and every tree canopy reads the same uniform, so a gust crosses the whole field
// at once instead of each object wobbling to its own beat.

import * as THREE from "three";

/** Advanced once a frame by `WindClock` in components/Environment.tsx. */
export const wind = { value: 0 };

/**
 * Add a sway to a material. The displacement is applied in the object's own
 * space — so a blade planted at any angle still bends about its root — while the
 * *amount* is sampled from the object's world position, which is what makes the
 * gusts travel.
 *
 * `height` is how tall the thing is, so the bend can be weighted towards the tip;
 * `strength` is how far the tip moves at full gust, in world units.
 */
export function applySway(
  material: THREE.MeshStandardMaterial,
  height: number,
  strength: number
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 swayAt = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2])
                       + vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
         #else
           vec3 swayAt = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
         #endif
         float gust = sin(uWind * 1.5 + swayAt.x * 0.35 + swayAt.z * 0.28)
                    + 0.45 * sin(uWind * 3.1 + swayAt.x * 1.1)
                    + 0.25 * sin(uWind * 5.3 + swayAt.z * 1.7);
         float upT = clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.0);
         float lean = upT * upT * gust * ${strength.toFixed(4)};
         transformed.x += lean;
         transformed.z += lean * 0.45;`
      );
  };
  // three caches compiled programs by this key; a patched material needs its own
  material.customProgramCacheKey = () => `sway:${height}:${strength}`;
  return material;
}

// Free-look camera, GTA style: the view follows the mouse with no clicking or
// dragging. Like `cowState`, this is a plain mutable object rather than React
// state — it changes every frame and nothing should re-render for it.

export const cam = {
  /** Orbit angle. The camera sits at yaw = cow facing + PI, i.e. behind it. */
  yaw: 0,
  /** Elevation above the horizon. Bigger = looking further down at the cow. */
  pitch: 0.42,
  dist: 6.5,
  /** performance.now() of the last manual look — used to back off auto-follow. */
  lastLookAt: 0,
  /** True while the pointer is captured, so the HUD can drop the "click" hint. */
  locked: false,
};

const PITCH_MIN = 0.06;
const PITCH_MAX = 1.15;
const DIST_MIN = 3.6;
const DIST_MAX = 11;

export const MOUSE_SENS = 0.0024;
export const TOUCH_SENS = 0.006;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function addLook(dx: number, dy: number, sens: number) {
  cam.yaw -= dx * sens;
  cam.pitch = clamp(cam.pitch + dy * sens, PITCH_MIN, PITCH_MAX);
  cam.lastLookAt = performance.now();
}

export function addZoom(delta: number) {
  cam.dist = clamp(cam.dist + delta, DIST_MIN, DIST_MAX);
}

export function setZoom(dist: number) {
  cam.dist = clamp(dist, DIST_MIN, DIST_MAX);
}

/** Unit vector on the ground pointing where the camera is looking. */
export function lookForward(): { x: number; z: number } {
  return { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
}

/** Where the camera should sit, given the point it's orbiting. */
export function cameraOffset(): { x: number; y: number; z: number } {
  const cp = Math.cos(cam.pitch);
  return {
    x: Math.sin(cam.yaw) * cp * cam.dist,
    y: Math.sin(cam.pitch) * cam.dist,
    z: Math.cos(cam.yaw) * cp * cam.dist,
  };
}

export function resetBehind(facing: number) {
  cam.yaw = facing + Math.PI;
}

/**
 * Ease the camera around behind the cow. Only used for touch play — on a phone
 * there's no second thumb to spare for looking, so the camera does it for you.
 * On desktop the mouse is in charge and this is never called.
 */
export function easeBehind(facing: number, dt: number) {
  if (performance.now() - cam.lastLookAt < 1200) return; // player just looked; leave it alone
  const want = facing + Math.PI;
  let diff = ((want - cam.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  cam.yaw += diff * Math.min(1, dt * 1.6);
}

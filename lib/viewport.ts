"use client";

// Screen shape, fullscreen and orientation.
//
// A third-person chase camera wants a wide frame. A phone held upright gives it
// the opposite, so this module exists to (a) tell the rest of the app which
// shape it is currently in, and (b) ask the browser — politely, because it is
// allowed to say no — for a landscape fullscreen.
//
// What is actually possible, which is less than you would hope:
//   * Android Chrome/Brave/Samsung: fullscreen works, and `orientation.lock`
//     works ONCE FULLSCREEN. This is the good case.
//   * iPad Safari: fullscreen works, the lock does not.
//   * iPhone Safari: neither works in a tab. All we can do is ask the player to
//     turn the phone, or have them install it to the home screen.
// Every call below therefore fails soft: nothing here is load-bearing.

import { useCallback, useSyncExternalStore } from "react";

const PORTRAIT = "(orientation: portrait)";

interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/**
 * `lock` is non-standard enough that TypeScript's DOM lib doesn't carry it, and
 * `unlock` exists there but not everywhere at runtime — so both are optional
 * here and every call site guards.
 */
interface LockableOrientation {
  lock?: (orientation: "landscape" | "portrait" | "any") => Promise<void>;
  unlock?: () => void;
}

/** True while the page is upright (taller than it is wide). */
export function useIsPortrait(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const mq = window.matchMedia?.(PORTRAIT);
    mq?.addEventListener("change", notify);
    // Some Android browsers repaint the viewport before they flip the media
    // query, so listen to the resize as well and let React dedupe.
    window.addEventListener("resize", notify);
    return () => {
      mq?.removeEventListener("change", notify);
      window.removeEventListener("resize", notify);
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(PORTRAIT).matches ?? false,
    () => false // server render: assume landscape, corrected on hydration
  );
}

/** True while the document is in fullscreen. */
export function useIsFullscreen(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    document.addEventListener("fullscreenchange", notify);
    return () => document.removeEventListener("fullscreenchange", notify);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => document.fullscreenElement !== null,
    () => false
  );
}

/** Whether asking for fullscreen is worth offering at all. False on iPhone. */
export function canFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FullscreenCapableElement;
  return typeof (el.requestFullscreen ?? el.webkitRequestFullscreen) === "function";
}

/**
 * Go fullscreen and, if the browser allows it, turn the view landscape.
 *
 * MUST be called from inside a real user gesture — a click or touch handler —
 * or the browser refuses both halves. Each half is tried independently, because
 * plenty of devices grant one and not the other, and half of this is still an
 * improvement over none of it.
 */
export async function enterImmersive(): Promise<void> {
  const el = document.documentElement as FullscreenCapableElement;
  try {
    if (!document.fullscreenElement) {
      await (el.requestFullscreen
        ? el.requestFullscreen({ navigationUI: "hide" })
        : el.webkitRequestFullscreen?.());
    }
  } catch {
    // Refused (iPhone, or the gesture wasn't trusted). The game plays anyway.
  }
  try {
    // Only meaningful once fullscreen was granted; harmless otherwise.
    await (screen.orientation as unknown as LockableOrientation | undefined)?.lock?.("landscape");
  } catch {
    // Unsupported, or the device is in a rotation lock. Fall back to asking.
  }
}

/** Give the screen back. Unlocks the orientation first so we don't strand it. */
export async function exitImmersive(): Promise<void> {
  try {
    (screen.orientation as unknown as LockableOrientation | undefined)?.unlock?.();
  } catch {
    // never mind
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // never mind
  }
}

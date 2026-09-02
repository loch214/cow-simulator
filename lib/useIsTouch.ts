"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isTouch, onTouchDetected } from "./input";

const COARSE = "(pointer: coarse)";

/**
 * True when the player is on a touch device. Reads the pointer media query so
 * the on-screen controls are there on the very first frame — nobody should have
 * to touch the screen once to discover the controls — and also flips if a real
 * touch shows up later on a hybrid laptop.
 */
export function useIsTouch(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const mq = window.matchMedia?.(COARSE);
    mq?.addEventListener("change", notify);
    const stop = onTouchDetected(notify);
    return () => {
      mq?.removeEventListener("change", notify);
      stop();
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => isTouch() || (window.matchMedia?.(COARSE).matches ?? false),
    () => false // server render: assume desktop, corrected on hydration
  );
}

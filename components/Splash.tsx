"use client";

import { useCallback, useEffect, useState } from "react";
import { useCowStore } from "@/lib/store";
import { requestLock } from "@/lib/input";
import { useIsTouch } from "@/lib/useIsTouch";
import { canFullscreen, enterImmersive, useIsPortrait } from "@/lib/viewport";

/** How long the card takes to lift away. Must match `splash-out` in globals.css. */
const OUT_MS = 460;

/**
 * The title card.
 *
 * It is deliberately a hole rather than a wall: the middle of the screen is
 * left empty so you watch the cow dance behind it, and the type is pushed to
 * the top and bottom edges. The dark gradient is only there to keep white text
 * legible against a bright field.
 *
 * It also does the three jobs that can only be done from inside a real user
 * gesture, all of which browsers refuse otherwise:
 *   1. start the AudioContext (via the store's `start`),
 *   2. ask for fullscreen, which is the only way to get the URL bar and the
 *      nav bar off a phone screen,
 *   3. ask for a landscape lock, which only works once (2) was granted.
 */
export default function Splash() {
  const started = useCowStore((s) => s.started);
  const start = useCowStore((s) => s.start);
  const touch = useIsTouch();
  const portrait = useIsPortrait();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  const go = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    // Fullscreen and the orientation lock have to be asked for synchronously
    // inside the gesture; the fade is just decoration on top.
    if (touch) void enterImmersive();
    else requestLock();
    // Let the card get out of the way before the cow drops out of the dance,
    // so the two reads as one movement.
    setTimeout(start, OUT_MS - 140);
    // Take the card off the tree once it has finished lifting away. Without
    // this it stays mounted over the game forever — invisible and click-through,
    // but still a full-screen element sitting on top of everything.
    setTimeout(() => setGone(true), OUT_MS + 60);
  }, [leaving, touch, start]);

  // Space or Enter for anyone on a keyboard, so the card isn't a mouse trap.
  useEffect(() => {
    if (started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        go();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, go]);

  if (gone || (started && !leaving)) return null;

  return (
    <div
      onPointerDown={go}
      className={`absolute inset-0 z-20 flex touch-none select-none flex-col justify-between bg-gradient-to-b from-black/55 via-transparent to-black/70 ${
        leaving ? "splash-out" : ""
      }`}
    >
      {/* top: the name */}
      <div
        className="splash-in px-6 pt-[calc(var(--safe-t)+1.75rem)] text-center landscape:pt-[calc(var(--safe-t)+1rem)]"
        style={{ "--in-delay": "80ms" } as React.CSSProperties}
      >
        <h1 className="text-[3.25rem] leading-[0.92] font-black tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.65)] portrait:text-[3.75rem] landscape:text-[2.75rem]">
          THE COW
        </h1>
        <p className="mt-2 text-base font-medium text-white/80 drop-shadow-lg landscape:mt-1 landscape:text-sm">
          It has opinions. You have hands.
        </p>
      </div>

      {/* bottom: the way in */}
      <div className="flex flex-col items-center gap-3 px-6 pb-[calc(var(--safe-b)+1.75rem)] landscape:gap-2 landscape:pb-[calc(var(--safe-b)+1rem)]">
        {touch && portrait && (
          <div
            className="splash-in flex items-center gap-2.5 rounded-full bg-black/45 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-sm"
            style={{ "--in-delay": "520ms" } as React.CSSProperties}
          >
            <span className="rotate-hint inline-block text-lg">📱</span>
            <span>
              {canFullscreen()
                ? "Best sideways — tapping will try to turn it for you"
                : "Turn your phone sideways for the full field"}
            </span>
          </div>
        )}

        {/* Three elements for one button, because each of the three animations
            here sets `transform` and the CSS `animation` shorthand doesn't
            stack — put two on one element and the second silently wipes the
            first, taking its opacity with it. Outer fades in, middle breathes,
            the button itself squashes when pressed. */}
        <div className="splash-in" style={{ "--in-delay": "320ms" } as React.CSSProperties}>
          <div className="tap-breathe">
            <button
              onClick={go}
              className="pointer-events-auto rounded-full bg-amber-300 px-12 py-5 text-2xl font-black text-neutral-900 shadow-[0_10px_40px_rgba(0,0,0,0.45)] transition-transform active:scale-95 landscape:px-10 landscape:py-3.5 landscape:text-xl"
            >
              {touch ? "Tap to play" : "Click to play"}
            </button>
          </div>
        </div>

        <p
          className="splash-in text-xs font-medium text-white/55 landscape:text-[0.7rem]"
          style={{ "--in-delay": "700ms" } as React.CSSProperties}
        >
          {touch ? "Sound on. Trust us." : "Space or click · sound on"}
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useCowStore } from "@/lib/store";
import { onPointerLockChange } from "@/lib/input";
import { useIsTouch } from "@/lib/useIsTouch";
import { enterImmersive, exitImmersive, useIsFullscreen, useIsPortrait } from "@/lib/viewport";
import { SLAPS_BEFORE_POLICE } from "@/lib/world";

export default function HUD() {
  const started = useCowStore((s) => s.started);
  const dialogue = useCowStore((s) => s.dialogue);
  const speaker = useCowStore((s) => s.speaker);
  const nearGrass = useCowStore((s) => s.nearGrass);
  const inCutscene = useCowStore((s) => s.inCutscene);
  const activeGag = useCowStore((s) => s.activeGag);
  const slapCount = useCowStore((s) => s.slapCount);
  const triggerGag = useCowStore((s) => s.triggerGag);
  const interact = useCowStore((s) => s.interact);

  const touch = useIsTouch();
  const portrait = useIsPortrait();
  const fullscreen = useIsFullscreen();
  const [locked, setLocked] = useState(false);
  useEffect(() => onPointerLockChange(setLocked), []);

  const busy = inCutscene || activeGag !== null;
  const canEat = nearGrass !== null && !busy;

  // The title card is up; it does its own talking.
  if (!started) return null;

  return (
    // Everything sits inside the safe area rather than the raw viewport, so a
    // notch, a home indicator or a browser nav bar can't land on a control. The
    // canvas underneath still runs edge to edge.
    <div className="pointer-events-none absolute safe-area select-none">
      {/* speech bubble — labelled, because two of them talk at the station */}
      <div className="absolute inset-x-0 top-3 flex justify-center px-4">
        {dialogue && (
          <div
            className={`flex max-w-[85vw] items-center gap-2.5 rounded-2xl px-5 py-2.5 text-center font-medium shadow-lg ${
              touch ? "text-base landscape:text-lg" : "text-lg sm:text-xl"
            } ${
              speaker === "officer"
                ? "bg-[#28407a]/92 text-white"
                : "bg-white/92 text-neutral-900"
            }`}
          >
            <span className="shrink-0 text-xl sm:text-2xl">
              {speaker === "officer" ? "👮" : "🐄"}
            </span>
            <span>{dialogue}</span>
          </div>
        )}
      </div>

      {/* How close the cow is to walking off to file a report.

          On a phone this moves up out of the thumb zone entirely. It used to
          sit between the stick and the buttons, where it was both in the way
          and too small to read against the field. */}
      <div
        className={`absolute flex items-center gap-1.5 ${
          touch ? "top-3 right-3" : "inset-x-0 bottom-3 justify-center"
        }`}
      >
        {Array.from({ length: SLAPS_BEFORE_POLICE }).map((_, i) => (
          <span
            key={i}
            className={`rounded-full transition-colors ${touch ? "h-1.5 w-5" : "h-2 w-7"} ${
              i < slapCount ? "bg-red-500" : "bg-white/45"
            }`}
          />
        ))}
      </div>

      {touch && <ScreenButton fullscreen={fullscreen} />}

      {/* The game holds the mouse by default; this only shows once you've taken
          it back with Esc, to say how to hand it over again. */}
      {!touch && !locked && (
        <div className="absolute inset-x-0 top-[72%] flex justify-center px-4">
          <div className="rounded-full bg-black/45 px-5 py-2.5 text-sm font-medium text-white/95 shadow-lg backdrop-blur-sm">
            Click the field (or press a key) to look with the mouse · Esc frees the cursor
          </div>
        </div>
      )}

      {/* The one contextual action. It goes in the gap between the stick and
          the buttons: dead centre along the bottom in landscape, and above the
          buttons in portrait, where the centre of the screen is the cow. */}
      {canEat && (
        <div
          className={`absolute inset-x-0 flex justify-center px-4 ${
            !touch ? "bottom-32" : portrait ? "bottom-[14.5rem]" : "bottom-5"
          }`}
        >
          <button
            onClick={interact}
            className="pointer-events-auto animate-pulse rounded-full bg-amber-300 px-7 py-3.5 text-lg font-bold text-neutral-900 shadow-2xl active:scale-95"
          >
            {!touch && <Key>E</Key>}
            🌿 Eat the grass
          </button>
        </div>
      )}

      {/* Pet / Slap.

          Landscape has the width to put them side by side, out of the way on
          the right. Portrait doesn't, so they stack — but smaller than they
          were, because at the old size the pair of them owned a third of the
          screen and pushed everything else onto the cow. */}
      <div
        className={
          !touch
            ? "pointer-events-auto absolute inset-x-0 bottom-8 flex justify-center gap-3"
            : portrait
              ? "pointer-events-auto absolute bottom-5 right-4 flex flex-col gap-3"
              : "pointer-events-auto absolute bottom-4 right-4 flex flex-row gap-3"
        }
      >
        <Action
          emoji="🖐️"
          label="Pet"
          hint={touch ? undefined : "Q"}
          big={touch}
          disabled={busy}
          onClick={() => triggerGag("shy")}
        />
        <Action
          emoji="👋"
          label="Slap"
          hint={touch ? undefined : "F"}
          big={touch}
          danger
          disabled={busy}
          onClick={() => triggerGag("slap")}
        />
      </div>

      {touch ? (
        <TouchHints portrait={portrait} fullscreen={fullscreen} />
      ) : (
        <div className="absolute bottom-4 left-4 hidden rounded-xl bg-black/35 px-3 py-2 text-xs leading-relaxed text-white/90 sm:block">
          <div><b>WASD</b> / arrows — walk where you&apos;re looking</div>
          <div><b>Mouse</b> — look around (captured) · <b>Scroll</b> — zoom</div>
          <div><b>E</b> eat · <b>Q</b> pet · <b>F</b> slap</div>
        </div>
      )}
    </div>
  );
}

/**
 * Fullscreen toggle.
 *
 * Worth having even though the title card already asked once: people swipe out
 * of fullscreen by accident, and on a phone it is the difference between
 * playing on the whole screen and playing on two thirds of one.
 */
function ScreenButton({ fullscreen }: { fullscreen: boolean }) {
  return (
    <button
      onClick={() => void (fullscreen ? exitImmersive() : enterImmersive())}
      aria-label={fullscreen ? "Leave fullscreen" : "Go fullscreen"}
      className="pointer-events-auto absolute top-8 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/35 text-base text-white/85 backdrop-blur-sm active:scale-95"
    >
      {fullscreen ? "⤫" : "⛶"}
    </button>
  );
}

/**
 * The two things a first-time player needs told, and then never again.
 *
 * This used to be one permanent banner across the middle of the screen, sitting
 * on top of the cow. Now it is pinned to the corner above the stick and times
 * out on its own — `hint-fade` ends in `visibility: hidden`, so the hints stop
 * swallowing taps as well as stop being visible.
 */
function TouchHints({ portrait, fullscreen }: { portrait: boolean; fullscreen: boolean }) {
  return (
    <div className="absolute bottom-[9.5rem] left-4 flex max-w-[60vw] flex-col gap-2">
      {portrait && !fullscreen && (
        <div
          className="hint-fade flex items-center gap-2 rounded-lg bg-black/45 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm"
          style={{ "--hint-ms": "12000ms" } as React.CSSProperties}
        >
          <span className="rotate-hint inline-block">📱</span>
          <span>Turn sideways for a wider view</span>
        </div>
      )}
      <div className="hint-fade rounded-lg bg-black/35 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
        Drag the stick to walk · swipe the field to look
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-2 rounded bg-neutral-900/80 px-2 py-0.5 font-mono text-sm text-white">
      {children}
    </kbd>
  );
}

function Action({
  emoji,
  label,
  hint,
  onClick,
  disabled,
  danger,
  big,
}: {
  emoji: string;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-full font-bold shadow-2xl transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
        big ? "w-[7.5rem] px-3 py-4 text-lg" : "px-5 py-3 text-base"
      } ${danger ? "bg-red-500 text-white" : "bg-white/95 text-neutral-800"}`}
    >
      <span className="text-xl">{emoji}</span>
      <span>{label}</span>
      {hint && (
        <kbd className={`ml-1 rounded px-1.5 py-0.5 font-mono text-xs ${danger ? "bg-black/25 text-white" : "bg-neutral-900/15 text-neutral-700"}`}>
          {hint}
        </kbd>
      )}
    </button>
  );
}

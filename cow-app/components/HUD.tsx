"use client";

import { useEffect, useState } from "react";
import { useCowStore } from "@/lib/store";
import { onPointerLockChange } from "@/lib/input";
import { useIsTouch } from "@/lib/useIsTouch";
import { SLAPS_BEFORE_POLICE } from "@/lib/world";

export default function HUD() {
  const dialogue = useCowStore((s) => s.dialogue);
  const speaker = useCowStore((s) => s.speaker);
  const nearGrass = useCowStore((s) => s.nearGrass);
  const inCutscene = useCowStore((s) => s.inCutscene);
  const activeGag = useCowStore((s) => s.activeGag);
  const slapCount = useCowStore((s) => s.slapCount);
  const triggerGag = useCowStore((s) => s.triggerGag);
  const interact = useCowStore((s) => s.interact);

  const touch = useIsTouch();
  const [locked, setLocked] = useState(false);
  useEffect(() => onPointerLockChange(setLocked), []);

  const busy = inCutscene || activeGag !== null;
  const canEat = nearGrass !== null && !busy;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* speech bubble — labelled, because two of them talk at the station */}
      <div className="absolute inset-x-0 top-4 flex justify-center px-4">
        {dialogue && (
          <div
            className={`flex max-w-[85vw] items-center gap-2.5 rounded-2xl px-5 py-2.5 text-center text-lg font-medium shadow-lg sm:text-xl ${
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

      {/* The game holds the mouse by default; this only shows once you've taken
          it back with Esc, to say how to hand it over again. */}
      {!touch && !locked && (
        <div className="absolute inset-x-0 top-[72%] flex justify-center px-4">
          <div className="rounded-full bg-black/45 px-5 py-2.5 text-sm font-medium text-white/95 shadow-lg backdrop-blur-sm">
            Click the field (or press a key) to look with the mouse · Esc frees the cursor
          </div>
        </div>
      )}

      {/* the one contextual action */}
      {canEat && (
        <div
          className={`absolute inset-x-0 flex justify-center px-4 ${
            touch ? "bottom-56" : "bottom-32"
          }`}
        >
          <button
            onClick={interact}
            className={`pointer-events-auto animate-pulse rounded-full bg-amber-300 font-bold text-neutral-900 shadow-2xl active:scale-95 ${
              touch ? "px-9 py-5 text-2xl" : "px-6 py-3 text-lg"
            }`}
          >
            {!touch && <Key>E</Key>}
            🌿 Eat the grass
          </button>
        </div>
      )}

      {/* Pet / Slap */}
      <div
        className={
          touch
            ? "pointer-events-auto absolute bottom-6 right-5 flex flex-col gap-4"
            : "pointer-events-auto absolute inset-x-0 bottom-8 flex justify-center gap-3"
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

      {/* how close the cow is to walking off to file a report */}
      <div
        className={`absolute flex items-center gap-1.5 ${
          touch ? "bottom-[12rem] right-5" : "inset-x-0 bottom-3 justify-center"
        }`}
      >
        {Array.from({ length: SLAPS_BEFORE_POLICE }).map((_, i) => (
          <span
            key={i}
            className={`h-2 w-7 rounded-full transition-colors ${
              i < slapCount ? "bg-red-500" : "bg-white/45"
            }`}
          />
        ))}
      </div>

      {touch ? (
        <div className="absolute bottom-[14.5rem] left-5 max-w-[70vw] rounded-lg bg-black/35 px-3 py-1.5 text-xs font-medium text-white/90">
          Drag the stick to walk · swipe the field to look
        </div>
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
        big ? "w-36 px-4 py-5 text-xl" : "px-5 py-3 text-base"
      } ${danger ? "bg-red-500 text-white" : "bg-white/95 text-neutral-800"}`}
    >
      <span className={big ? "text-2xl" : "text-xl"}>{emoji}</span>
      <span>{label}</span>
      {hint && (
        <kbd className={`ml-1 rounded px-1.5 py-0.5 font-mono text-xs ${danger ? "bg-black/25 text-white" : "bg-neutral-900/15 text-neutral-700"}`}>
          {hint}
        </kbd>
      )}
    </button>
  );
}

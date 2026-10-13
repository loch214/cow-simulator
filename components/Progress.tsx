"use client";

import { useEffect } from "react";
import { GOALS } from "@/lib/goals";
import { useCowStore } from "@/lib/store";

/**
 * The to-do list, folded into a chip in the corner: "3 / 14". Tab (or a tap)
 * opens it. It opens itself once on the way in so a first-time player knows
 * there is a list, and then gets out of the way.
 */
export function GoalList({ touch }: { touch: boolean }) {
  const done = useCowStore((s) => s.done);
  const open = useCowStore((s) => s.listOpen);
  const toggle = useCowStore((s) => s.toggleList);
  const tickets = useCowStore((s) => s.tickets.length);
  const count = GOALS.filter((g) => done[g.id]).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Tab") return;
      e.preventDefault();
      useCowStore.getState().toggleList();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pointer-events-auto absolute top-3 left-3 flex flex-col items-start gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => toggle()}
          className="flex items-center gap-2 rounded-full bg-black/45 px-3.5 py-1.5 text-sm font-bold text-white shadow-lg backdrop-blur-sm active:scale-95"
          aria-expanded={open}
        >
          <span>📋</span>
          <span>
            {count} / {GOALS.length}
          </span>
          {!touch && <kbd className="rounded bg-white/20 px-1.5 font-mono text-[0.65rem]">Tab</kbd>}
        </button>
        {tickets > 0 && (
          <span
            className="rounded-full bg-red-600/90 px-3 py-1.5 text-sm font-bold text-white shadow-lg"
            title="Speeding tickets"
          >
            🎫 {tickets}
          </span>
        )}
      </div>

      {open && (
        <div className="list-in w-[17.5rem] max-w-[80vw] rounded-2xl bg-[#fbf8ef]/95 p-3.5 text-neutral-800 shadow-2xl">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-black tracking-tight">Things to do to a cow</h2>
            <span className="text-xs text-neutral-500">
              {count}/{GOALS.length}
            </span>
          </div>
          <ul className="max-h-[56vh] space-y-1 overflow-y-auto pr-1 text-[0.82rem] leading-tight short:max-h-[34vh]">
            {GOALS.map((g) => {
              const ticked = !!done[g.id];
              return (
                <li key={g.id} className="flex gap-2">
                  <span className={`mt-px shrink-0 ${ticked ? "text-emerald-600" : "text-neutral-400"}`}>
                    {ticked ? "✔" : "○"}
                  </span>
                  <span>
                    <span className={ticked ? "text-neutral-400 line-through" : "font-semibold"}>{g.title}</span>
                    {!ticked && <span className="block text-[0.7rem] text-neutral-500 short:hidden">{g.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A box ticked: pops in under the list chip, chimes (in the store), goes. */
export function GoalToast() {
  const toast = useCowStore((s) => s.toast);
  if (!toast) return null;
  const goal = GOALS.find((g) => g.id === toast.id);
  if (!goal) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[5.5rem] flex justify-center px-4">
      <div
        key={toast.seq}
        className="toast-in flex items-center gap-2.5 rounded-full bg-emerald-600 px-5 py-2.5 text-base font-bold text-white shadow-2xl"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm text-emerald-700">✔</span>
        {goal.title}
      </div>
    </div>
  );
}

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/**
 * The end of the list. The game does not stop — there is no game over in a
 * field — but finishing deserves an ending, and a summary of the damage.
 */
export function Finale() {
  const finale = useCowStore((s) => s.finale);
  const stats = useCowStore((s) => s.stats);
  const tickets = useCowStore((s) => s.tickets.length);
  const close = useCowStore((s) => s.closeFinale);
  const reset = useCowStore((s) => s.resetGoals);
  if (!finale) return null;

  const rows: [string, string | number][] = [
    ["Slaps", stats.slaps],
    ["Kisses on the screen", stats.kisses],
    ["Speeding tickets", tickets],
    ["Sheep bowled", stats.sheep],
    ["Things run into", stats.bonks],
    ["Time spent with a cow", minutes(stats.endedAt - stats.startedAt)],
  ];

  return (
    // Off to the side on a wide screen, so the cow's victory dance — which is
    // the actual ending — is not hidden behind the card announcing it.
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/20 p-4 md:justify-end md:pr-[6vw]">
      <div className="finale-in w-[min(24rem,92vw)] rounded-3xl bg-[#fbf8ef] p-6 text-center text-neutral-800 shadow-2xl">
        <div className="text-4xl">🐄🏆</div>
        <h2 className="mt-2 text-2xl font-black tracking-tight">That&apos;s everything.</h2>
        <p className="mt-1 text-sm text-neutral-600">
          You have done every single thing there is to do to a cow. The cow would like you to leave now.
        </p>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-left text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={close}
            className="rounded-full bg-amber-300 px-5 py-2.5 font-bold text-neutral-900 shadow-lg active:scale-95"
          >
            Keep playing
          </button>
          <button
            onClick={reset}
            className="rounded-full bg-neutral-200 px-5 py-2.5 font-bold text-neutral-700 shadow active:scale-95"
          >
            Wipe the list
          </button>
        </div>
      </div>
    </div>
  );
}

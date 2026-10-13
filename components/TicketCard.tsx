"use client";

import { useCowStore } from "@/lib/store";

/** What the fine is, in the only currency a cow has. */
function fineFor(n: number): string {
  if (n === 1) return "1 bale of hay";
  if (n < 5) return `${n} bales of hay`;
  return `${n} bales of hay (and a stern look)`;
}

/**
 * The penalty notice. Slides in a beat after the speed camera flashes, with the
 * camera's actual photograph of the cow on it, says plainly what happened —
 * how fast, what the limit was, what it costs — and slides away again.
 *
 * This is the answer to "the player should clearly understand what happened":
 * before, the only feedback was a white flash and a line from the cow, and a
 * player who had not seen the camera had no idea they had been caught by one.
 */
export default function TicketCard({ touch }: { touch: boolean }) {
  const shown = useCowStore((s) => s.ticketShown);
  const tickets = useCowStore((s) => s.tickets);
  const dismiss = useCowStore((s) => s.dismissTicket);
  if (shown === null) return null;
  const t = tickets[shown];
  if (!t) return null;

  return (
    <div
      className={`ticket-in pointer-events-auto absolute ${
        touch
          ? "top-14 right-3 w-[min(19rem,86vw)] short:top-3 short:right-16 short:w-[24rem]"
          : "top-20 right-5 w-[19rem]"
      }`}
      onClick={dismiss}
      role="dialog"
      aria-label="Speeding ticket"
    >
      <div className="rotate-[1.5deg] rounded-sm bg-[#fbf8ef] p-3 font-mono text-[0.72rem] leading-snug text-neutral-800 shadow-[0_14px_40px_rgba(0,0,0,0.45)]">
        <div className="flex items-baseline justify-between border-b-2 border-red-600 pb-1">
          <span className="text-[0.95rem] font-black tracking-tight text-red-600">PENALTY NOTICE</span>
          <span className="text-neutral-500">No. {String(t.n).padStart(4, "0")}</span>
        </div>
        {/* On a short (landscape phone) screen the notice lies on its side:
            photo on the left, the charges on the right. */}
        <div className="short:flex short:gap-3">
          <div className="mt-2 aspect-[4/3] w-full overflow-hidden rounded-[2px] bg-neutral-900 short:w-40 short:shrink-0">
            {t.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL from the camera, nothing to optimise
              <img src={t.photo} alt="Speed camera photo of the cow" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-neutral-500">developing…</div>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-0.5">
            <dt className="text-neutral-500">Vehicle</dt>
            <dd>1 cow (black &amp; white)</dd>
            <dt className="text-neutral-500">Speed</dt>
            <dd>
              <b className="text-red-600">{t.mph.toFixed(1)} mph</b> in a {t.limit}
            </dd>
            <dt className="text-neutral-500">Fine</dt>
            <dd>{fineFor(t.n)}</dd>
          </dl>
        </div>
        <p className="mt-2 border-t border-dashed border-neutral-400 pt-1 text-[0.65rem] text-neutral-500">
          {t.n >= 3 ? "Your photo has been passed to the station." : "Payable at the station. Walking is free."}
        </p>
      </div>
    </div>
  );
}

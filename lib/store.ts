import { create } from "zustand";
import { ensureAudio, smack, moo, chew, kissJingle, grunt, creak, slurp, shutter } from "./audio";
import {
  bellowLines,
  danceLines,
  gags,
  insultLines,
  LIP_MARK_DURATION,
  SLAP_IMPACT,
} from "./reactions";
import { kissImpulse, slapImpulse } from "./physics";
import { addShake } from "./camera";
import { cowState } from "./cowState";
import { GRASS, REGROW_MS, SLAPS_BEFORE_POLICE } from "./world";
import type { Speaker } from "./cutscene";

export type GagId = "eat" | "shy" | "slap" | "bellow" | "sip" | "dance";

/**
 * The one contextual action, and what it is currently pointed at.
 *
 * There used to be exactly one thing in the world worth walking up to, so
 * this was a single `nearGrass: number | null`. Now that the gate opens there
 * are several and they are not all grass, so whatever the cow is standing
 * next to carries its own label and icon and `interact()` switches on the
 * kind. Adding an interactable is one case here and one entry in
 * `nearestPrompt()` in components/Cow.tsx.
 */
export type PromptKind = "grass" | "gate" | "scarecrow" | "pond";

export interface Prompt {
  kind: PromptKind;
  /** Which one, where there is more than one. Grass uses the tuft id. */
  id: number;
  label: string;
  icon: string;
}

export interface CowStore {
  /**
   * False until the player taps through the title card. While it's false the
   * cow is up on its hind legs dancing and no control is wired up — which is
   * also what buys us the user gesture we need to ask for fullscreen, a
   * landscape lock and the AudioContext, none of which a browser will hand
   * over without one.
   */
  started: boolean;
  /** null = free roaming. A gag freezes the cow; a cutscene takes it over. */
  activeGag: GagId | null;
  gagStartedAt: number;
  inCutscene: boolean;
  dialogue: string | null;
  /** Who the current line belongs to, so the bubble can be labelled. */
  speaker: Speaker;
  showLipMark: boolean;
  /** Bumped on every kiss so the overlay replays its animation from the top. */
  lipMarkSeq: number;
  slapCount: number;
  /**
   * Whether the player has thrown the gate open. `cowState.gateOpen` is the
   * animated 0..1 that the panel and the fence collision read; this is the
   * discrete intent behind it, and it lives in the store because the HUD has
   * to re-render when it changes.
   */
  gateOpen: boolean;
  /** Bumped every time the cow bellows at the scarecrow, so it can react. */
  scareSeq: number;
  /** Bumped when the speed camera fires, so the screen can flash. */
  flashSeq: number;
  /**
   * When the slapping hand started its swing, as `performance.now()`. A
   * timestamp rather than a flag, so a second slap restarts the swing from the
   * top instead of being swallowed while the first one is still in the air.
   */
  slapAt: number;
  /** Timestamp each grass tuft was eaten, or null if it's standing. */
  grassEatenAt: (number | null)[];
  /** Id of the grass tuft the cow is close enough to eat, if any. */
  nearGrass: number | null;
  /** Whatever the cow is standing next to, ready for `interact()`. */
  prompt: Prompt | null;

  start: () => void;
  say: (line: string | null, speaker?: Speaker) => void;
  setNearGrass: (id: number | null) => void;
  setPrompt: (p: Prompt | null) => void;
  regrow: (id: number) => void;
  interact: () => void;
  flash: () => void;
  triggerGag: (id: GagId) => void;
  toggleDance: () => void;
  startCutscene: () => void;
  endCutscene: () => void;
}

let timeouts: ReturnType<typeof setTimeout>[] = [];
const lastLine: Record<string, number> = {};

function clearScheduled() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
}

const POOLS = { insult: insultLines, bellow: bellowLines, dance: danceLines };

/** A line from a pool, never the same one twice running. */
function pickLine(pool: keyof typeof POOLS): string {
  const lines = POOLS[pool];
  let i = Math.floor(Math.random() * lines.length);
  if (lines.length > 1) {
    while (i === lastLine[pool]) i = Math.floor(Math.random() * lines.length);
  }
  lastLine[pool] = i;
  return lines[i];
}

const sounds = { smack, moo, chew, kiss: kissJingle, grunt, creak, slurp };

/** What the cow has to say about being photographed. */
const TICKET = "Three miles an hour. In a two zone.";

export const useCowStore = create<CowStore>((set, get) => {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as { __cowStore?: unknown }).__cowStore = () => get();
  }
  return {
    started: false,
    activeGag: null,
    gagStartedAt: 0,
    inCutscene: false,
    dialogue: null,
    speaker: "cow",
    showLipMark: false,
    lipMarkSeq: 0,
    slapCount: 0,
    slapAt: 0,
    gateOpen: false,
    scareSeq: 0,
    flashSeq: 0,
    grassEatenAt: GRASS.map(() => null),
    nearGrass: null,
    prompt: null,

    // The tap on the title card. Audio is unlocked here and nowhere else that
    // matters: this is the one moment we are guaranteed to be inside a gesture.
    start: () => {
      if (get().started) return;
      ensureAudio();
      set({ started: true });
    },

    say: (line, speaker = "cow") => set({ dialogue: line, speaker }),

    setNearGrass: (id) => {
      if (get().nearGrass !== id) set({ nearGrass: id });
    },

    // Called every frame from `drive()`, so it has to be a no-op unless the
    // prompt actually changed — otherwise the whole HUD re-renders at 60fps.
    setPrompt: (p) => {
      const cur = get().prompt;
      if (cur === p) return;
      if (cur && p && cur.kind === p.kind && cur.id === p.id) return;
      set({ prompt: p });
    },

    regrow: (id) => {
      const next = [...get().grassEatenAt];
      if (next[id] === null) return;
      next[id] = null;
      set({ grassEatenAt: next });
    },

    // The single contextual action, bound to E. Whatever the cow is standing
    // next to decides what it does.
    interact: () => {
      const s = get();
      if (!s.started || s.activeGag || s.inCutscene) return;
      const p = s.prompt;
      if (!p) return;

      switch (p.kind) {
        case "grass": {
          if (s.grassEatenAt[p.id] !== null) return;
          const eaten = [...s.grassEatenAt];
          eaten[p.id] = Date.now();
          set({ grassEatenAt: eaten, nearGrass: null, prompt: null });
          timeouts.push(setTimeout(() => get().regrow(p.id), REGROW_MS));
          get().triggerGag("eat");
          return;
        }
        case "gate":
          ensureAudio();
          creak();
          set({ gateOpen: !s.gateOpen, prompt: null });
          return;
        case "scarecrow":
          get().triggerGag("bellow");
          return;
        case "pond":
          get().triggerGag("sip");
          return;
      }
    },

    /**
     * The speed camera going off. Rate-limited by the caller rather than
     * here, because `drive()` tests the trigger every frame and the cow
     * running past would otherwise be issued sixty tickets a second.
     */
    flash: () => {
      const s = get();
      if (!s.started || s.inCutscene) return;
      ensureAudio();
      shutter();
      addShake(0.18);
      const line = TICKET;
      set({ flashSeq: s.flashSeq + 1, dialogue: line, speaker: "cow" });
      timeouts.push(
        setTimeout(() => {
          if (get().dialogue === line) set({ dialogue: null });
        }, 3400)
      );
    },

    triggerGag: (id) => {
      if (!get().started || get().inCutscene) return;
      ensureAudio();
      clearScheduled();

      const gag = gags[id];
      const slapCount = id === "slap" ? get().slapCount + 1 : get().slapCount;

      // Fifth slap: the cow stops arguing and goes over your head. It still gets
      // hit first — the hand is already in the air — so the impact is scheduled
      // the same way and the cutscene starts on the back of it.
      const lastStraw = id === "slap" && slapCount >= SLAPS_BEFORE_POLICE;

      if (id === "slap") {
        // The swing starts now; everything the blow does happens when the hand
        // gets there. The hit itself is physics, not animation: the head is
        // thrown by a spring and the camera takes a knock with it.
        set({ slapAt: performance.now() });
        const impact = setTimeout(() => {
          slapImpulse();
          addShake(0.55);
          if (lastStraw) {
            smack();
            grunt();
            // Let the head-whip actually play before the cutscene takes the body
            // over — `startCutscene` relaxes every spring, so starting it on the
            // same frame as the impulse would wipe the hit off the cow.
            timeouts.push(setTimeout(() => get().startCutscene(), 430));
          }
        }, SLAP_IMPACT);
        timeouts.push(impact);
      }

      if (lastStraw) {
        set({ activeGag: null, dialogue: null, showLipMark: false, slapCount });
        return;
      }

      set({
        activeGag: id,
        gagStartedAt: performance.now(),
        dialogue: null,
        speaker: "cow",
        slapCount,
      });

      for (const step of gag.script) {
        const timeout = setTimeout(() => {
          if (step.sound) sounds[step.sound]();
          if (step.scare) set({ scareSeq: get().scareSeq + 1 });
          if (step.say || step.pool) {
            set({
              dialogue: step.pool ? pickLine(step.pool) : step.say ?? null,
              speaker: "cow",
            });
          }
          if (step.lips) {
            // The kiss lands: stamp the screen, knock the camera, squash the head.
            addShake(0.3);
            kissImpulse();
            set({ showLipMark: true, lipMarkSeq: get().lipMarkSeq + 1 });
            const hide = setTimeout(() => set({ showLipMark: false }), LIP_MARK_DURATION);
            timeouts.push(hide);
          }
        }, step.t);
        timeouts.push(timeout);
      }

      const end = setTimeout(() => set({ activeGag: null, dialogue: null }), gag.duration);
      timeouts.push(end);
    },

    /**
     * The dance button. A toggle rather than a fire-and-forget gag, because
     * nine seconds of cow is a long time to be locked out of your own controls
     * — and because the obvious thing to do with a dance button is press it
     * again.
     */
    toggleDance: () => {
      const s = get();
      if (!s.started || s.inCutscene) return;
      if (s.activeGag === "dance") {
        clearScheduled();
        set({ activeGag: null, dialogue: null });
        return;
      }
      if (s.activeGag) return; // busy being petted or slapped
      get().triggerGag("dance");
    },

    startCutscene: () => {
      clearScheduled();
      set({ inCutscene: true, activeGag: null, dialogue: null, showLipMark: false });
    },

    endCutscene: () => {
      // The cow shut the gate behind itself on the way back in, so the
      // player's switch has to agree with the panel or the next press of E
      // looks like it did nothing.
      set({ inCutscene: false, slapCount: 0, gateOpen: cowState.gateOpen > 0.5 });
      // let the parting line hang for a beat before clearing it
      const timeout = setTimeout(() => set({ dialogue: null }), 2200);
      timeouts.push(timeout);
    },
  };
});

import { create } from "zustand";
import { ensureAudio, smack, moo, chew, kissJingle, grunt } from "./audio";
import { gags, insultLines, LIP_MARK_DURATION } from "./reactions";
import { kissImpulse, slapImpulse } from "./physics";
import { addShake } from "./camera";
import { GRASS, REGROW_MS, SLAPS_BEFORE_POLICE } from "./world";
import type { Speaker } from "./cutscene";

export type GagId = "eat" | "shy" | "slap";

export interface CowStore {
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
  /** Timestamp each grass tuft was eaten, or null if it's standing. */
  grassEatenAt: (number | null)[];
  /** Id of the grass tuft the cow is close enough to eat, if any. */
  nearGrass: number | null;

  say: (line: string | null, speaker?: Speaker) => void;
  setNearGrass: (id: number | null) => void;
  regrow: (id: number) => void;
  interact: () => void;
  triggerGag: (id: GagId) => void;
  startCutscene: () => void;
  endCutscene: () => void;
}

let timeouts: ReturnType<typeof setTimeout>[] = [];
let lastInsult = -1;

function clearScheduled() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
}

function pickInsult(): string {
  let i = Math.floor(Math.random() * insultLines.length);
  if (insultLines.length > 1) {
    while (i === lastInsult) i = Math.floor(Math.random() * insultLines.length);
  }
  lastInsult = i;
  return insultLines[i];
}

const sounds = { smack, moo, chew, kiss: kissJingle, grunt };

export const useCowStore = create<CowStore>((set, get) => {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as { __cowStore?: unknown }).__cowStore = () => get();
  }
  return {
    activeGag: null,
    gagStartedAt: 0,
    inCutscene: false,
    dialogue: null,
    speaker: "cow",
    showLipMark: false,
    lipMarkSeq: 0,
    slapCount: 0,
    grassEatenAt: GRASS.map(() => null),
    nearGrass: null,

    say: (line, speaker = "cow") => set({ dialogue: line, speaker }),

    setNearGrass: (id) => {
      if (get().nearGrass !== id) set({ nearGrass: id });
    },

    regrow: (id) => {
      const next = [...get().grassEatenAt];
      if (next[id] === null) return;
      next[id] = null;
      set({ grassEatenAt: next });
    },

    // The single contextual action, bound to E. Right now the only thing in the
    // pen worth walking up to is grass; new interactables slot in here.
    interact: () => {
      const s = get();
      if (s.activeGag || s.inCutscene) return;
      const id = s.nearGrass;
      if (id === null || s.grassEatenAt[id] !== null) return;

      const eaten = [...s.grassEatenAt];
      eaten[id] = Date.now();
      set({ grassEatenAt: eaten, nearGrass: null });
      const timeout = setTimeout(() => get().regrow(id), REGROW_MS);
      timeouts.push(timeout);
      get().triggerGag("eat");
    },

    triggerGag: (id) => {
      if (get().inCutscene) return;
      ensureAudio();
      clearScheduled();

      const gag = gags[id];
      const slapCount = id === "slap" ? get().slapCount + 1 : get().slapCount;

      // The hit itself is physics, not animation: the head is thrown by a spring
      // and the camera takes a knock with it. Both happen on the same frame as
      // the crack, whether or not the cow then storms off.
      if (id === "slap") {
        slapImpulse();
        addShake(0.55);
      }

      // Fifth slap: the cow stops arguing and goes over your head.
      if (id === "slap" && slapCount >= SLAPS_BEFORE_POLICE) {
        set({ activeGag: null, dialogue: null, showLipMark: false, slapCount });
        smack();
        grunt();
        get().startCutscene();
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
          if (step.say || step.dynamicSay) {
            set({
              dialogue: step.dynamicSay ? pickInsult() : step.say ?? null,
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

    startCutscene: () => {
      clearScheduled();
      set({ inCutscene: true, activeGag: null, dialogue: null, showLipMark: false });
    },

    endCutscene: () => {
      set({ inCutscene: false, slapCount: 0 });
      // let the parting line hang for a beat before clearing it
      const timeout = setTimeout(() => set({ dialogue: null }), 2200);
      timeouts.push(timeout);
    },
  };
});

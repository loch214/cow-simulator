// Tiny synthesized sound effects via the Web Audio API. No audio files.
// The AudioContext can only start after a user gesture, so ensureAudio()
// must be called from inside a click/tap handler before any sound plays.

let ctx: AudioContext | null = null;

export function ensureAudio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

function now(c: AudioContext) {
  return c.currentTime;
}

export function smack() {
  const c = ensureAudio();
  const t0 = now(c);

  // Noise burst for the "crack"
  const bufferSize = c.sampleRate * 0.08;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.9, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  noise.connect(noiseGain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + 0.1);

  // Low thud under the noise
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.5, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
  osc.connect(oscGain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.16);
}

export function moo() {
  const c = ensureAudio();
  const t0 = now(c);
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.linearRampToValueAtTime(90, t0 + 0.3);
  osc.frequency.linearRampToValueAtTime(140, t0 + 0.9);
  osc.frequency.linearRampToValueAtTime(80, t0 + 1.3);

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.15);
  gain.gain.setValueAtTime(0.35, t0 + 1.0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);

  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 1.45);
}

export function chew() {
  const c = ensureAudio();
  const t0 = now(c);
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.18;
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220 + i * 10, t);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

export function kissJingle() {
  const c = ensureAudio();
  const t0 = now(c);
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const t = t0 + i * 0.14;
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);

    // cheesy vibrato
    const lfo = c.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + 0.5);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });

  // smooch pop at the end
  const popT = t0 + notes.length * 0.14 + 0.05;
  const pop = c.createOscillator();
  pop.type = "sine";
  pop.frequency.setValueAtTime(180, popT);
  pop.frequency.exponentialRampToValueAtTime(900, popT + 0.08);
  const popGain = c.createGain();
  popGain.gain.setValueAtTime(0.4, popT);
  popGain.gain.exponentialRampToValueAtTime(0.001, popT + 0.1);
  pop.connect(popGain).connect(c.destination);
  pop.start(popT);
  pop.stop(popT + 0.12);
}

/** A hoof landing. Slightly different every time so a walk doesn't sound looped. */
export function step() {
  const c = ensureAudio();
  const t0 = now(c);

  const size = Math.floor(c.sampleRate * 0.05);
  const buffer = c.createBuffer(1, size, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 3);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = "lowpass";
  band.frequency.value = 700 + Math.random() * 250;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.16, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
  noise.connect(band).connect(gain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + 0.08);

  // the dull thump of weight going through the ground
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(95 + Math.random() * 25, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.09);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.13, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  osc.connect(oscGain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.11);
}

/** Gate hinge. A wobbling saw through a narrow filter, which is most of a creak. */
export function creak() {
  const c = ensureAudio();
  const t0 = now(c);
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.linearRampToValueAtTime(240, t0 + 0.55);

  const wobble = c.createOscillator();
  wobble.frequency.value = 17;
  const wobbleGain = c.createGain();
  wobbleGain.gain.value = 22;
  wobble.connect(wobbleGain).connect(osc.frequency);

  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 6;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);

  osc.connect(band).connect(gain).connect(c.destination);
  osc.start(t0);
  wobble.start(t0);
  osc.stop(t0 + 0.75);
  wobble.stop(t0 + 0.75);
}

/** The winded grunt that comes out of the cow the instant it's hit. */
export function grunt() {
  const c = ensureAudio();
  const t0 = now(c);
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(230, t0);
  osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.28);

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);

  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.36);
}

/** A mouthful of pond. Filtered noise, gated into three wet gulps. */
export function slurp() {
  const c = ensureAudio();
  const t0 = now(c);
  const len = 0.42;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const u = i / data.length;
    // three bursts, each fading — the gate is what makes it read as gulping
    const pulse = Math.max(0, Math.sin(u * Math.PI * 6));
    data[i] = (Math.random() * 2 - 1) * pulse * (1 - u * 0.5);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(420, t0);
  band.frequency.linearRampToValueAtTime(900, t0 + len);
  band.Q.value = 2.2;
  const gain = c.createGain();
  gain.gain.value = 0.22;
  noise.connect(band).connect(gain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + len);
}

/** Sheep. A bleat is a wobbling saw that gives up halfway through. */
export function baa() {
  const c = ensureAudio();
  const t0 = now(c);
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  const base = 300 + Math.random() * 120;
  osc.frequency.setValueAtTime(base, t0);
  osc.frequency.linearRampToValueAtTime(base * 0.82, t0 + 0.45);

  // the tremble, which is the entire character of the sound
  const wobble = c.createOscillator();
  wobble.frequency.value = 21 + Math.random() * 6;
  const wobbleGain = c.createGain();
  wobbleGain.gain.value = base * 0.09;
  wobble.connect(wobbleGain).connect(osc.frequency);

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1100;
  filter.Q.value = 1.6;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);

  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  wobble.start(t0);
  osc.stop(t0 + 0.52);
  wobble.stop(t0 + 0.52);
}

/** The speed camera. Two capacitor whines and a shutter clack. */
export function shutter() {
  const c = ensureAudio();
  const t0 = now(c);
  for (const [at, freq] of [[0, 2400], [0.12, 3100]] as [number, number][]) {
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t0 + at);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.06);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.07);
  }
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.05), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2000;
  const g = c.createGain();
  g.gain.value = 0.3;
  noise.connect(hp).connect(g).connect(c.destination);
  noise.start(t0 + 0.13);
  noise.stop(t0 + 0.19);
}

/**
 * Running into something at full gallop: a hollow thud and then a cartoon
 * boing, a spring wobbling down in pitch. The boing is the joke; the thud is
 * what makes it sound like it hurt.
 */
export function bonk() {
  const c = ensureAudio();
  const t0 = now(c);

  const thud = c.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(140, t0);
  thud.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.55, t0);
  tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  thud.connect(tg).connect(c.destination);
  thud.start(t0);
  thud.stop(t0 + 0.24);

  const boing = c.createOscillator();
  boing.type = "triangle";
  const wobble = c.createOscillator();
  wobble.frequency.setValueAtTime(18, t0);
  wobble.frequency.linearRampToValueAtTime(7, t0 + 0.7);
  const wg = c.createGain();
  wg.gain.setValueAtTime(60, t0 + 0.05);
  wg.gain.linearRampToValueAtTime(8, t0 + 0.75);
  wobble.connect(wg).connect(boing.frequency);
  boing.frequency.setValueAtTime(330, t0 + 0.05);
  boing.frequency.exponentialRampToValueAtTime(160, t0 + 0.75);
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t0 + 0.04);
  bg.gain.exponentialRampToValueAtTime(0.22, t0 + 0.07);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
  boing.connect(bg).connect(c.destination);
  boing.start(t0 + 0.04);
  wobble.start(t0 + 0.04);
  boing.stop(t0 + 0.82);
  wobble.stop(t0 + 0.82);
}

/** A thing ticked off the list: two bright notes going up. */
export function ding() {
  const c = ensureAudio();
  const t0 = now(c);
  [[0, 880], [0.11, 1318.5]].forEach(([at, f]) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t0 + at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
    o.connect(g).connect(c.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 0.62);
  });
}

/** The fine landing: a till drawer and a bell. Ka-ching. */
export function kaching() {
  const c = ensureAudio();
  const t0 = now(c);
  // the drawer: a short burst of filtered noise
  const len = Math.floor(c.sampleRate * 0.12);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const n = c.createBufferSource();
  n.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 1.4;
  const ng = c.createGain();
  ng.gain.value = 0.25;
  n.connect(bp).connect(ng).connect(c.destination);
  n.start(t0);
  // the bell: two inharmonic partials ringing out
  [2093, 3135].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.14 / (i + 1), t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g).connect(c.destination);
    o.start(t0 + 0.09);
    o.stop(t0 + 0.92);
  });
}

/** A sheep, launched. The same bleat, an octave up and with a swoop on it. */
export function yeet() {
  const c = ensureAudio();
  const t0 = now(c);
  const o = c.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(520, t0);
  o.frequency.exponentialRampToValueAtTime(980, t0 + 0.25);
  o.frequency.exponentialRampToValueAtTime(400, t0 + 0.8);
  const w = c.createOscillator();
  w.frequency.value = 24;
  const wg = c.createGain();
  wg.gain.value = 50;
  w.connect(wg).connect(o.frequency);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1300;
  f.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
  o.connect(f).connect(g).connect(c.destination);
  o.start(t0);
  w.start(t0);
  o.stop(t0 + 0.9);
  w.stop(t0 + 0.9);
}

/** Celebration: a little ascending arpeggio, for finishing the list. */
export function fanfare() {
  const c = ensureAudio();
  const t0 = now(c);
  [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
    const t = t0 + i * 0.13 + (i > 3 ? 0.08 : 0);
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 5 ? 0.9 : 0.25));
    o.connect(lp).connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.95);
  });
}

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

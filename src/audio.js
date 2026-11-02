// Efectos de sonido procedurales (WebAudio): no necesitan archivos.
let ctx = null;
const settings = { enabled: true, volume: 0.6 };

export const audioSettings = settings;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.18, slide = 0, delay = 0 } = {}) {
  if (!settings.enabled) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain * settings.volume, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur, { gain = 0.1, delay = 0, freq = 1800 } = {}) {
  if (!settings.enabled) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain * settings.volume;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export const sfx = {
  click: () => tone(520, 0.06, { type: 'triangle', gain: 0.12 }),
  hover: () => tone(700, 0.03, { type: 'sine', gain: 0.05 }),
  dice: () => { for (let i = 0; i < 7; i++) noise(0.05, { delay: i * 0.12, gain: 0.14, freq: 1200 + Math.random() * 1500 }); tone(220, 0.1, { delay: 0.85, type: 'square', gain: 0.08 }); },
  hop: () => tone(380 + Math.random() * 80, 0.09, { type: 'triangle', slide: 160, gain: 0.1 }),
  star: () => { [880, 1175, 1568].forEach((f, i) => tone(f, 0.18, { delay: i * 0.08, type: 'triangle', gain: 0.14 })); },
  trip: () => { tone(300, 0.3, { type: 'sawtooth', slide: -220, gain: 0.12 }); noise(0.15, { gain: 0.1, delay: 0.1, freq: 300 }); },
  zap: () => tone(900, 0.25, { type: 'sawtooth', slide: -700, gain: 0.1 }),
  teleport: () => { tone(300, 0.4, { type: 'sine', slide: 900, gain: 0.12 }); tone(1200, 0.3, { type: 'triangle', slide: -800, delay: 0.3, gain: 0.08 }); },
  ability: () => { tone(660, 0.12, { type: 'triangle', gain: 0.12 }); tone(990, 0.18, { type: 'triangle', delay: 0.1, gain: 0.1 }); },
  turn: () => tone(440, 0.08, { type: 'sine', gain: 0.08 }),
  bad: () => tone(200, 0.25, { type: 'square', slide: -80, gain: 0.08 }),
  elim: () => { tone(160, 0.6, { type: 'sawtooth', slide: -100, gain: 0.15 }); noise(0.4, { gain: 0.15, freq: 400 }); },
  finish: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { delay: i * 0.1, type: 'triangle', gain: 0.16 })); },
  win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { delay: i * 0.14, type: 'triangle', gain: 0.18 })); },
};

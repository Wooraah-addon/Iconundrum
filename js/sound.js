// Sound engine. Web Audio synthesis out of the box; if a real sample exists
// at assets/sounds/<name>.ogg it's used instead — so extracted in-game sounds
// (wow.export / CASCExplorer, per the curated mapping in the spec) can drop
// in later with zero code changes. Mute toggle persisted in localStorage.

const MUTE_KEY = 'iconundrum_muted';
const NAMES = ['click', 'coin', 'correct', 'wrong', 'jackpot', 'tick', 'gameover', 'fanfare', 'readycheck'];

let ctx = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
const buffers = new Map(); // name -> AudioBuffer (real sample) once loaded

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Try to fetch real samples once (first user gesture). 404s are expected
// until a sound pack ships — synth covers everything meanwhile.
let preloaded = false;
export function preload() {
  if (preloaded) return;
  preloaded = true;
  for (const name of NAMES) {
    fetch(`assets/sounds/${name}.ogg`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then(buf => ac().decodeAudioData(buf))
      .then(decoded => buffers.set(name, decoded))
      .catch(() => {});
  }
}

export function isMuted() { return muted; }

export function toggleMuted() {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  return muted;
}

export function play(name) {
  if (muted) return;
  try {
    const buf = buffers.get(name);
    if (buf) {
      const c = ac();
      const src = c.createBufferSource();
      const g = c.createGain();
      g.gain.value = 0.5;
      src.buffer = buf;
      src.connect(g).connect(c.destination);
      src.start();
    } else if (SYNTH[name]) {
      SYNTH[name]();
    }
  } catch { /* audio is never load-bearing */ }
}

// --- synth voices -----------------------------------------------------

function tone(freq, at, dur, type = 'sine', gain = 0.15, slideTo = null) {
  const c = ac();
  const t0 = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const SYNTH = {
  // lock-in / button feel — AH-click energy
  click: () => { tone(900, 0, 0.05, 'square', 0.10); tone(1400, 0.03, 0.05, 'square', 0.07); },
  // single coin clink — small win, HL correct call
  coin: () => { tone(1318, 0, 0.09, 'triangle', 0.14); tone(1760, 0.05, 0.13, 'triangle', 0.11); },
  // coin-loot jingle — correct answer
  correct: () => { [659, 784, 988].forEach((f, i) => tone(f, i * 0.07, 0.14, 'triangle', 0.15)); },
  // descending two-tone — QUEST FAILED energy
  wrong: () => { tone(220, 0, 0.18, 'sawtooth', 0.10); tone(147, 0.16, 0.34, 'sawtooth', 0.10); },
  // epic loot fanfare — exact price guess
  jackpot: () => {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, i * 0.075, 0.22, 'triangle', 0.13));
    tone(2093, 0.45, 0.5, 'sine', 0.07);
  },
  // countdown final seconds — raid-warning pulse
  tick: () => tone(1000, 0, 0.05, 'sine', 0.07),
  // run over
  gameover: () => { tone(196, 0, 0.28, 'square', 0.09); tone(131, 0.24, 0.55, 'square', 0.09); },
  // personal best
  fanfare: () => {
    [523, 659, 784].forEach(f => tone(f, 0, 0.55, 'triangle', 0.08));
    [659, 784, 1046].forEach(f => tone(f, 0.28, 0.7, 'triangle', 0.08));
  },
  // raid ready check — the real sample (levelup2) ships in assets/sounds;
  // this two-note chime only covers a failed fetch
  readycheck: () => { tone(587, 0, 0.12, 'triangle', 0.15); tone(880, 0.1, 0.4, 'triangle', 0.15); },
};

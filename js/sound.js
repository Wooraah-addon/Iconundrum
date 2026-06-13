// Sound engine. Web Audio synthesis is the permanent DEFAULT and fallback.
// Optional themed sample packs (Alliance / Horde, plus a locked secret pack)
// layer real .ogg voice lines over the meaningful cues. High-frequency cues
// (correct/wrong) are POOLS of variant clips picked at random with a
// no-immediate-repeat guard, so a worker pack doesn't become a soundboard.
// Resolution order is pack sample -> shared sample -> synth; the packs are a
// removable layer on the synth floor, never a replacement.
//
// ESCAPE HATCH: SOUNDS_GENERIC_ONLY (below) forces synth for everything in one
// line; deleting assets/sounds/<pack>/ does the same physically. Either reverts
// the whole site to the generic sound set with no other code change.

const MUTE_KEY = 'iconundrum_muted';
const PACK_KEY = 'iconundrum_pack';
const SAFE_KEY = 'iconundrum_streamersafe';
const UNLOCK_KEY = 'iconundrum_packs_unlocked'; // CSV of unlocked locked-packs (F12/F54 writes this)

// --- ESCAPE HATCH -----------------------------------------------------
// Flip to true to force the synthesized fallback for EVERY sound, ignoring
// pack selection and any installed samples — a one-line revert of the whole
// site to the generic sound set (e.g. if the Blizzard-flavoured packs ever
// have to be pulled). Physical removal of assets/sounds/<pack>/ does the same.
const SOUNDS_GENERIC_ONLY = false;

// Sound keys. start/confirm are pack voice moments (game begin / ready-up);
// their synth is intentionally minimal (start is silent, confirm = click) so
// the default experience is byte-for-byte unchanged.
const NAMES = ['click', 'coin', 'correct', 'wrong', 'jackpot', 'tick', 'gameover', 'fanfare', 'readycheck', 'start', 'confirm'];

// Packs supply samples per key as a VARIANT COUNT: 1 = a single file
// `<pack>/<key>.ogg`; N = a pool `<pack>/<key>1.ogg`..`<key>N.ogg` picked at
// random. Keys absent here (click/coin/tick) fall through to synth. mrrgl ships
// LOCKED — the unlock flag is written by the achievement system (F12/F54).
const PACKS = {
  alliance: { correct: 18, wrong: 19, jackpot: 1, gameover: 1, fanfare: 1, start: 1, confirm: 1 },
  horde: { correct: 15, wrong: 16, jackpot: 1, gameover: 1, fanfare: 1, start: 1, confirm: 1 },
  mrrgl: { correct: 1, wrong: 1, jackpot: 1, gameover: 1, fanfare: 1, start: 1 },
};

// UI metadata for the pack selector. id '' = the default synth set.
export const PACK_META = [
  { id: '', label: 'Classic', desc: 'The original Iconundrum sounds.' },
  { id: 'alliance', label: 'Alliance', desc: 'Human — congratulations & groans' },
  { id: 'horde', label: 'Horde', desc: 'Orc — congratulations & groans' },
  { id: 'mrrgl', label: '????', desc: '???', locked: true },
];

// Per-sample playback gain. Keyed by "pack/name" first, then by name, default
// 0.5. Levels were measured with ffmpeg volumedetect and matched to the
// readycheck reference (mean -12.4 dB @ 0.3 — the level vetted on stream after
// B8). The multi-race correct/wrong pools are ffmpeg loudnorm'd to a uniform
// ~-19 dB so one gain per pool sits them evenly; 0.55 keeps these (frequent,
// every-answer) voice lines just under the readycheck level. Re-measure if any
// sample is resourced.
const SAMPLE_GAIN = {
  readycheck: 0.3,
  // Generic fallbacks for any future pack key left untuned below.
  jackpot: 0.4, fanfare: 0.4, gameover: 0.45,
  'horde/correct': 0.55, 'horde/wrong': 0.55, 'horde/confirm': 0.63,
  'horde/start': 0.70, 'horde/gameover': 0.59, 'horde/jackpot': 0.55, 'horde/fanfare': 0.38,
  'alliance/correct': 0.55, 'alliance/wrong': 0.55, 'alliance/confirm': 0.40,
  'alliance/start': 0.57, 'alliance/gameover': 0.32, 'alliance/jackpot': 0.55, 'alliance/fanfare': 0.38,
  'mrrgl/correct': 0.55, 'mrrgl/wrong': 0.70, 'mrrgl/start': 0.70,
  'mrrgl/gameover': 0.70, 'mrrgl/jackpot': 0.39, 'mrrgl/fanfare': 0.39,
};

// Min gap before the same key's SAMPLE may play again. Voice lines and stingers
// are recognizable — replaying them every second turns charming into noise (the
// review's top safeguard). The synth fallback has no cooldown, so a fast player
// still gets feedback, just not the repeated voice line.
const COOLDOWN_MS = {
  correct: 1500, wrong: 1500, confirm: 1200, start: 0,
  gameover: 0, jackpot: 5000, fanfare: 5000,
};

// Streamer-safe: keep the loud stingers off (synth is quieter and shorter),
// and trim overall sample gain.
const LOUD = new Set(['jackpot', 'fanfare']);

let ctx = null;
let muted = read(MUTE_KEY) === '1';
let streamerSafe = read(SAFE_KEY) === '1';
let pack = initPack();
const samples = new Map();    // bufKey -> AudioBuffer[] (1+ variants) once loaded
const tried = new Set();      // file paths already fetched (don't refetch on 404)
const lastPlayed = new Map(); // name -> ms timestamp (cooldowns)
const lastVariant = new Map(); // bufKey -> last variant index (no immediate repeat)

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function initPack() {
  const p = read(PACK_KEY) || '';
  return (PACKS[p] && isPackUnlocked(p)) ? p : '';
}

export function isPackUnlocked(id) {
  const meta = PACK_META.find(p => p.id === id);
  if (!meta) return false;
  if (!meta.locked) return true;
  return (read(UNLOCK_KEY) || '').split(',').includes(id);
}

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function bufKey(p, name) { return p ? `${p}/${name}` : name; }
function packHas(p, name) { return !!(p && PACKS[p] && name in PACKS[p]); }

// Fetch one sample file once (idx 0 = single `name.ogg`; idx>=1 = `nameN.ogg`).
// 404s are expected until a pack ships — synth covers everything meanwhile.
function loadFile(p, name, idx) {
  const dir = p ? `${p}/` : '';
  const path = `assets/sounds/${dir}${name}${idx > 0 ? idx : ''}.ogg`;
  if (tried.has(path)) return;
  tried.add(path);
  const key = bufKey(p, name);
  fetch(path)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
    .then(buf => ac().decodeAudioData(buf))
    .then(decoded => { if (!samples.has(key)) samples.set(key, []); samples.get(key).push(decoded); })
    .catch(() => {});
}

function loadKey(p, name) {
  const count = packHas(p, name) ? PACKS[p][name] : 1;
  if (count <= 1) loadFile(p, name, 0);
  else for (let i = 1; i <= count; i++) loadFile(p, name, i);
}

function loadPack(p) {
  if (!PACKS[p]) return;
  for (const name of Object.keys(PACKS[p])) loadKey(p, name);
}

let preloaded = false;
export function preload() {
  if (preloaded) return;
  preloaded = true;
  for (const name of NAMES) loadFile('', name, 0); // shared samples (today: readycheck)
  if (pack) loadPack(pack);
}

// Warm a specific pack's samples ahead of a preview (sound-test panel).
export function warmPack(id) { loadPack(id); }

export function isMuted() { return muted; }
export function toggleMuted() { muted = !muted; write(MUTE_KEY, muted ? '1' : '0'); return muted; }

export function getPack() { return pack; }
export function listPacks() { return PACK_META; }
export function setPack(id) {
  if (!PACKS[id]) id = '';                      // '' = default / synth
  if (id && !isPackUnlocked(id)) return pack;   // refuse a locked pack
  pack = id;
  write(PACK_KEY, id);
  if (id) loadPack(id);
  return pack;
}

export function isStreamerSafe() { return streamerSafe; }
export function setStreamerSafe(on) { streamerSafe = !!on; write(SAFE_KEY, streamerSafe ? '1' : '0'); return streamerSafe; }

function offCooldown(name) {
  const cd = COOLDOWN_MS[name] || 0;
  if (!cd) return true;
  return Date.now() - (lastPlayed.get(name) || 0) >= cd;
}

// Pick a loaded variant for a pool key, avoiding an immediate repeat.
function pickVariant(key) {
  const list = samples.get(key);
  if (!list || !list.length) return null;
  if (list.length === 1) return list[0];
  const last = lastVariant.get(key);
  let i;
  do { i = Math.floor(Math.random() * list.length); } while (i === last);
  lastVariant.set(key, i);
  return list[i];
}

// Resolve (pack, name) to a buffer + its gain key: pack pool first, then the
// shared sample. Warms a missing pack sample for next time (preview path).
function sampleFor(p, name) {
  if (packHas(p, name)) {
    const k = bufKey(p, name);
    const buf = pickVariant(k);
    if (buf) return { buf, gainKey: k };
    loadKey(p, name);
  }
  const rk = bufKey('', name);
  const rbuf = pickVariant(rk);
  return rbuf ? { buf: rbuf, gainKey: rk } : null;
}

// play(name, opts?) — opts.pack forces a pack (sound-test preview), '' = default;
// opts.force bypasses the cooldown (previews should always sound the sample).
export function play(name, opts = {}) {
  if (muted) return;
  try {
    if (SOUNDS_GENERIC_ONLY) return synth(name);
    const usePack = opts.pack !== undefined ? opts.pack : pack;
    const sampleAllowed = !(streamerSafe && LOUD.has(name));
    const s = sampleAllowed ? sampleFor(usePack, name) : null;
    if (s && (opts.force || offCooldown(name))) {
      lastPlayed.set(name, Date.now());
      playBuffer(s.buf, s.gainKey, name);
    } else {
      synth(name); // graceful fallback — feedback without the repeated voice line
    }
  } catch { /* audio is never load-bearing */ }
}

function playBuffer(buf, gainKey, name) {
  const c = ac();
  const src = c.createBufferSource();
  const g = c.createGain();
  let gain = SAMPLE_GAIN[gainKey] ?? SAMPLE_GAIN[name] ?? 0.5;
  if (streamerSafe) gain *= 0.7;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(c.destination);
  src.start();
}

function synth(name) {
  const fn = SYNTH[name];
  if (fn) fn();
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
  // this two-note chime only covers a failed fetch (kept in step with the
  // sample's reduced volume)
  readycheck: () => { tone(587, 0, 0.12, 'triangle', 0.09); tone(880, 0.1, 0.4, 'triangle', 0.09); },
};

// confirm shares the click voice so the default ready-up still clicks; packs
// override it with a worker "aye" line. start has no synth — game-begin is
// silent by default and only speaks when a pack supplies it.
SYNTH.confirm = SYNTH.click;

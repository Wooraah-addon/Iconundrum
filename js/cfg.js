// Game configuration: defaults, URL encoding/decoding, challenge signatures.
// The full config encodes into the challenge link so a shared URL reproduces
// the exact game; custom settings get their own leaderboard bucket (scores
// are only comparable within identical configs).

export const DEFAULTS = {
  icon: { rounds: 5, timer: 10, speed: 1 },
  value: { rounds: 5, timer: 20, curve: 2 },
  hl: { sep: 125 },
};
// Price basis ('mv' posted market avg / 'sa' TSM sale avg) is NOT in DEFAULTS:
// links without ?b= must decode as 'mv' so pre-basis links and leaderboards
// stay valid, while the setup modal defaults NEW games to 'sa' (see setup.js).

export const LIMITS = {
  rounds: [3, 20],
  iconTimer: [5, 30],
  valueTimer: [10, 60],
  curves: [1, 2, 4],     // casual / standard / tycoon
  seps: [110, 125],      // tycoon / standard (ratio x100)
};

const clamp = (n, [lo, hi], dflt) =>
  Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;

// Build a complete, validated cfg for a mode from partial options.
export function makeCfg(mode, opts = {}) {
  const d = DEFAULTS[mode];
  const cfg = {
    mode,
    pack: 'items',
    cat: typeof opts.cat === 'string' && /^[a-z]{2,12}$/.test(opts.cat) ? opts.cat : 'all',
    seed: opts.seed,
    v: opts.v,
  };
  if (mode === 'icon') {
    cfg.rounds = clamp(opts.rounds, LIMITS.rounds, d.rounds);
    cfg.timer = clamp(opts.timer, LIMITS.iconTimer, d.timer);
    cfg.speed = opts.speed === 0 ? 0 : 1;
    // Hard mode (type the name, no choices) defaults OFF and is absent from
    // pre-hard links, so old links and leaderboard sigs are untouched.
    cfg.hard = opts.hard === 1 ? 1 : 0;
  } else if (mode === 'value') {
    cfg.rounds = clamp(opts.rounds, LIMITS.rounds, d.rounds);
    cfg.timer = clamp(opts.timer, LIMITS.valueTimer, d.timer);
    cfg.curve = LIMITS.curves.includes(opts.curve) ? opts.curve : d.curve;
    cfg.basis = opts.basis === 'sa' ? 'sa' : 'mv';
  } else if (mode === 'hl') {
    cfg.sep = LIMITS.seps.includes(opts.sep) ? opts.sep : d.sep;
    cfg.basis = opts.basis === 'sa' ? 'sa' : 'mv';
  }
  return cfg;
}

// Per-mode settings signature — part of the challenge key, so different
// settings never share a leaderboard. The sale-avg basis appends a marker;
// market-avg keeps the original format so pre-basis boards stay reachable.
export function cfgSig(cfg) {
  if (cfg.mode === 'icon') return `r${cfg.rounds}t${cfg.timer}sp${cfg.speed}${cfg.hard ? 'h1' : ''}`;
  const b = cfg.basis === 'sa' ? 'bsa' : '';
  if (cfg.mode === 'value') return `r${cfg.rounds}t${cfg.timer}k${cfg.curve}${b}`;
  return `sep${cfg.sep}${b}`;
}

// The all-time board is RANKED: it only admits the mode's default
// competitive ruleset — otherwise a 20-round game tops a 5-round game on
// score ceiling alone. Category, seed and price basis don't move the
// ceiling, so they all rank; rounds/timer/scoring/hard must be default.
// Defined on the sig so saved games can be classified from their challenge
// key alone (no schema change).
export function isRankedSig(mode, sig) {
  const base = cfgSig(makeCfg(mode, { seed: 'x', v: 1 }));
  return sig === base || sig === base + 'bsa';
}

export function isRanked(cfg) {
  return isRankedSig(cfg.mode, cfgSig(cfg));
}

export function buildUrl(cfg, absolute = true) {
  const p = new URLSearchParams({ mode: cfg.mode, pack: cfg.pack, cat: cfg.cat, seed: cfg.seed, v: String(cfg.v) });
  if (cfg.mode === 'icon') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('sp', cfg.speed); if (cfg.hard) p.set('h', 1); }
  else if (cfg.mode === 'value') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('k', cfg.curve); p.set('b', cfg.basis); }
  else { p.set('sep', cfg.sep); p.set('b', cfg.basis); }
  const path = `${location.pathname}?${p}`;
  return absolute ? `${location.origin}${path}` : path;
}

// Parse a challenge link back into a cfg (null if no valid challenge present).
export function cfgFromParams(params) {
  const mode = params.get('mode');
  const seed = params.get('seed');
  if (!['icon', 'value', 'hl'].includes(mode)) return null;
  if (!seed || !/^[a-z0-9]{1,16}$/i.test(seed)) return null;
  const int = k => { const n = parseInt(params.get(k), 10); return Number.isNaN(n) ? undefined : n; };
  return makeCfg(mode, {
    cat: params.get('cat') || 'all',
    seed,
    v: int('v'),
    rounds: int('r'),
    timer: int('t'),
    speed: int('sp'),
    hard: int('h'),
    curve: int('k'),
    sep: int('sep'),
    basis: params.get('b'),
  });
}

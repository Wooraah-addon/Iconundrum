// Game configuration: defaults, URL encoding/decoding, challenge signatures.
// The full config encodes into the challenge link so a shared URL reproduces
// the exact game; custom settings get their own leaderboard bucket (scores
// are only comparable within identical configs).

export const DEFAULTS = {
  icon: { rounds: 10, timer: 10, speed: 1 },
  value: { rounds: 10, timer: 20, curve: 2 },
  hl: { sep: 125 },
};
// 2026-06-11: default rounds 5 → 10 (user request). NOTE: the ranked ruleset
// is derived from these defaults (isRankedSig), so the all-time icon/value
// boards restarted on the r10 ruleset that day — day-one r5 games keep their
// challenge boards but no longer rank all-time (r5 vs r10 scores aren't
// comparable on one board anyway).
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
    // Extra lives (2-4 total) survive wrong calls. Default 1 = the only
    // ranked variant; absent from pre-lives links so old sigs are untouched.
    cfg.lives = Number.isInteger(opts.lives) && opts.lives >= 2 && opts.lives <= 4 ? opts.lives : 1;
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
  return `sep${cfg.sep}${cfg.lives > 1 ? `hp${cfg.lives}` : ''}${b}`;
}

// The all-time board is RANKED: it only admits the mode's default
// competitive ruleset — otherwise a 20-round game tops a 5-round game on
// score ceiling alone — AND the full Everything pool (user decision
// 2026-06-12, supersedes the v0.6.1 any-category rule: themed pools skew
// difficulty even when the ceiling is unchanged — a Mounts-only HL chain
// plays easier than the open pool). Seed and price basis still rank.
// Defined on the stored challenge key so saved games classify retroactively
// (no schema change).
export function isRankedSig(mode, sig) {
  const base = cfgSig(makeCfg(mode, { seed: 'x', v: 1 }));
  return sig === base || sig === base + 'bsa';
}

// Classify a stored game by its full challenge key:
// mode_pack.cat_seed_vN_sig (no token contains '_').
export function isRankedKey(mode, ck) {
  const parts = String(ck).split('_');
  return parts.length >= 5 && parts[1] === 'items.all'
    && isRankedSig(mode, parts[parts.length - 1]);
}

export function isRanked(cfg) {
  return cfg.cat === 'all' && isRankedSig(cfg.mode, cfgSig(cfg));
}

export function buildUrl(cfg, absolute = true) {
  const p = new URLSearchParams({ mode: cfg.mode, pack: cfg.pack, cat: cfg.cat, seed: cfg.seed, v: String(cfg.v) });
  if (cfg.mode === 'icon') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('sp', cfg.speed); if (cfg.hard) p.set('h', 1); }
  else if (cfg.mode === 'value') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('k', cfg.curve); p.set('b', cfg.basis); }
  else { p.set('sep', cfg.sep); p.set('b', cfg.basis); if (cfg.lives > 1) p.set('hp', cfg.lives); }
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
    lives: int('hp'),
  });
}

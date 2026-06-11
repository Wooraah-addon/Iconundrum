// Game configuration: defaults, URL encoding/decoding, challenge signatures.
// The full config encodes into the challenge link so a shared URL reproduces
// the exact game; custom settings get their own leaderboard bucket (scores
// are only comparable within identical configs).

export const DEFAULTS = {
  icon: { rounds: 5, timer: 10, speed: 1 },
  value: { rounds: 5, timer: 20, curve: 2 },
  hl: { sep: 125 },
};

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
  } else if (mode === 'value') {
    cfg.rounds = clamp(opts.rounds, LIMITS.rounds, d.rounds);
    cfg.timer = clamp(opts.timer, LIMITS.valueTimer, d.timer);
    cfg.curve = LIMITS.curves.includes(opts.curve) ? opts.curve : d.curve;
  } else if (mode === 'hl') {
    cfg.sep = LIMITS.seps.includes(opts.sep) ? opts.sep : d.sep;
  }
  return cfg;
}

// Per-mode settings signature — part of the challenge key, so different
// settings never share a leaderboard.
export function cfgSig(cfg) {
  if (cfg.mode === 'icon') return `r${cfg.rounds}t${cfg.timer}sp${cfg.speed}`;
  if (cfg.mode === 'value') return `r${cfg.rounds}t${cfg.timer}k${cfg.curve}`;
  return `sep${cfg.sep}`;
}

export function buildUrl(cfg, absolute = true) {
  const p = new URLSearchParams({ mode: cfg.mode, pack: cfg.pack, cat: cfg.cat, seed: cfg.seed, v: String(cfg.v) });
  if (cfg.mode === 'icon') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('sp', cfg.speed); }
  else if (cfg.mode === 'value') { p.set('r', cfg.rounds); p.set('t', cfg.timer); p.set('k', cfg.curve); }
  else p.set('sep', cfg.sep);
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
    curve: int('k'),
    sep: int('sep'),
  });
}

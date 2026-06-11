// localStorage player profile — name, per-mode personal bests, games played.

import { GAME } from './config.js';
import { cleanName } from './profanity.js';

const KEY = 'iconundrum_profile_v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch { return {}; }
}

function save(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function getName() {
  return load().name || '';
}

export function setName(raw) {
  const name = cleanName(raw, GAME.maxNameLen);
  if (!name) return null;
  const p = load();
  p.name = name;
  save(p);
  return name;
}

// Returns { pb: bool, best: number } — records the result and reports
// whether it's a new personal best for that mode.
export function recordGame(mode, score) {
  const p = load();
  p.stats = p.stats || {};
  const s = p.stats[mode] = p.stats[mode] || { played: 0, best: 0 };
  s.played += 1;
  const pb = score > s.best && s.played > 1;
  if (score > s.best) s.best = score;
  save(p);
  return { pb, best: s.best, played: s.played };
}

export function getStats() {
  return load().stats || {};
}

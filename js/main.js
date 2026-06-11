// Iconundrum — orchestrator. Home / setup / game / summary flow, challenge
// links, leaderboards, share, sound. Challenge link format:
// ?mode=icon&pack=items&cat=all&seed=x&v=1&r=5&t=10&sp=1 — the full config
// reproduces the exact game; leaderboard buckets key on the whole config so
// custom-settings scores never mix.

import { loadBundle, catLabel } from './data.js';
import { newSeed } from './rng.js';
import { makeCfg, cfgFromParams, buildUrl } from './cfg.js';
import { showScreen, el, toast, copyText } from './ui.js';
import { openSetup } from './setup.js';
import * as sound from './sound.js';
import * as profile from './profile.js';
import * as fire from './fire.js';
import * as modeIcon from './modes/icon.js';
import * as modeValue from './modes/value.js';
import * as modeHl from './modes/hl.js';

const MODES = { icon: modeIcon, value: modeValue, hl: modeHl };
const MODE_LABELS = { icon: 'Guess the Icon', value: 'Guess the Value', hl: 'Higher or Lower' };

let bundle = null;
let game = null; // { cfg, result }

// ---------------------------------------------------------------- boot

async function boot() {
  const params = new URLSearchParams(location.search);
  const linkV = parseInt(params.get('v'), 10);

  try {
    bundle = await loadBundle(Number.isInteger(linkV) ? linkV : undefined);
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="panel">Failed to load the item data bundle. Try a hard refresh.</div>`;
    throw e;
  }

  document.getElementById('price-date').textContent = bundle.priceDate;
  setupHome();

  const linkCfg = cfgFromParams(params);
  if (linkCfg) {
    linkCfg.v = bundle.versionMismatch ? bundle.version : linkCfg.v || bundle.version;
    showChallengeBanner(linkCfg);
  }
  showScreen('screen-home');
}

// ---------------------------------------------------------------- home

function setupHome() {
  const nameInput = document.getElementById('player-name');
  nameInput.value = profile.getName();
  nameInput.addEventListener('change', () => {
    const ok = profile.setName(nameInput.value);
    if (ok) { nameInput.value = ok; nameInput.classList.remove('invalid'); }
    else if (nameInput.value.trim()) { nameInput.classList.add('invalid'); toast('Pick a friendlier name'); }
  });

  document.querySelectorAll('.mode-card[data-mode]').forEach(card => {
    card.addEventListener('click', () => {
      if (!requireName()) return;
      sound.preload();
      sound.play('click');
      openSetup(card.dataset.mode, bundle, cfg => startGame(cfg));
    });
  });

  document.querySelectorAll('.sound-toggle').forEach(btn => {
    btn.textContent = sound.isMuted() ? '🔇' : '🔊';
    btn.addEventListener('click', () => {
      const muted = sound.toggleMuted();
      document.querySelectorAll('.sound-toggle').forEach(b => (b.textContent = muted ? '🔇' : '🔊'));
      if (!muted) sound.play('coin');
    });
  });
}

function cfgSummary(cfg) {
  const bits = [MODE_LABELS[cfg.mode], catLabel(cfg.cat)];
  if (cfg.mode === 'icon') bits.push(`${cfg.rounds} rounds`, `${cfg.timer}s`, cfg.speed ? 'speed bonus' : 'flat scoring');
  if (cfg.mode === 'value') bits.push(`${cfg.rounds} rounds`, `${cfg.timer}s`, { 1: 'casual', 2: 'goblin', 4: 'tycoon' }[cfg.curve] + ' scoring');
  if (cfg.mode === 'hl') bits.push(cfg.sep === 110 ? 'tycoon calls' : 'goblin calls');
  return bits.join(' · ');
}

function showChallengeBanner(cfg) {
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>You've been challenged!</b> Game code <b>${cfg.seed}</b><br>${cfgSummary(cfg)}<br>Same rounds for everyone who opens this link.` }),
    bundle.versionMismatch
      ? el('div', { html: `<br><b>Heads up:</b> this link was made with an older content pack. You'll play the current pack — scores land on a fresh board.` })
      : null,
    el('div', { style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: () => { sound.preload(); startGame(cfg); } }, 'Accept challenge')),
  ));
}

// ---------------------------------------------------------------- game

function requireName() {
  if (profile.getName()) return true;
  const input = document.getElementById('player-name');
  const entered = profile.setName(input.value);
  if (entered) return true;
  showScreen('screen-home');
  input.focus();
  toast('Enter a name first — it goes on the leaderboard');
  return false;
}

function startGame(cfg) {
  if (!requireName()) return;
  game = { cfg };

  history.replaceState(null, '', buildUrl(cfg, false));

  document.getElementById('game-title').textContent = cfgSummary(cfg);
  document.getElementById('timer-track').style.display = '';
  showScreen('screen-game');

  MODES[cfg.mode].start({
    bundle, cfg,
    content: document.getElementById('game-content'),
    timerBar: document.getElementById('timer-bar'),
    setMeta: t => (document.getElementById('game-meta').textContent = t),
    setScore: s => (document.getElementById('game-score').textContent =
      cfg.mode === 'hl' ? `Streak ${s}` : `${s.toLocaleString()} pts`),
    finish: result => onFinish(result),
  });
}

// ---------------------------------------------------------------- summary

async function onFinish(result) {
  game.result = result;
  const { cfg } = game;
  const player = profile.getName();
  const { pb, best } = profile.recordGame(cfg.mode, result.score);
  if (pb) sound.play('fanfare');

  document.getElementById('summary-mode').textContent = cfgSummary(cfg);
  document.getElementById('summary-score').textContent =
    cfg.mode === 'hl' ? `Streak: ${result.score}` : `${result.score.toLocaleString()} pts`;
  document.getElementById('summary-sub').textContent =
    pb ? '' : `Personal best: ${cfg.mode === 'hl' ? best : best.toLocaleString()}`;
  document.getElementById('pb-banner').style.display = pb ? '' : 'none';

  const pills = document.getElementById('round-pills');
  pills.innerHTML = '';
  for (const r of result.rounds.slice(0, 20)) {
    const it = bundle.byId.get(r.id);
    pills.append(el('span', { class: `round-pill ${r.ok ? 'good' : 'bad'}`, title: it ? it.n : '' },
      cfg.mode === 'hl' ? (r.ok ? '✓' : '✗') : `+${r.s.toLocaleString()}`));
  }

  showScreen('screen-summary');
  wireSummaryActions();

  const lbStatus = document.getElementById('lb-status');
  lbStatus.textContent = 'Saving score…';
  const saved = await fire.saveGame({ cfg, player, score: result.score, rounds: result.rounds });
  lbStatus.textContent = saved ? '' : 'Leaderboards offline — score saved locally only.';
  loadBoards('challenge');
}

function wireSummaryActions() {
  const { cfg, result } = game;
  const link = buildUrl(cfg);

  document.getElementById('btn-copy-link').onclick = async () => {
    sound.play('click');
    toast(await copyText(link) ? 'Challenge link copied!' : link);
  };
  document.getElementById('btn-share-result').onclick = async () => {
    sound.play('click');
    const scoreTxt = cfg.mode === 'hl' ? `streak of ${result.score}` : `${result.score.toLocaleString()} pts`;
    const txt = `Iconundrum — ${MODE_LABELS[cfg.mode]}: ${scoreTxt}. Think you can beat me? ${link}`;
    toast(await copyText(txt) ? 'Result copied — paste it anywhere' : txt);
  };
  document.getElementById('btn-play-again').onclick = () => {
    sound.play('click');
    startGame(makeCfg(cfg.mode, { ...cfg, seed: newSeed(), v: bundle.version }));
  };
  document.getElementById('btn-home').onclick = () => {
    sound.play('click');
    history.replaceState(null, '', location.pathname);
    showScreen('screen-home');
  };

  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.onclick = () => loadBoards(tab.dataset.board);
  });
}

async function loadBoards(which) {
  document.querySelectorAll('.lb-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.board === which));
  const tbody = document.getElementById('lb-body');
  tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">Loading…</td></tr>';

  const { cfg } = game;
  const rows = which === 'challenge'
    ? await fire.challengeBoard(fire.challengeKey(cfg))
    : await fire.allTimeBoard(cfg.mode);

  if (!rows) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">Leaderboard unavailable.</td></tr>';
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">No scores yet — be the first!</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  const myName = profile.getName();
  rows.forEach((r, i) => {
    tbody.append(el('tr', { class: r.player === myName ? 'me' : '' },
      el('td', {}, String(i + 1)),
      el('td', {}, r.player),
      el('td', {}, r.score.toLocaleString()),
    ));
  });
}

boot();

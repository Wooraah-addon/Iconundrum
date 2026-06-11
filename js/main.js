// Iconundrum — orchestrator. Home / game / summary flow, challenge links,
// leaderboards, share. Challenge link format: ?mode=icon&pack=items&seed=x&v=1
// (seed + content version pin the exact rounds; leaderboard buckets key on
// challengeKey so cross-version scores never mix).

import { GAME } from './config.js';
import { loadBundle } from './data.js';
import { newSeed } from './rng.js';
import { showScreen, el, toast, copyText } from './ui.js';
import * as profile from './profile.js';
import * as fire from './fire.js';
import * as modeIcon from './modes/icon.js';
import * as modeValue from './modes/value.js';
import * as modeHl from './modes/hl.js';

const MODES = { icon: modeIcon, value: modeValue, hl: modeHl };
const MODE_LABELS = { icon: 'Guess the Icon', value: 'Guess the Value', hl: 'Higher or Lower' };

let bundle = null;
let game = null; // { mode, seed, v, result }

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

  const mode = params.get('mode');
  const seed = params.get('seed');
  if (mode && MODES[mode] && seed && /^[a-z0-9]{1,16}$/i.test(seed)) {
    showChallengeBanner(mode, seed, Number.isInteger(linkV) ? linkV : bundle.version);
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
    card.addEventListener('click', () => startGame(card.dataset.mode, newSeed(), bundle.version));
  });
}

function showChallengeBanner(mode, seed, v) {
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>You've been challenged!</b> ${MODE_LABELS[mode]} — challenge <b>${seed}</b>. Same rounds for everyone who opens this link.` }),
    bundle.versionMismatch
      ? el('div', { html: `<br><b>Heads up:</b> this link was made with an older content pack (v${v}). You'll play the current pack — scores land on a fresh board.` })
      : null,
    el('div', { style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: () => startGame(mode, seed, bundle.versionMismatch ? bundle.version : v) }, 'Accept challenge')),
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

function startGame(modeId, seed, v) {
  if (!requireName()) return;
  game = { mode: modeId, seed, v };

  const url = `${location.pathname}?mode=${modeId}&pack=${GAME.pack}&seed=${seed}&v=${v}`;
  history.replaceState(null, '', url);

  document.getElementById('game-title').textContent = MODE_LABELS[modeId];
  const timerTrack = document.getElementById('timer-track');
  timerTrack.style.display = '';
  showScreen('screen-game');

  MODES[modeId].start({
    bundle, seed, v,
    content: document.getElementById('game-content'),
    timerBar: document.getElementById('timer-bar'),
    setMeta: t => (document.getElementById('game-meta').textContent = t),
    setScore: s => (document.getElementById('game-score').textContent =
      modeId === 'hl' ? `Streak ${s}` : `${s.toLocaleString()} pts`),
    finish: result => onFinish(result),
  });
}

// ---------------------------------------------------------------- summary

async function onFinish(result) {
  game.result = result;
  const { mode, seed, v } = game;
  const player = profile.getName();
  const { pb, best } = profile.recordGame(mode, result.score);

  // Summary header
  document.getElementById('summary-mode').textContent = MODE_LABELS[mode];
  document.getElementById('summary-score').textContent =
    mode === 'hl' ? `Streak: ${result.score}` : `${result.score.toLocaleString()} pts`;
  document.getElementById('summary-sub').textContent =
    pb ? '' : `Personal best: ${mode === 'hl' ? best : best.toLocaleString()}`;
  document.getElementById('pb-banner').style.display = pb ? '' : 'none';

  // Round pills
  const pills = document.getElementById('round-pills');
  pills.innerHTML = '';
  for (const r of result.rounds.slice(0, 20)) {
    const it = bundle.byId.get(r.id);
    pills.append(el('span', { class: `round-pill ${r.ok ? 'good' : 'bad'}`, title: it ? it.n : '' },
      mode === 'hl' ? (r.ok ? '✓' : '✗') : `+${r.s.toLocaleString()}`));
  }

  showScreen('screen-summary');
  wireSummaryActions();

  // Save the game (one doc per completed game), then load boards
  const lbStatus = document.getElementById('lb-status');
  lbStatus.textContent = 'Saving score…';
  const saved = await fire.saveGame({
    mode, pack: GAME.pack, seed, v, player,
    score: result.score, rounds: result.rounds,
  });
  lbStatus.textContent = saved ? '' : 'Leaderboards offline — score saved locally only.';
  loadBoards('challenge');
}

function wireSummaryActions() {
  const { mode, seed, v, result } = game;
  const link = `${location.origin}${location.pathname}?mode=${mode}&pack=${GAME.pack}&seed=${seed}&v=${v}`;

  document.getElementById('btn-copy-link').onclick = async () => {
    toast(await copyText(link) ? 'Challenge link copied!' : link);
  };
  document.getElementById('btn-share-result').onclick = async () => {
    const scoreTxt = mode === 'hl' ? `streak of ${result.score}` : `${result.score.toLocaleString()} pts`;
    const txt = `Iconundrum — ${MODE_LABELS[mode]}: ${scoreTxt}. Think you can beat me? ${link}`;
    toast(await copyText(txt) ? 'Result copied — paste it anywhere' : txt);
  };
  document.getElementById('btn-play-again').onclick = () => startGame(mode, newSeed(), bundle.version);
  document.getElementById('btn-home').onclick = () => {
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

  const { mode, seed, v } = game;
  const rows = which === 'challenge'
    ? await fire.challengeBoard(fire.challengeKey({ mode, pack: GAME.pack, seed, v }))
    : await fire.allTimeBoard(mode);

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
    const tr = el('tr', { class: r.player === myName ? 'me' : '' },
      el('td', {}, String(i + 1)),
      el('td', {}, r.player),
      el('td', {}, mode === 'hl' && which === 'challenge' ? String(r.score) : r.score.toLocaleString()),
    );
    tbody.append(tr);
  });
}

boot();

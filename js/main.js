// Iconundrum — orchestrator. Home / setup / game / summary flow, challenge
// links, leaderboards, share, sound. Challenge link format:
// ?mode=icon&pack=items&cat=all&seed=x&v=1&r=5&t=10&sp=1 — the full config
// reproduces the exact game; leaderboard buckets key on the whole config so
// custom-settings scores never mix.

import { loadBundle, catLabel, BASIS_SHORT } from './data.js';
import { newSeed } from './rng.js';
import { makeCfg, cfgFromParams, buildUrl, isRanked } from './cfg.js';
import { showScreen, el, toast, copyText } from './ui.js';
import { openSetup } from './setup.js';
import * as lobby from './lobby.js';
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
  loadWhatsNew(); // fire-and-forget — home shouldn't wait on it

  const linkCfg = cfgFromParams(params);
  if (linkCfg) {
    linkCfg.v = bundle.versionMismatch ? bundle.version : linkCfg.v || bundle.version;
    // An open lobby for this code takes precedence over the async challenge —
    // unless it's stale (host created it and never launched). Nothing ever
    // closes a lobby doc, so age is the liveness signal.
    const LOBBY_TTL_MS = 20 * 60 * 1000;
    const lob = await fire.getLobby(linkCfg.seed);
    const fresh = lob && lob.created && typeof lob.created.toMillis === 'function'
      && (Date.now() - lob.created.toMillis()) < LOBBY_TTL_MS;
    if (lob && lob.state === 'open' && fresh) showLobbyJoinBanner(lob);
    else showChallengeBanner(linkCfg);
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
      openSetup(card.dataset.mode, bundle, {
        onSolo: cfg => startGame(cfg),
        onLobby: cfg => hostLobby(cfg),
      });
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

  renderHomeStats();
}

// Your local record on the home screen — totals + favourite on one line,
// ranked (default-settings) high scores on the next, mirroring what the
// ranked all-time board counts. localStorage only; hidden until the
// first game. ("Most active player" needs cross-player aggregation the
// backend doesn't keep — see tracker F24.)
function renderHomeStats() {
  const wrap = document.getElementById('home-stats');
  const stats = profile.getStats();
  const entries = Object.entries(stats).filter(([m]) => MODE_LABELS[m]);
  const played = entries.reduce((n, [, s]) => n + (s.played || 0), 0);
  if (!played) { wrap.hidden = true; return; }

  const fav = entries.reduce((a, b) => (b[1].played > a[1].played ? b : a));
  const row1 = [`Total games played: <b>${played}</b>`];
  if (entries.length > 1) row1.push(`Your favourite game: <b>${MODE_LABELS[fav[0]]}</b>`);

  const row2 = [];
  for (const m of ['icon', 'value', 'hl']) {
    const s = stats[m];
    const rbest = s ? (s.rbest !== undefined ? s.rbest : s.best) : 0;
    if (rbest > 0) {
      row2.push(`${MODE_LABELS[m]}${m === 'hl' ? ' (streak)' : ''}: <b>${rbest.toLocaleString()}</b>`);
    }
  }

  const chips = row => row.map(x => `<span class="chip">${x}</span>`).join('');
  wrap.innerHTML = `<div class="statchips">${chips(row1)}</div>` + (row2.length
    ? `<div class="stats-label">High scores — default settings</div><div class="statchips">${chips(row2)}</div>`
    : '');
  wrap.hidden = false;
}

// "What's new" strip on the home screen: latest entry lifted from
// changelog.html so there's one source of truth. Quietly absent if the
// fetch or parse fails (offline, file://).
async function loadWhatsNew() {
  try {
    const html = await (await fetch('changelog.html')).text();
    const entry = new DOMParser().parseFromString(html, 'text/html').querySelector('.cl-entry');
    if (!entry) return;
    document.getElementById('wn-summary').textContent =
      `What's new — ${entry.querySelector('h3').textContent.replace(/\s+/g, ' ').trim()}`;
    const list = document.getElementById('wn-list');
    entry.querySelectorAll('li').forEach(li => list.append(el('li', { html: li.innerHTML })));
    document.getElementById('whats-new').hidden = false;
  } catch { /* no strip is fine */ }
}

function cfgSummary(cfg) {
  const bits = [MODE_LABELS[cfg.mode], catLabel(cfg.cat)];
  if (cfg.mode === 'icon') {
    bits.push(`${cfg.rounds} rounds`, `${cfg.timer}s`, cfg.speed ? 'speed bonus' : 'flat scoring');
    if (cfg.hard) bits.push('hard mode — type it');
  }
  if (cfg.mode === 'value') bits.push(`${cfg.rounds} rounds`, `${cfg.timer}s`, { 1: 'casual', 2: 'goblin', 4: 'tycoon' }[cfg.curve] + ' scoring', BASIS_SHORT[cfg.basis || 'mv']);
  if (cfg.mode === 'hl') {
    bits.push(cfg.sep === 110 ? 'tycoon calls' : 'goblin calls', BASIS_SHORT[cfg.basis || 'mv']);
    if (cfg.lives > 1) bits.push(`${cfg.lives} lives`);
  }
  return bits.join(' · ');
}

function showChallengeBanner(cfg) {
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>You've been challenged!</b> Game code <b>${cfg.seed}</b><br>${cfgSummary(cfg)}<br>Same rounds for everyone who opens this link.` }),
    profile.hasPlayedChallenge(fire.challengeKey(cfg))
      ? el('div', { html: `<br><b>You've played this board before</b> — replays are for fun, only your first run posted to the leaderboard.` })
      : null,
    bundle.versionMismatch
      ? el('div', { html: `<br><b>Heads up:</b> this link was made with an older content pack. You'll play the current pack — scores land on a fresh board.` })
      : null,
    el('div', { style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: () => { sound.preload(); startGame(cfg); } }, 'Accept challenge')),
  ));
}

// ---------------------------------------------------------------- lobby

async function hostLobby(cfg) {
  const player = profile.getName();
  history.replaceState(null, '', buildUrl(cfg, false));
  const ok = await fire.createLobby(cfg, player);
  if (!ok) {
    toast('Couldn’t create the lobby — is the backend set up? Playing solo works regardless.');
    return;
  }
  lobby.enterLobby({ cfg, playerName: player, isHost: true, onStart: sync => startGame(cfg, sync) });
}

function showLobbyJoinBanner(lob) {
  const cfg = makeCfg(lob.cfg.mode, lob.cfg); // lobby doc is authoritative; revalidate
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>${lob.host}'s lobby is open!</b> Game code <b>${cfg.seed}</b><br>${cfgSummary(cfg)}<br>${(lob.players || []).length} in so far — game starts when the host launches.` }),
    el('div', { style: 'margin-top:10px' },
      el('button', {
        class: 'btn',
        onclick: async () => {
          if (!requireName()) return;
          sound.preload();
          const player = profile.getName();
          const fresh = await fire.getLobby(cfg.seed);
          if (!fresh || fresh.state !== 'open') { toast('That lobby already launched — you can still play it as a challenge.'); showChallengeBanner(cfg); return; }
          if ((fresh.players || []).includes(player) && player !== fresh.host) {
            toast('That name is taken in this lobby — change your name above, then join.');
            return;
          }
          if (await fire.joinLobby(cfg.seed, player)) {
            lobby.enterLobby({ cfg, playerName: player, isHost: player === fresh.host, onStart: sync => startGame(cfg, sync) });
          } else {
            toast('Couldn’t join — check your connection.');
          }
        },
      }, 'Join lobby')),
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

function startGame(cfg, sync = null) {
  if (!requireName()) return;
  game = { cfg };

  history.replaceState(null, '', buildUrl(cfg, false));

  document.getElementById('game-title').textContent = cfgSummary(cfg);
  document.getElementById('timer-track').style.display = '';
  showScreen('screen-game');

  MODES[cfg.mode].start({
    bundle, cfg, sync,
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
  lobby.cleanup(); // stop any lobby snapshot listener
  game.result = result;
  const { cfg } = game;
  const player = profile.getName();
  const { pb, best } = profile.recordGame(cfg.mode, result.score, isRanked(cfg));
  if (pb) sound.play('fanfare');

  document.getElementById('summary-mode').textContent =
    cfgSummary(cfg) + (isRanked(cfg) ? '' : ' · custom rules — ranks on this challenge only');
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

  // Anti-grind: only this device's FIRST run on a board posts — replaying
  // a known board is a memory test, and would leak memorized scores onto
  // the ranked all-time board. Recorded only after a successful post, so a
  // run that failed to save (offline) doesn't burn the attempt.
  const lbStatus = document.getElementById('lb-status');
  const ck = fire.challengeKey(cfg);
  if (profile.hasPlayedChallenge(ck)) {
    lbStatus.textContent = 'Replay — only your first run on a board posts to the leaderboards.';
  } else {
    lbStatus.textContent = 'Saving score…';
    const saved = await fire.saveGame({ cfg, player, score: result.score, rounds: result.rounds });
    if (saved) profile.recordChallenge(ck);
    lbStatus.textContent = saved ? '' : 'Leaderboards offline — score saved locally only.';
  }
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
    renderHomeStats();
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

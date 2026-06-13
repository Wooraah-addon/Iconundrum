// Iconundrum — orchestrator. Home / setup / game / summary flow, challenge
// links, leaderboards, share, sound. Challenge link format:
// ?mode=icon&pack=items&cat=all&seed=x&v=1&r=5&t=10&sp=1 — the full config
// reproduces the exact game; leaderboard buckets key on the whole config so
// custom-settings scores never mix.

import { loadBundle, catLabel, BASIS_SHORT } from './data.js';
import { newSeed } from './rng.js';
import { makeCfg, cfgFromParams, buildUrl, isRanked } from './cfg.js';
import { showScreen, el, toast, copyText, escapeHtml, pulseCopied } from './ui.js';
import { celebrate, countUp } from './fx.js';
import { openSetup } from './setup.js';
import { openFeedback } from './feedback.js';
import { openSoundSettings } from './soundsettings.js';
import * as lobby from './lobby.js';
import * as sound from './sound.js';
import * as profile from './profile.js';
import * as fire from './fire.js';
import * as modeIcon from './modes/icon.js';
import * as modeValue from './modes/value.js';
import * as modeHl from './modes/hl.js';
import { initCoin } from './coin.js';
import { initMemory, openMemory } from './memory.js';

const MODES = { icon: modeIcon, value: modeValue, hl: modeHl };
const MODE_LABELS = { icon: 'Guess the Item', value: 'Guess the Value', hl: 'Higher or Lower' };

let bundle = null;
let game = null; // { cfg, result }

// A lobby doc is never deleted, so age is the liveness signal: a doc older
// than this counts as stale (host created it and wandered off).
const LOBBY_TTL_MS = 20 * 60 * 1000;
const lobbyFresh = lob => lob && lob.created && typeof lob.created.toMillis === 'function'
  && (Date.now() - lob.created.toMillis()) < LOBBY_TTL_MS;

// Live subscription used while a player waits on a not-yet-open lobby link.
let lobbyWatchUnsub = null;
function stopLobbyWatch() { if (lobbyWatchUnsub) { lobbyWatchUnsub(); lobbyWatchUnsub = null; } }

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
  initMemory(bundle);
  setupHome();
  loadWhatsNew(); // fire-and-forget — home shouldn't wait on it

  const linkCfg = cfgFromParams(params);
  if (linkCfg) {
    linkCfg.v = bundle.versionMismatch ? bundle.version : linkCfg.v || bundle.version;
    // An open lobby for this code takes precedence over the async challenge.
    // A link flagged ?lobby=1 (shared from the lobby screen) is a multiplayer
    // invite: if the lobby isn't open yet, wait for the host instead of
    // dropping the player into a solo game.
    const lob = await fire.getLobby(linkCfg.seed);
    if (lob && lob.state === 'open' && lobbyFresh(lob)) showLobbyJoinBanner(lob);
    else if (params.get('lobby') === '1') showLobbyWaitingBanner(linkCfg);
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

  // Memory Match — a casual, standalone pairs game (no name/leaderboard needed).
  const memCard = document.getElementById('mode-memory');
  if (memCard) memCard.addEventListener('click', () => { sound.preload(); sound.play('click'); openMemory(); });

  // Interactive home toy: a tumbling gold coin that drifts, dodges the cursor,
  // and can be clicked to "pocket" it. Not counted (see coin.js).
  initCoin();

  // Join by game code — a viewer who sees the host's code on stream can type
  // it here instead of needing the full link. Resolves to the live lobby's
  // own config; a launched/stale code falls back to the async challenge.
  const joinInput = document.getElementById('join-code');
  const joinBtn = document.getElementById('join-btn');
  if (joinBtn && joinInput) {
    joinBtn.addEventListener('click', () => joinByCode(joinInput.value));
    joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(joinInput.value); });
  }

  const setSoundIcon = (btn, muted) => {
    const u = btn.querySelector('use');
    if (u) u.setAttribute('href', muted ? '#ic-sound-off' : '#ic-sound-on');
  };
  document.querySelectorAll('.sound-toggle').forEach(btn => {
    setSoundIcon(btn, sound.isMuted());
    btn.addEventListener('click', () => {
      const muted = sound.toggleMuted();
      document.querySelectorAll('.sound-toggle').forEach(b => setSoundIcon(b, muted));
      if (!muted) sound.play('coin');
    });
  });

  const soundSettingsBtn = document.getElementById('sound-settings-btn');
  if (soundSettingsBtn) soundSettingsBtn.addEventListener('click', () => { sound.play('click'); openSoundSettings(); });

  const bugBtn = document.getElementById('btn-report-bug');
  const sugBtn = document.getElementById('btn-suggest');
  if (bugBtn) bugBtn.addEventListener('click', () => { sound.play('click'); openFeedback('bug'); });
  if (sugBtn) sugBtn.addEventListener('click', () => { sound.play('click'); openFeedback('feature'); });

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
    if (cfg.style === 'lms') bits.push('Last Man Standing');
    bits.push(cfg.sep === 110 ? 'tycoon calls' : 'goblin calls', BASIS_SHORT[cfg.basis || 'mv']);
    if (cfg.lives > 1) bits.push(`${cfg.lives} lives`);
  }
  return bits.join(' · ');
}

// F52: drop an old challenge off the home screen — clear the banner and
// strip the link params so a refresh doesn't bring it back. Scoped to the
// solo challenge banner; live lobby invites are dismissed by other means.
function dismissChallenge() {
  stopLobbyWatch();
  document.getElementById('challenge-banner').innerHTML = '';
  history.replaceState(null, '', location.pathname);
}

function showChallengeBanner(cfg) {
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice has-dismiss' },
    el('button', { class: 'notice-dismiss', title: 'Dismiss this challenge',
      'aria-label': 'Dismiss this challenge', onclick: dismissChallenge }, '✕'),
    el('div', { html: `<b>You've been challenged!</b> Game code <b>${escapeHtml(cfg.seed)}</b><br>${cfgSummary(cfg)}<br>Same rounds for everyone who opens this link.` }),
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

// Join an open lobby NOW. Shared by the home Join-by-code box and the
// challenge-banner Join button, so a code joins in one click rather than
// revealing a second button (that two-step confused stream viewers — they
// clicked "Join", saw a banner appear, and thought nothing happened).
async function joinLobbyFlow(cfg) {
  if (!requireName()) return;
  sound.preload();
  let player = profile.getName();

  // One entry per device (F38): if this device already joined this lobby,
  // it comes back as that name — switching names for a second entry (extra
  // guesses, second-guessing your first run) just rejoins the original.
  const prior = profile.getLobbyJoin(cfg.seed);
  if (prior && prior !== player && profile.setName(prior)) {
    player = prior;
    toast(`One entry per device — you're back in as ${prior}.`);
  }

  const fresh = await fire.getLobby(cfg.seed);
  if (!fresh || fresh.state !== 'open') {
    toast('That lobby already launched — you can still play it as a challenge.');
    showChallengeBanner(cfg);
    document.getElementById('challenge-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const alreadyIn = (fresh.players || []).includes(player);
  if (alreadyIn && player !== fresh.host && prior !== player) {
    toast('That name is taken in this lobby — change your name above, then join.');
    return;
  }
  // Returning player (refresh / re-click): already on the roster, just walk
  // back into the lobby — no second join write.
  if (alreadyIn || await fire.joinLobby(cfg.seed, player)) {
    profile.recordLobbyJoin(cfg.seed, player);
    lobby.enterLobby({ cfg, playerName: player, isHost: player === fresh.host, onStart: sync => startGame(cfg, sync) });
  } else {
    toast('Couldn’t join — check your connection.');
  }
}

async function joinByCode(raw) {
  const code = (raw || '').trim().toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(code)) { toast('Enter a valid game code'); return; }
  const lob = await fire.getLobby(code);
  if (!lob) { toast('No game found for that code — check it and try again'); return; }
  if (lob.state === 'open') {
    joinLobbyFlow(makeCfg(lob.cfg.mode, lob.cfg)); // straight in, one click
  } else {
    toast('That game already started — opening it as a challenge.');
    showChallengeBanner(makeCfg(lob.cfg.mode, lob.cfg));
    document.getElementById('challenge-banner').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------------------------------------------------------------- lobby

async function hostLobby(cfg) {
  stopLobbyWatch();
  const player = profile.getName();
  history.replaceState(null, '', buildUrl(cfg, false));
  const ok = await fire.createLobby(cfg, player);
  if (!ok) {
    toast('Couldn’t create the lobby — is the backend set up? Playing solo works regardless.');
    return;
  }
  profile.recordLobbyJoin(cfg.seed, player);
  lobby.enterLobby({ cfg, playerName: player, isHost: true, onStart: sync => startGame(cfg, sync) });
}

function showLobbyJoinBanner(lob) {
  const cfg = makeCfg(lob.cfg.mode, lob.cfg); // lobby doc is authoritative; revalidate
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>${escapeHtml(lob.host)}'s lobby is open!</b> Game code <b>${escapeHtml(cfg.seed)}</b><br>${cfgSummary(cfg)}<br>${(lob.players || []).length} in so far — game starts when the host launches.` }),
    el('div', { style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: () => joinLobbyFlow(cfg) }, 'Join lobby')),
  ));
}

// A lobby link (?lobby=1) whose lobby isn't open yet: hold the player here
// instead of starting a solo game, and flip to the Join banner live the
// moment the host opens it. If it already launched/went stale, say so and
// offer the solo board rather than silently doing nothing.
async function showLobbyWaitingBanner(cfg) {
  stopLobbyWatch();
  const banner = document.getElementById('challenge-banner');
  banner.innerHTML = '';
  banner.append(el('div', { class: 'notice' },
    el('div', { html: `<b>This lobby isn't open yet.</b><br>Game code <b>${escapeHtml(cfg.seed)}</b> · ${cfgSummary(cfg)}<br>Waiting for the host to start it — you'll join automatically.` }),
    el('div', { style: 'margin-top:10px' },
      el('button', { class: 'btn secondary', onclick: () => { stopLobbyWatch(); showChallengeBanner(cfg); } }, 'Play solo instead')),
  ));

  let resolved = false;
  const unsub = await fire.watchLobby(cfg.seed, doc => {
    if (resolved) return;
    if (doc.state === 'open' && lobbyFresh(doc)) {
      resolved = true; stopLobbyWatch(); showLobbyJoinBanner(doc);
    } else if (doc.state === 'launching' || !lobbyFresh(doc)) {
      resolved = true; stopLobbyWatch();
      const headline = doc.state === 'launching'
        ? `<b>This lobby has already started.</b>`
        : `<b>This lobby has expired</b> — the host never started it.`;
      banner.innerHTML = '';
      banner.append(el('div', { class: 'notice' },
        el('div', { html: `${headline}<br>You can still play the same board on your own.` }),
        el('div', { style: 'margin-top:10px' },
          el('button', { class: 'btn', onclick: () => { sound.preload(); startGame(cfg); } }, 'Play solo')),
      ));
    }
  });
  lobbyWatchUnsub = unsub;
  if (resolved) stopLobbyWatch(); // fired during the await, before assignment
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
  stopLobbyWatch(); // leaving any "waiting for lobby" state
  game = { cfg, synced: !!sync };

  history.replaceState(null, '', buildUrl(cfg, false));

  document.getElementById('game-title').textContent = cfgSummary(cfg);
  document.getElementById('timer-track').style.display = '';
  showScreen('screen-game');
  // Game-begin cue. Synced games already get the climactic "GO!" beat from the
  // countdown, so only solo starts speak here. Silent in the default synth pack.
  if (!sync) sound.play('start');

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
  const fmtScore = cfg.mode === 'hl' ? n => `Streak: ${n}` : n => `${n.toLocaleString()} pts`;
  countUp(document.getElementById('summary-score'), result.score, fmtScore, { overshoot: pb });
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
  // A personal best is the strongest intrinsic reward in a no-account game —
  // celebrate the hero number as the count-up lands (the fanfare is parked,
  // so the visual carries it).
  if (pb) setTimeout(() => celebrate(document.getElementById('summary-score'), 1.7), 760);
  // Wiring failures must never block the score save below (that's how B10
  // ate a day of scores) — log and carry on.
  try { wireSummaryActions(); } catch (e) { console.warn('summary wiring failed:', e); }

  // Scoring outcome — always spell out whether the run posted and, if not,
  // why (replay / offline / custom-not-ranked), so a missing leaderboard
  // entry is never a silent mystery.
  const lbStatus = document.getElementById('lb-status');
  const setStatus = (kind, msg) => {
    lbStatus.className = `lb-note save-status ${kind}`;
    lbStatus.textContent = msg;
  };
  const ranked = isRanked(cfg);
  const ck = fire.challengeKey(cfg);
  // Anti-grind: only this device's FIRST run on a board posts — replaying a
  // known board is a memory test, and would leak memorized scores onto the
  // ranked all-time board. Recorded only after a successful post, so a run
  // that failed to save (offline) doesn't burn the attempt.
  if (profile.hasPlayedChallenge(ck)) {
    setStatus('info', 'Replay — you’ve already posted a score on this exact board, so this run didn’t count. Replays are just for fun; only your first run on each board posts.');
  } else {
    setStatus('info', 'Saving score…');
    const saved = await fire.saveGame({ cfg, player, score: result.score, rounds: result.rounds });
    if (saved) {
      profile.recordChallenge(ck);
      setStatus('ok', ranked
        ? '✓ Score saved — posted to this challenge’s board and the global ranked leaderboard.'
        : '✓ Score saved to this challenge’s board. Custom settings, so it doesn’t count on the global ranked leaderboard — use “Reset to defaults” in setup to compete there.');
    } else {
      // Name the failure: rules drift and quota exhaustion need the dev,
      // connection problems need the player — don't make anyone guess.
      const why = fire.lastSaveError();
      const hint = why === 'permission-denied'
        ? 'the server refused the save — the game’s security rules need republishing (a dev-side fix, nothing wrong on your end)'
        : why === 'resource-exhausted'
          ? 'the game’s free-tier daily quota is used up — scores post again after the daily reset'
          : 'couldn’t reach the leaderboards — check your connection';
      setStatus('warn', `Score not posted: ${hint}. Your run still counts on this device (error: ${why || 'unknown'}).`);
    }
  }
  loadBoards('challenge');
  // Synced game: everyone finishes (and saves) within seconds of each other,
  // so the board fetched at finish races the other players' saves (F41 —
  // "I'm on my board but not on theirs"). One delayed refetch closes most of
  // the gap; the ↻ button covers the stragglers.
  if (game.synced) {
    const g = game;
    setTimeout(() => { if (game === g) loadBoards(boardTab); }, 6000);
  }
}

function wireSummaryActions() {
  const { cfg, result } = game;
  const link = buildUrl(cfg);

  document.getElementById('btn-copy-link').onclick = async e => {
    sound.play('click');
    const ok = await copyText(link);
    if (ok) pulseCopied(e.currentTarget);
    toast(ok ? 'Challenge link copied!' : link);
  };
  document.getElementById('btn-share-result').onclick = async e => {
    sound.play('click');
    const scoreTxt = cfg.mode === 'hl' ? `streak of ${result.score}` : `${result.score.toLocaleString()} pts`;
    const txt = `Iconundrum — ${MODE_LABELS[cfg.mode]}: ${scoreTxt}. Think you can beat me? ${link}`;
    const ok = await copyText(txt);
    if (ok) pulseCopied(e.currentTarget);
    toast(ok ? 'Result copied — paste it anywhere' : txt);
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
  // Null-guarded: this exact line missing its element crashed onFinish and
  // silently killed EVERY score save from v0.6.10 to v0.7.12 (B10). A
  // cosmetic control must never sit between the player and their save.
  const refresh = document.getElementById('lb-refresh');
  if (refresh) refresh.onclick = () => { sound.play('click'); loadBoards(boardTab); };
}

let boardTab = 'challenge'; // which board the summary screen is showing

async function loadBoards(which) {
  boardTab = which;
  document.querySelectorAll('.lb-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.board === which));
  const tbody = document.getElementById('lb-body');
  tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">Loading…</td></tr>';

  const { cfg } = game;
  const ranked = isRanked(cfg);

  // Custom rules never post to the ranked all-time board — say so instead
  // of the misleading "no scores yet" (the board isn't empty because nobody
  // played; YOUR game just doesn't qualify).
  if (which === 'alltime' && !ranked) {
    tbody.innerHTML = '';
    tbody.append(el('tr', {}, el('td', { colspan: '3', style: 'color:var(--text-dim)' },
      'Custom rules — this game competes on its challenge link only. ' +
      'Only default-settings games post to the ranked all-time board.')));
    return;
  }

  let rows = which === 'challenge'
    ? await fire.challengeBoard(fire.challengeKey(cfg))
    : await fire.allTimeBoard(cfg.mode);

  if (!rows) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">Leaderboard unavailable.</td></tr>';
    return;
  }

  const myName = profile.getName();
  // Read-after-write lag: if this game's own (just-saved) score hasn't shown
  // up in the fetch yet, merge it locally so the player always sees
  // themselves on their challenge board.
  if (which === 'challenge' && game.result
      && profile.hasPlayedChallenge(fire.challengeKey(cfg))
      && !rows.some(r => r.player === myName)) {
    rows = [...rows, { player: myName, score: game.result.score }]
      .sort((a, b) => b.score - a.score);
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim)">No scores yet — be the first!</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  rows.forEach((r, i) => {
    tbody.append(el('tr', { class: r.player === myName ? 'me' : '' },
      el('td', {}, String(i + 1)),
      el('td', {}, r.player),
      el('td', {}, r.score.toLocaleString()),
    ));
  });
}

boot();

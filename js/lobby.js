// Multiplayer lobby: live roster, host-controlled launch, synced countdown,
// and the in-game sync driver. The lobby doc's cfg is authoritative — every
// client starts the identical seeded board.
//
// In-game (Icon & Value): rounds are host-paced. The host's "Start next
// round" button unlocks only after the round timer + grace has elapsed for
// everyone (so every client has settled); advancing writes round/roundAt to
// the lobby doc and all clients flip together. Players report their running
// totals after each round, which feeds the rolling standings on the reveal
// screen. Higher/Lower uses the synced start only — it's untimed and
// you-ride-till-you-die, so per-round pacing doesn't apply.

import { el, showScreen, toast, copyText } from './ui.js';
import { buildUrl } from './cfg.js';
import { play } from './sound.js';
import * as fire from './fire.js';

const COUNTDOWN_MS = 10000;
const LAUNCH_BUFFER_MS = 800;  // write/notify latency on top of the visible 10s
const GRACE_MS = 3000;         // host button unlocks this long after timer end
const FAILSAFE_MS = 60000;     // "host gone?" escape hatch

let unsub = null;

export async function enterLobby({ cfg, playerName, isHost, onStart }) {
  let sync = null;
  let counting = false;
  const roster = document.getElementById('lobby-roster');
  const status = document.getElementById('lobby-status');
  const actions = document.getElementById('lobby-actions');

  document.getElementById('lobby-code').textContent = cfg.seed;
  roster.innerHTML = '';
  actions.innerHTML = '';
  status.textContent = isHost ? 'Share the link, then launch when everyone’s in.' : 'Waiting for the host to launch…';

  document.getElementById('lobby-copy').onclick = async () => {
    play('click');
    toast(await copyText(buildUrl(cfg)) ? 'Lobby link copied — anyone who opens it can join' : buildUrl(cfg));
  };

  if (isHost) {
    actions.append(el('button', {
      class: 'btn',
      onclick: async () => {
        play('click');
        const ok = await fire.launchLobby(cfg.seed, Date.now() + COUNTDOWN_MS + LAUNCH_BUFFER_MS);
        if (!ok) toast('Launch failed — check your connection');
      },
    }, '🚀 Launch game'));
  }

  showScreen('screen-lobby');

  cleanup();
  unsub = await fire.watchLobby(cfg.seed, doc => {
    if (sync) { sync.handleDoc(doc); return; }
    renderRoster(roster, doc, playerName);
    if (doc.state === 'launching' && doc.launchAt && !counting) {
      counting = true;
      sync = makeSync({ cfg, playerName, isHost, launchAt: doc.launchAt });
      runCountdown(doc.launchAt, () => onStart(sync));
    }
  });
  if (!unsub) {
    status.textContent = 'Lost the lobby connection — refresh to retry.';
  }
}

export function cleanup() {
  if (unsub) { unsub(); unsub = null; }
}

// --------------------------------------------------------- sync driver

function makeSync({ cfg, playerName, isHost, launchAt }) {
  const timerMs = (cfg.timer || 0) * 1000;
  let localRound = 0;
  let advanceHandler = null;
  let scoresHandler = null;
  let lastDoc = null;

  const sync = {
    isHost,
    playerName,
    detached: false,
    roundStartMs: launchAt,

    // when the host's next-round button may unlock (everyone's timer is done)
    unlockAt() { return sync.roundStartMs + timerMs + GRACE_MS; },
    failsafeAt() { return sync.unlockAt() + FAILSAFE_MS; },

    onAdvance(fn) { advanceHandler = fn; },
    onScores(fn) { scoresHandler = fn; },

    standings() {
      return lastDoc
        ? Object.entries(lastDoc.scores || {}).sort((a, b) => b[1] - a[1])
        : [];
    },

    reportScore(total) {
      fire.updateLobbyScore(cfg.seed, playerName, total);
    },

    // Host: advance locally at once, then tell everyone else.
    hostAdvance(nextIdx) {
      localRound = nextIdx;
      sync.roundStartMs = Date.now();
      fire.advanceRound(cfg.seed, nextIdx, sync.roundStartMs);
      if (advanceHandler) advanceHandler(nextIdx);
    },

    detach() { sync.detached = true; advanceHandler = null; scoresHandler = null; },

    handleDoc(doc) {
      lastDoc = doc;
      if (scoresHandler) scoresHandler();
      if (doc.round > localRound) {
        localRound = doc.round;
        sync.roundStartMs = doc.roundAt || Date.now();
        if (advanceHandler) advanceHandler(doc.round);
      }
    },
  };
  return sync;
}

// Standings table for the between-round reveal. Re-rendered live via
// sync.onScores as players' totals trickle in.
export function renderStandings(container, sync) {
  container.innerHTML = '';
  const rows = sync.standings();
  if (!rows.length) return;
  const table = el('table', { class: 'lb standings' },
    el('tbody', {}, ...rows.map(([name, score], i) =>
      el('tr', { class: name === sync.playerName ? 'me' : '' },
        el('td', {}, String(i + 1)),
        el('td', {}, name),
        el('td', {}, score.toLocaleString()),
      ))));
  container.append(el('div', { class: 'standings-head' }, 'Standings'), table);
}

// Reveal-screen footer for synced games: rolling standings for everyone;
// host gets the next-round button (greyed until everyone's timer + grace
// has elapsed, with a countdown in the label); players get a waiting note
// with a "host gone?" escape hatch that drops them back to local pacing.
export function buildSyncFooter(sync, { last, onHostNext, onLocalNext }) {
  const wrap = el('div', { class: 'sync-footer' });
  const stand = el('div', {});
  renderStandings(stand, sync);
  sync.onScores(() => { if (stand.isConnected) renderStandings(stand, sync); });
  wrap.append(stand);

  const base = last ? 'Finish game' : 'Start next round';
  if (sync.isHost) {
    const btn = el('button', { class: 'btn' }, base);
    btn.disabled = true;
    const h = setInterval(() => {
      if (!btn.isConnected) { clearInterval(h); return; }
      const left = sync.unlockAt() - Date.now();
      if (left <= 0) {
        btn.disabled = false;
        btn.textContent = base;
        clearInterval(h);
      } else {
        btn.textContent = `${base} (${Math.ceil(left / 1000)}s)`;
      }
    }, 250);
    btn.addEventListener('click', () => { btn.disabled = true; play('click'); onHostNext(); });
    wrap.append(btn);
  } else {
    const note = el('div', { class: 'lb-note' }, '⏳ The host starts the next round…');
    wrap.append(note);
    const delay = Math.max(1000, sync.failsafeAt() - Date.now());
    setTimeout(() => {
      if (!note.isConnected || sync.detached) return;
      note.replaceWith(el('button', {
        class: 'btn secondary',
        onclick: () => { sync.detach(); onLocalNext(); },
      }, 'Host gone? Continue at your own pace'));
    }, delay);
  }
  return wrap;
}

// --------------------------------------------------------- lobby screen

function renderRoster(rosterEl, lobby, playerName) {
  rosterEl.innerHTML = '';
  for (const name of lobby.players || []) {
    rosterEl.append(el('li', { class: name === playerName ? 'me' : '' },
      name === lobby.host ? `👑 ${name}` : name));
  }
  const n = (lobby.players || []).length;
  document.getElementById('lobby-count').textContent = `${n} player${n === 1 ? '' : 's'}`;
}

function runCountdown(launchAtMs, go) {
  const overlay = document.getElementById('countdown-overlay');
  const num = document.getElementById('countdown-num');
  overlay.hidden = false;
  let lastShown = null;
  const h = setInterval(() => {
    const left = launchAtMs - Date.now();
    if (left <= 0) {
      clearInterval(h);
      overlay.hidden = true;
      play('correct');
      go();
      return;
    }
    const sec = Math.ceil(left / 1000);
    if (sec !== lastShown) {
      lastShown = sec;
      num.textContent = sec;
      num.classList.remove('pop');
      void num.offsetWidth; // restart the pop animation
      num.classList.add('pop');
      play('tick');
    }
  }, 100);
}

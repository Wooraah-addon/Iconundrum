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
  let readyAtSeen = null;
  const roster = document.getElementById('lobby-roster');
  const status = document.getElementById('lobby-status');
  const actions = document.getElementById('lobby-actions');
  const readyBox = document.getElementById('lobby-ready');

  document.getElementById('lobby-code').textContent = cfg.seed;
  roster.innerHTML = '';
  actions.innerHTML = '';
  readyBox.hidden = true;
  status.textContent = isHost ? 'Share the link, then launch when everyone’s in.' : 'Waiting for the host to launch…';

  document.getElementById('lobby-copy').onclick = async () => {
    play('click');
    // ?lobby=1 marks this as a multiplayer invite: if a clicker arrives before
    // the lobby is open they wait for the host instead of starting a solo game.
    const link = buildUrl(cfg) + '&lobby=1';
    toast(await copyText(link) ? 'Lobby link copied — anyone who opens it can join' : link);
  };

  if (isHost) {
    actions.append(el('button', {
      class: 'btn secondary',
      onclick: async () => {
        play('click');
        const ok = await fire.startReadyCheck(cfg.seed, playerName);
        if (!ok) toast('Ready check failed — check your connection');
      },
    }, '📣 Ready check'));
    actions.append(el('button', {
      class: 'btn',
      onclick: async () => {
        play('click');
        const ok = await fire.launchLobby(cfg.seed, Date.now() + COUNTDOWN_MS + LAUNCH_BUFFER_MS);
        if (!ok) toast('Launch failed — check your connection');
      },
    }, '🚀 Launch game'));
  }

  // Everyone can walk: unsubscribe, drop off the roster (best-effort,
  // not awaited), clear the challenge params, go home. Remaining players
  // see the host-left notice via the roster check in the watcher.
  actions.append(el('button', {
    class: 'btn secondary',
    onclick: () => {
      play('click');
      cleanup();
      fire.leaveLobby(cfg.seed, playerName);
      history.replaceState(null, '', location.pathname);
      showScreen('screen-home');
    },
  }, 'Main Menu'));

  // WoW-style ready check: chime on the host's ping, prompt anyone who
  // hasn't answered this round, count answers in the status line. The
  // ready map resets on every fresh ping (the host's write replaces it).
  function handleReadyCheck(doc) {
    if (!doc.readyAt || doc.state !== 'open') return;
    if (doc.readyAt !== readyAtSeen) {
      readyAtSeen = doc.readyAt;
      play('readycheck');
      if (!isHost && !(doc.ready && playerName in doc.ready)) {
        readyBox.innerHTML = '';
        readyBox.append(
          el('span', {}, 'Ready check!'),
          el('button', {
            class: 'btn small',
            onclick: () => { play('click'); fire.setReady(cfg.seed, playerName, true); readyBox.hidden = true; },
          }, '✓ Ready'),
          el('button', {
            class: 'btn secondary small',
            onclick: () => { play('click'); fire.setReady(cfg.seed, playerName, false); readyBox.hidden = true; },
          }, '✗ Not ready'),
        );
        readyBox.hidden = false;
      }
    }
    const players = doc.players || [];
    const yes = players.filter(p => doc.ready && doc.ready[p] === true).length;
    status.textContent = yes >= players.length
      ? `Everyone's ready! ${isHost ? 'Launch when you are.' : ''}`.trim()
      : `Ready: ${yes} / ${players.length}`;
  }

  showScreen('screen-lobby');

  cleanup();
  unsub = await fire.watchLobby(cfg.seed, doc => {
    if (sync) { sync.handleDoc(doc); return; }
    // Kicked? (host removed us from the roster while the lobby was open)
    if (doc.state === 'open' && !isHost && !(doc.players || []).includes(playerName)) {
      cleanup();
      toast('The host removed you from this lobby.');
      history.replaceState(null, '', location.pathname);
      showScreen('screen-home');
      return;
    }
    renderRoster(roster, doc, playerName, isHost ? name => {
      play('click');
      fire.leaveLobby(cfg.seed, name);
      toast(`${name} removed from the lobby`);
    } : null);
    handleReadyCheck(doc);
    if (doc.state === 'open' && doc.host && (doc.players || []).length && !(doc.players || []).includes(doc.host)) {
      status.textContent = 'The host left — this lobby won’t launch. Head back to the main menu.';
    }
    if (doc.state === 'launching' && doc.launchAt && !counting) {
      counting = true;
      readyBox.hidden = true;
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

// F37: how long a settled player's result must stay hidden — until every
// client's round timer has expired (plus a cushion for clock skew), so an
// early answer can't leak the correct answer to players still guessing, or
// to a stream audience. Pure given (roundStartMs, timerMs, now); tested.
export function revealHoldMs(roundStartMs, timerMs, now) {
  return Math.max(0, roundStartMs + timerMs + 500 - now);
}

// player→rank (1-based) from a scores map, sorted by score desc. Pure.
export function ranksOf(scores) {
  const ranks = {};
  Object.entries(scores || {}).sort((a, b) => b[1] - a[1]).forEach(([n], i) => (ranks[n] = i + 1));
  return ranks;
}

// Current scores + last-boundary baseline → rows sorted by score desc, each
// with this round's points (delta) and rank movement. Pure; tested.
// rankDelta: +n up n places, -n down, 0 held, null = no prior round.
export function standingsWithDeltas(scores, prevTotals = {}, prevRanks = {}) {
  return Object.entries(scores || {}).sort((a, b) => b[1] - a[1]).map(([name, score], i) => {
    const rank = i + 1;
    const prevRank = prevRanks[name];
    return {
      name, score, rank,
      delta: score - (prevTotals[name] ?? 0),
      rankDelta: prevRank === undefined ? null : prevRank - rank,
    };
  });
}

function makeSync({ cfg, playerName, isHost, launchAt }) {
  const timerMs = (cfg.timer || 0) * 1000;
  let localRound = 0;
  let advanceHandler = null;
  let scoresHandler = null;
  let lastDoc = null;
  // Round-over-round baseline: each player's total and rank as of the last
  // round boundary, so the reveal can show this round's points (+N) and the
  // rank move (▲/▼) since last round. Captured the instant a round advances.
  let prevTotals = {};
  let prevRanks = {};
  const snapshotStandings = () => {
    prevTotals = lastDoc ? { ...(lastDoc.scores || {}) } : {};
    prevRanks = ranksOf(prevTotals);
  };

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

    // Standings with this-round points + rank movement vs the last boundary.
    standingsDetailed() {
      return standingsWithDeltas(lastDoc ? lastDoc.scores : {}, prevTotals, prevRanks);
    },

    reportScore(total) {
      fire.updateLobbyScore(cfg.seed, playerName, total);
    },

    // Host: advance locally at once, then tell everyone else.
    hostAdvance(nextIdx) {
      snapshotStandings(); // freeze the round that just ended as the baseline
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
        // Baseline = standings through the round that just ended (the advance
        // write carries the new round but not new scores yet).
        snapshotStandings();
        localRound = doc.round;
        // Clamp to our own clock: a host clock running ahead must not push the
        // round start into our future (that would mis-time the bar + unlock).
        // Mirrors runCountdown's launchAt clamp.
        sync.roundStartMs = Math.min(doc.roundAt || Date.now(), Date.now());
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
  const rows = sync.standingsDetailed();
  if (!rows.length) return;
  const moveCell = r => {
    if (r.rankDelta === null) return el('td', { class: 'rank-move' }, '');
    if (r.rankDelta === 0) return el('td', { class: 'rank-move flat' }, '–');
    const up = r.rankDelta > 0;
    return el('td', { class: `rank-move ${up ? 'up' : 'down'}` }, `${up ? '▲' : '▼'}${Math.abs(r.rankDelta)}`);
  };
  const table = el('table', { class: 'lb standings' },
    el('thead', {}, el('tr', {},
      el('th', {}, '#'), el('th', {}, ''), el('th', {}, 'Player'),
      el('th', { class: 'num' }, 'Round'), el('th', { class: 'num' }, 'Total'))),
    el('tbody', {}, ...rows.map(r =>
      el('tr', { class: r.name === sync.playerName ? 'me' : '' },
        el('td', {}, String(r.rank)),
        moveCell(r),
        el('td', {}, r.name),
        el('td', { class: 'num delta' }, r.delta > 0 ? `+${r.delta.toLocaleString()}` : '–'),
        el('td', { class: 'num' }, r.score.toLocaleString()),
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

function renderRoster(rosterEl, lobby, playerName, onKick = null) {
  rosterEl.innerHTML = '';
  const ready = lobby.ready || {};
  for (const name of lobby.players || []) {
    rosterEl.append(el('li', { class: name === playerName ? 'me' : '' },
      name === lobby.host ? `👑 ${name}` : name,
      name in ready
        ? el('span', { class: ready[name] ? 'ready-yes' : 'ready-no' }, ready[name] ? ' ✓' : ' ✗')
        : null,
      // Host moderation: ✕ removes a player from the roster (open lobbies
      // only — the players list freezes once the game launches). They can
      // rejoin via the link; for casual play "kick again" is enough teeth.
      onKick && name !== lobby.host
        ? el('button', { class: 'roster-kick', title: `Remove ${name}`, 'aria-label': `Remove ${name}`,
            onclick: () => onKick(name) }, '✕')
        : null));
  }
  const n = (lobby.players || []).length;
  document.getElementById('lobby-count').textContent = `${n} player${n === 1 ? '' : 's'}`;
}

function runCountdown(launchAtMs, go) {
  const overlay = document.getElementById('countdown-overlay');
  const num = document.getElementById('countdown-num');
  overlay.hidden = false;
  // launchAt is stamped with the HOST's clock. If this client's clock is
  // badly skewed, clamp so the countdown is never longer than the real
  // 10s+buffer (clock behind) — a clock ahead just starts sooner.
  const maxLaunch = Date.now() + COUNTDOWN_MS + LAUNCH_BUFFER_MS;
  const target = Math.min(launchAtMs, maxLaunch);
  let lastShown = null;
  const h = setInterval(() => {
    const left = target - Date.now();
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

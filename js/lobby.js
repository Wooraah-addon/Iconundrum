// Multiplayer lobby: live roster, host-controlled launch, synced countdown.
// The lobby doc's cfg is authoritative — every client starts the identical
// seeded board, and the regular challenge leaderboard doubles as the lobby
// scoreboard.

import { el, showScreen, toast, copyText } from './ui.js';
import { buildUrl } from './cfg.js';
import { play } from './sound.js';
import * as fire from './fire.js';

// ~800ms of write/notify latency buffer on top of the visible 10 seconds.
const COUNTDOWN_MS = 10000;
const LAUNCH_BUFFER_MS = 800;

let unsub = null;
let started = false;

export async function enterLobby({ cfg, playerName, isHost, onStart }) {
  started = false;
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
  unsub = await fire.watchLobby(cfg.seed, lobby => {
    renderRoster(roster, lobby, playerName);
    if (lobby.state === 'launching' && lobby.launchAt && !started) {
      started = true;
      cleanup();
      runCountdown(lobby.launchAt, () => onStart());
    }
  });
  if (!unsub) {
    status.textContent = 'Lost the lobby connection — refresh to retry.';
  }
}

export function cleanup() {
  if (unsub) { unsub(); unsub = null; }
}

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

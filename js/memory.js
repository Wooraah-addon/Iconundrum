// Memory Match (F60) — a relaxed, standalone icon-pairs game. Flip tiles two
// at a time and find every matching item icon. Deliberately NOT a competitive
// mode: no challenge link, no cfg/sig, no leaderboard — just a local best
// (fewest moves, then fastest time) per board size. Kept out of the
// MODES/startGame/onFinish path on purpose so it can never touch the ranked
// machinery. Accessible to players with no WoW knowledge — it's pure visual
// matching.

import { el, showScreen } from './ui.js';
import { catItems, iconUrl, preloadIcons } from './data.js';
import { play } from './sound.js';
import * as profile from './profile.js';

const SIZES = [
  { id: 'easy',   label: 'Easy',   pairs: 6,  cols: 4 },
  { id: 'medium', label: 'Medium', pairs: 8,  cols: 4 },
  { id: 'hard',   label: 'Hard',   pairs: 12, cols: 6 },
];

const MISMATCH_MS = 850;

let bundle = null;
export function initMemory(b) { bundle = b; }

const fmtTime = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Not seeded — there's no shared board to keep identical, so plain randomness
// is correct here (every game is a fresh shuffle).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick n items with DISTINCT icons — two different items sharing one icon file
// would look like a false match.
function pickItems(pool, n) {
  const seen = new Set();
  const out = [];
  for (const it of shuffle(pool)) {
    if (seen.has(it.i)) continue;
    seen.add(it.i);
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}

const content = () => document.getElementById('memory-content');
const setMeta = t => (document.getElementById('mem-meta').textContent = t);
const setClock = t => (document.getElementById('mem-score').textContent = t);

export function openMemory() {
  showScreen('screen-memory');
  renderSizePicker();
}

function renderSizePicker() {
  setMeta('Memory Match');
  setClock('');
  const c = content();
  c.innerHTML = '';
  c.append(el('div', { class: 'panel mem-setup' },
    el('h2', { class: 'mem-title' }, 'Memory Match'),
    el('p', { class: 'lb-note', style: 'margin:0 0 16px' },
      'Flip the tiles two at a time and find every matching pair. Fewer moves is better — beat your own best. Just for fun: no timer pressure, no leaderboard.'),
    el('div', { class: 'mem-size-row' },
      ...SIZES.map(s => {
        const best = profile.getMemoryBest(s.id);
        return el('button', { class: 'btn secondary mem-size', onclick: () => { play('click'); startBoard(s); } },
          el('span', { class: 'mem-size-label' }, s.label),
          el('span', { class: 'mem-size-sub' }, `${s.pairs} pairs`),
          el('span', { class: 'mem-size-best' }, best ? `Best: ${best.moves} moves` : 'No best yet'));
      })),
    el('div', { class: 'action-row', style: 'margin-top:18px' },
      el('button', { class: 'btn secondary small', onclick: () => { location.href = location.pathname; } }, 'Main menu')),
  ));
}

function startBoard(size) {
  const picks = pickItems(catItems(bundle, 'all'), size.pairs);
  preloadIcons(picks);
  const deck = shuffle(picks.flatMap(it => [{ it }, { it }]));

  let moves = 0, matched = 0, first = null, lock = false, t0 = null, clock = null;
  setMeta('Moves: 0');
  setClock('0:00');

  const c = content();
  c.innerHTML = '';
  const board = el('div', { class: `memory-board cols-${size.cols}` });
  c.append(board);

  const tick = () => { if (t0) setClock(fmtTime(Date.now() - t0)); };

  for (const card of deck) {
    const tile = el('button', { class: 'mem-card', type: 'button', 'aria-label': 'Memory tile' },
      el('div', { class: 'mem-inner' },
        el('div', { class: 'mem-face mem-back' }, '?'),
        el('div', { class: 'mem-face mem-front' },
          el('img', { src: iconUrl(card.it), alt: '' }))));
    card.el = tile;
    tile.addEventListener('click', () => flip(card));
    board.append(tile);
  }

  function flip(card) {
    const tile = card.el;
    if (lock || tile.classList.contains('flipped') || tile.classList.contains('matched')) return;
    if (!t0) { t0 = Date.now(); clock = setInterval(tick, 250); }
    play('click');
    tile.classList.add('flipped');

    if (!first) { first = card; return; }

    moves++;
    setMeta(`Moves: ${moves}`);

    if (first.it.id === card.it.id) {
      play('correct');
      first.el.classList.add('matched');
      tile.classList.add('matched');
      first = null;
      if (++matched === size.pairs) win();
    } else {
      lock = true;
      const a = first;
      first = null;
      setTimeout(() => {
        a.el.classList.remove('flipped');
        tile.classList.remove('flipped');
        lock = false;
      }, MISMATCH_MS);
    }
  }

  function win() {
    if (clock) clearInterval(clock);
    const timeMs = Date.now() - t0;
    setClock(fmtTime(timeMs));
    const { best, prev } = profile.recordMemoryResult(size.id, moves, timeMs);
    play(best ? 'jackpot' : 'fanfare');
    renderWin(size, moves, timeMs, best, prev);
  }
}

function renderWin(size, moves, timeMs, best, prev) {
  const panel = el('div', { class: 'panel mem-win' },
    el('div', { class: 'summary-sub' }, `${size.label} board cleared!`),
    el('div', { class: 'summary-score' }, `${moves} moves`),
    el('div', { class: 'mem-win-time' }, `Time: ${fmtTime(timeMs)}`),
    best
      ? el('div', { class: 'pb-banner' }, '★ New personal best! ★')
      : el('div', { class: 'summary-sub' }, prev ? `Your best: ${prev.moves} moves` : ''),
    el('div', { class: 'divider' }),
    el('div', { class: 'action-row' },
      el('button', { class: 'btn', onclick: () => { play('click'); startBoard(size); } }, 'Play again'),
      el('button', { class: 'btn secondary', onclick: () => { play('click'); renderSizePicker(); } }, 'Change size'),
      el('button', { class: 'btn secondary', onclick: () => { location.href = location.pathname; } }, 'Main menu')),
  );
  content().append(panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

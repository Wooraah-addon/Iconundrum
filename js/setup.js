// Pre-game setup modal: category, rounds, timer, scoring options, and the
// shareable game code. Copying the link BEFORE playing lets a host drop the
// challenge in discord and then play the same board themselves.

import { CATEGORIES, catItems } from './data.js';
import { makeCfg, buildUrl, DEFAULTS, LIMITS } from './cfg.js';
import { newSeed } from './rng.js';
import { el, toast, copyText } from './ui.js';
import { play } from './sound.js';

const MODE_LABELS = { icon: 'Guess the Icon', value: 'Guess the Value', hl: 'Higher or Lower' };

// Minimum pool sizes for a category to be offered.
const MIN_ICON = 40;
const MIN_PRICE = 30;

export function openSetup(modeId, bundle, { onSolo, onLobby }) {
  const seed = newSeed();
  const priceMode = modeId !== 'icon';

  const state = { ...DEFAULTS[modeId], cat: 'all' };
  // New price games default to the sale average — closer to realized value.
  // (Links without ?b= still decode as market avg; see cfg.js.)
  if (priceMode) state.basis = 'sa';

  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // --- category picker: icon tiles (F29 — the most-touched control in the
  // app deserves better than a dropdown). Counts depend on the price basis,
  // so refreshable. Scales to ~10 categories via the auto-fill grid.
  const catGrid = el('div', { class: 'cat-grid' });
  function fillCats() {
    catGrid.innerHTML = '';
    for (const c of CATEGORIES) {
      if (c.hidden) continue; // resolvable for old links, not offered for new games
      const items = catItems(bundle, c.id, priceMode ? state.basis : false);
      const n = items.length;
      const viable = n >= (priceMode ? MIN_PRICE : MIN_ICON);
      if (!viable && state.cat === c.id) state.cat = 'all';
      const attrs = {
        type: 'button',
        class: `cat-tile${state.cat === c.id ? ' active' : ''}`,
        onclick: () => { if (state.cat !== c.id) { play('click'); state.cat = c.id; fillCats(); } },
      };
      if (!viable) attrs.disabled = 'disabled';
      catGrid.append(el('button', attrs,
        el('img', { src: bundle.iconBase + c.face + '.jpg', alt: '' }),
        el('span', { class: 'cat-name' }, c.label),
        el('span', { class: 'cat-count' }, `${n} items`),
      ));
    }
  }
  fillCats();

  const rows = [
    section('The board'),
    el('div', { class: 'form-row stack' }, el('label', {}, 'Category'), catGrid),
  ];

  // --- price basis (Value & Higher/Lower) ---
  if (priceMode) {
    const basisSelect = el('select', { class: 'setup-select' },
      el('option', { value: 'sa' }, 'Sale average — what items actually sell for (TSM)'),
      el('option', { value: 'mv' }, 'Market average — what items are posted for'),
    );
    basisSelect.value = state.basis;
    basisSelect.addEventListener('change', () => { state.basis = basisSelect.value; fillCats(); });
    rows.push(row('Price basis', basisSelect));
    rows.push(el('div', { class: 'lb-note', style: 'margin:-8px 0 12px; text-align:left' },
      'EU region prices. Posted prices can be inflated; the sale average is closer to what items really trade at. Your pick is locked into the challenge link — each basis keeps its own leaderboard.'));
  }

  // --- per-mode controls ---
  rows.push(section('The rules'));
  if (modeId === 'icon' || modeId === 'value') {
    const [rLo, rHi] = LIMITS.rounds;
    rows.push(sliderRow('Rounds', rLo, rHi, state.rounds, v => (state.rounds = v)));
    const [tLo, tHi] = modeId === 'icon' ? LIMITS.iconTimer : LIMITS.valueTimer;
    rows.push(sliderRow('Seconds per round', tLo, tHi, state.timer, v => (state.timer = v), 's'));
  }
  if (modeId === 'icon') {
    const speedToggle = el('input', { type: 'checkbox' });
    speedToggle.checked = true;
    speedToggle.addEventListener('change', () => (state.speed = speedToggle.checked ? 1 : 0));
    rows.push(row('Speed bonus scoring', el('label', { class: 'switch' }, speedToggle, el('span', {}, ' faster answer = more points'))));
    // Hard mode (type the name) is BENCHED per tracker B2 — too hard on the
    // default timer, icons too diverse. The full machinery (cfg.hard, h= in
    // links, typed rounds in modes/icon.js) stays live and tested; restore
    // by re-adding the toggle row here, with a rebalanced timer (20s+?) and
    // ideally a recognizable-names pool filter.
  }
  if (modeId === 'value') {
    const curveSelect = el('select', { class: 'setup-select' },
      el('option', { value: '1' }, 'Casual — forgiving curve'),
      el('option', { value: '2' }, 'Goblin — standard'),
      el('option', { value: '4' }, 'Tycoon — precision pays'),
    );
    curveSelect.value = '2';
    curveSelect.addEventListener('change', () => (state.curve = parseInt(curveSelect.value, 10)));
    rows.push(row('Scoring', curveSelect));
  }
  if (modeId === 'hl') {
    const sepSelect = el('select', { class: 'setup-select' },
      el('option', { value: '125' }, 'Goblin — clear price gaps (≥1.25×)'),
      el('option', { value: '110' }, 'Tycoon — tight calls (≥1.10×)'),
    );
    sepSelect.value = '125';
    sepSelect.addEventListener('change', () => (state.sep = parseInt(sepSelect.value, 10)));
    rows.push(row('Difficulty', sepSelect));
    const livesSelect = el('select', { class: 'setup-select' },
      el('option', { value: '1' }, '1 — sudden death (ranked)'),
      el('option', { value: '2' }, '2 ♥ — one mistake forgiven'),
      el('option', { value: '3' }, '3 ♥'),
      el('option', { value: '4' }, '4 ♥'),
    );
    livesSelect.value = '1';
    livesSelect.addEventListener('change', () => (state.lives = parseInt(livesSelect.value, 10)));
    rows.push(row('Lives', livesSelect));
  }

  const cfgNow = () => makeCfg(modeId, { ...state, seed, v: bundle.version });

  // --- game code + share ---
  // F36 root cause on stream: hosts shared THIS link expecting it to pull
  // people into their lobby — it's the async solo link. Say so here; the
  // real invite link lives on the lobby screen.
  const codeRow = el('div', {},
    el('div', { class: 'code-row' },
      el('span', {}, 'Game code: ', el('b', { class: 'game-code' }, seed)),
      el('button', {
        class: 'btn secondary small',
        onclick: async () => {
          play('click');
          toast(await copyText(buildUrl(cfgNow())) ? 'Challenge link copied — friends play it solo, anytime' : buildUrl(cfgNow()));
        },
      }, 'Copy challenge link'),
    ),
    el('div', { class: 'lb-note code-note' },
      'Challenge link = friends play the same board solo, anytime. Playing live together? Create the lobby and share the invite link from there.'),
  );

  const modal = el('div', { class: 'modal panel setup-modal' },
    el('h3', { class: 'modal-title' }, MODE_LABELS[modeId]),
    ...rows,
    codeRow,
    el('div', { class: 'action-row' },
      el('button', { class: 'btn', onclick: () => { play('click'); close(); onSolo(cfgNow()); } }, 'Play solo'),
      el('button', { class: 'btn', onclick: () => { play('click'); close(); onLobby(cfgNow()); } }, '👥 Create lobby'),
      el('button', { class: 'btn secondary', onclick: close }, 'Cancel'),
    ),
  );
  overlay.append(modal);
  document.body.append(overlay);
}

function row(label, control) {
  return el('div', { class: 'form-row' }, el('label', {}, label), control);
}

function section(label) {
  return el('div', { class: 'setup-section' }, label);
}

function sliderRow(label, min, max, value, onChange, suffix = '') {
  const valEl = el('b', { class: 'slider-val' }, `${value}${suffix}`);
  const input = el('input', { type: 'range', min: String(min), max: String(max), value: String(value) });
  input.addEventListener('input', () => {
    const v = parseInt(input.value, 10);
    valEl.textContent = `${v}${suffix}`;
    onChange(v);
  });
  return el('div', { class: 'form-row' },
    el('label', {}, `${label} `, valEl),
    input);
}

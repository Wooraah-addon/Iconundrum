// Pre-game setup modal: category, rounds, timer, scoring options, and the
// shareable game code. Copying the link BEFORE playing lets a host drop the
// challenge in discord and then play the same board themselves.

import { CATEGORIES, catItems } from './data.js';
import { makeCfg, buildUrl, DEFAULTS, LIMITS, isRanked } from './cfg.js';
import { newSeed } from './rng.js';
import { el, toast, copyText, pulseCopied, icon } from './ui.js';
import { play } from './sound.js';

const MODE_LABELS = { icon: 'Guess the Icon', value: 'Guess the Value', hl: 'Higher or Lower' };

// Minimum pool sizes for a category to be offered.
const MIN_ICON = 40;
const MIN_PRICE = 30;

// The default options for a mode: DEFAULTS (cfg.js) + Everything, and the
// sale-avg basis for price modes (the new-game default; see makeCfg). The one
// source of truth for both the initial state and Reset to defaults.
function defaultState(modeId) {
  const s = { ...DEFAULTS[modeId], cat: 'all' };
  if (modeId !== 'icon') s.basis = 'sa';
  return s;
}

export function openSetup(modeId, bundle, { onSolo, onLobby }) {
  const seed = newSeed();
  const priceMode = modeId !== 'icon';

  const state = defaultState(modeId);
  // Each control registers a fn that snaps its widget back to match `state` —
  // Reset to defaults runs them all. (Links without ?b= still decode as market
  // avg; the setup default is sale avg — see cfg.js / makeCfg.)
  const resetters = [];
  const cfgNow = () => makeCfg(modeId, { ...state, seed, v: bundle.version });

  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Live ranked-eligibility note: only the default ruleset competes on the
  // global all-time boards (isRanked); custom settings get their own challenge
  // board. Flips as the player changes settings, so the trade-off is explicit.
  const rankedNote = el('div', {});
  function refreshRankedNote() {
    const ranked = isRanked(cfgNow());
    rankedNote.className = `ranked-note ${ranked ? 'is-ranked' : 'is-custom'}`;
    rankedNote.textContent = ranked
      ? 'Default ruleset — default settings required for global leaderboard ranking'
      : 'Custom game — scores on this game’s own board only, not the global leaderboards.';
  }

  // --- control builders that register a reset hook + refresh the ranked note
  const sliderRow = (label, [min, max], get, set, suffix = '') => {
    const valEl = el('b', { class: 'slider-val' }, `${get()}${suffix}`);
    const input = el('input', { type: 'range', min: String(min), max: String(max), value: String(get()) });
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      valEl.textContent = `${v}${suffix}`;
      set(v); refreshRankedNote();
    });
    resetters.push(() => { const v = get(); input.value = String(v); valEl.textContent = `${v}${suffix}`; });
    return el('div', { class: 'form-row' }, el('label', {}, `${label} `, valEl), input);
  };

  const selectRow = (label, options, get, set) => {
    const sel = el('select', { class: 'setup-select' },
      ...options.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = get();
    sel.addEventListener('change', () => { set(sel.value); refreshRankedNote(); });
    resetters.push(() => { sel.value = get(); });
    return row(label, sel);
  };

  const switchRow = (label, text, get, set) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = get();
    cb.addEventListener('change', () => { set(cb.checked); refreshRankedNote(); });
    resetters.push(() => { cb.checked = get(); });
    return row(label, el('label', { class: 'switch' }, cb, el('span', {}, text)));
  };

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
        // Category moves ranked eligibility too (v0.7.13: only 'all' ranks)
        onclick: () => { if (state.cat !== c.id) { play('click'); state.cat = c.id; fillCats(); refreshRankedNote(); } },
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

  // Plain block wrapper, NOT .form-row: an auto-fill grid inside a wrapping
  // column flexbox gets its intrinsic height computed at one-column width
  // (5 tiles stacked ≈ 510px of phantom space). Block layout sizes it right.
  const rows = [
    el('div', { class: 'cat-block' }, el('div', { class: 'cat-label' }, 'Category'), catGrid),
  ];

  // --- price basis (Value & Higher/Lower) ---
  if (priceMode) {
    rows.push(selectRow('Price basis',
      [['sa', 'Sale average — what items actually sell for (TSM)'],
       ['mv', 'Market average — what items are posted for']],
      () => state.basis, v => (state.basis = v, fillCats(), v)));
    rows.push(el('div', { class: 'lb-note', style: 'margin:-8px 0 12px; text-align:left' },
      'EU region prices. Posted prices can be inflated; the sale average is closer to what items really trade at. Your pick is locked into the challenge link — each basis keeps its own leaderboard.'));
  }

  // --- per-mode controls ---
  rows.push(section('The rules'));
  if (modeId === 'icon' || modeId === 'value') {
    rows.push(sliderRow('Rounds', LIMITS.rounds, () => state.rounds, v => (state.rounds = v)));
    const tLimits = modeId === 'icon' ? LIMITS.iconTimer : LIMITS.valueTimer;
    rows.push(sliderRow('Seconds per round', tLimits, () => state.timer, v => (state.timer = v), 's'));
  }
  if (modeId === 'icon') {
    rows.push(switchRow('Speed bonus scoring', ' faster answer = more points',
      () => state.speed === 1, v => (state.speed = v ? 1 : 0)));
    // Hard mode (type the name) is BENCHED per tracker B2 — too hard on the
    // default timer, icons too diverse. The full machinery (cfg.hard, h= in
    // links, typed rounds in modes/icon.js) stays live and tested; restore
    // by re-adding a toggle row here, with a rebalanced timer (20s+?) and
    // ideally a recognizable-names pool filter.
  }
  if (modeId === 'value') {
    rows.push(selectRow('Scoring',
      [['1', 'Casual — forgiving curve'], ['2', 'Goblin — standard'], ['4', 'Tycoon — precision pays']],
      () => String(state.curve), v => (state.curve = parseInt(v, 10))));
  }
  if (modeId === 'hl') {
    rows.push(selectRow('Difficulty',
      [['125', 'Goblin — clear price gaps (≥1.25×)'], ['110', 'Tycoon — tight calls (≥1.10×)']],
      () => String(state.sep), v => (state.sep = parseInt(v, 10))));
    rows.push(selectRow('Lives',
      [['1', '1 — sudden death (ranked)'], ['2', '2 ♥ — one mistake forgiven'], ['3', '3 ♥'], ['4', '4 ♥']],
      () => String(state.lives ?? 1), v => (state.lives = parseInt(v, 10))));
  }

  // --- reset + ranked-eligibility note ---
  function resetToDefaults() {
    play('click');
    Object.assign(state, defaultState(modeId));
    delete state.lives; // not in DEFAULTS.hl — makeCfg defaults it back to 1
    resetters.forEach(fn => fn());
    fillCats();
    refreshRankedNote();
  }
  rows.push(el('div', { class: 'reset-row' },
    rankedNote,
    el('button', { class: 'btn secondary small', type: 'button', onclick: resetToDefaults }, 'Reset to defaults')));
  refreshRankedNote();

  // --- game code + share ---
  // F36 root cause on stream: hosts shared THIS link expecting it to pull
  // people into their lobby — it's the async solo link. Say so here; the
  // real invite link lives on the lobby screen.
  const codeRow = el('div', {},
    el('div', { class: 'code-row' },
      el('span', {}, 'Game code: ', el('b', { class: 'game-code' }, seed)),
      el('button', {
        class: 'btn secondary small',
        onclick: async e => {
          play('click');
          const ok = await copyText(buildUrl(cfgNow()));
          if (ok) pulseCopied(e.currentTarget);
          toast(ok ? 'Challenge link copied — friends play it solo, anytime' : buildUrl(cfgNow()));
        },
      }, 'Copy challenge link'),
    ),
    el('div', { class: 'lb-note code-note' },
      'Challenge link = friends play the same board solo, anytime. Playing live together? Create the lobby and share the invite link from there.'),
  );

  const modal = el('div', { class: 'modal panel setup-modal' },
    el('h3', { class: 'modal-title' }, MODE_LABELS[modeId]),
    ...rows,
    el('div', { class: 'divider' }),
    codeRow,
    el('div', { class: 'action-row' },
      el('button', { class: 'btn', onclick: () => { play('click'); close(); onSolo(cfgNow()); } }, 'Play solo'),
      el('button', { class: 'btn', onclick: () => { play('click'); close(); onLobby(cfgNow()); } }, icon('users'), ' Create lobby'),
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

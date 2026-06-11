// Guess the Value — Price Is Right. Free-entry gold guess, closest wins.
// Proximity scoring (GeoGuessr-style): 5000 × exp(-k·|ln(guess/actual)|),
// exact within ±1% = clean 5000 jackpot. k is the configurable strictness
// (1 casual / 2 standard / 4 tycoon). The price being guessed is cfg.basis:
// 'mv' region market average (posted) or 'sa' TSM region sale average —
// chosen in setup, locked into the challenge link, own leaderboard each.

import { rngFor, sample } from '../rng.js';
import { iconUrl, fmtGoldLong, catItems, priceOf, parseGold, preloadIcons, BASIS_LABELS } from '../data.js';
import { el, startTimer, renderReveal } from '../ui.js';
import { play } from '../sound.js';
import { buildSyncFooter } from '../lobby.js';

export function buildRounds(bundle, cfg) {
  const rng = rngFor(['value', cfg.seed, `v${cfg.v}`]);
  return sample(catItems(bundle, cfg.cat, cfg.basis || 'mv'), cfg.rounds, rng);
}

export function scoreGuess(guess, actual, k = 2) {
  if (!guess || guess <= 0) return 0;
  const r = Math.abs(Math.log(guess / actual));
  if (r <= Math.log(1.01)) return 5000;
  return Math.round(5000 * Math.exp(-k * r));
}

export function start(ctx) {
  const cfg = ctx.cfg;
  const basis = cfg.basis || 'mv';
  const rounds = buildRounds(ctx.bundle, cfg);
  preloadIcons(rounds); // warm all round icons up front
  const log = [];
  let total = 0;
  let idx = 0;
  let roundToken = 0;
  let forceSettle = null;
  const synced = () => ctx.sync && !ctx.sync.detached;

  // Host-paced multiplayer (see icon.js) — locks in whatever's typed.
  if (ctx.sync) {
    ctx.sync.onAdvance(n => {
      if (forceSettle) forceSettle();
      proceed(n);
    });
  }

  function proceed(n) {
    idx = n;
    if (idx < rounds.length) playRound();
    else ctx.finish({ score: total, rounds: log });
  }

  function playRound() {
    roundToken++;
    const token = roundToken;
    const item = rounds[idx];
    const actual = priceOf(item, basis);
    ctx.setMeta(`Round ${idx + 1} / ${rounds.length}`);
    ctx.setScore(total);
    ctx.content.innerHTML = '';

    const input = el('input', {
      type: 'text', placeholder: 'type a guess — 25000 or 25k',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    });
    const preview = el('div', { class: 'value-preview' });
    input.addEventListener('input', () => {
      input.classList.remove('invalid');
      const g = parseGold(input.value);
      preview.textContent = g > 0 ? `= ${fmtGoldLong(g)}` : '';
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') settle(); });

    const lockBtn = el('button', { class: 'btn', onclick: () => settle() }, 'Lock in');

    // Quick-entry magnitude buttons — build a guess by tapping, no keyboard
    // needed on mobile (shorthand like "25k" still works in the input).
    const bump = step => {
      play('click');
      const g = parseGold(input.value) + step;
      input.value = String(g);
      input.classList.remove('invalid');
      preview.textContent = `= ${fmtGoldLong(g)}`;
    };
    const chips = el('div', { class: 'value-chips' },
      ...[[1e3, '+1k'], [1e4, '+10k'], [1e5, '+100k'], [1e6, '+1m']].map(([step, label]) =>
        el('button', { class: 'chip-btn', onclick: () => bump(step) }, label)),
      el('button', {
        class: 'chip-btn clear',
        onclick: () => { play('click'); input.value = ''; input.classList.remove('invalid'); preview.textContent = ''; },
      }, 'Clear'),
    );

    ctx.content.append(el('div', {},
      el('div', { class: 'question-icon-wrap' },
        el('img', { class: 'question-icon', src: iconUrl(item), alt: '' })),
      el('div', { class: 'question-prompt', html: `What does <strong class="q-${item.q}">${item.n}</strong> go for on the AH?` }),
      el('div', { class: 'value-entry' }, input, el('span', { class: 'g' }, 'g'), lockBtn),
      chips,
      // Players who see the chips assume they're the only way in (real-player
      // feedback, B9) — say outright that the box takes typed amounts too.
      el('div', { class: 'value-hint' }, 'Type any amount in the box, or build it with the buttons.'),
      preview,
    ));
    input.focus();

    const timer = startTimer(cfg.timer, ctx.timerBar,
      () => settle(true),
      sec => { if (sec <= 3 && sec > 0) play('tick'); });

    let settled = false;
    forceSettle = () => settle(true, true);

    function settle(expired = false, forced = false) {
      if (settled) return;
      const guess = parseGold(input.value);
      if (!expired && guess <= 0) { input.classList.add('invalid'); return; }
      settled = true;
      timer.stop();
      input.disabled = true;
      lockBtn.disabled = true;
      chips.querySelectorAll('button').forEach(b => (b.disabled = true));

      const earned = scoreGuess(guess, actual, cfg.curve);
      total += earned;
      log.push({ id: item.id, a: guess, ok: earned > 0, s: earned, t: Math.round(timer.elapsedMs()) });
      ctx.setScore(total);
      if (ctx.sync) ctx.sync.reportScore(total);
      if (forced) return; // advancing right now — skip the reveal
      play(earned === 5000 ? 'jackpot' : earned >= 2500 ? 'correct' : earned > 0 ? 'coin' : 'wrong');

      const headline = earned === 5000
        ? `JACKPOT! +5,000 pts`
        : earned > 0 ? `+${earned.toLocaleString()} pts`
        : guess > 0 ? 'Way off — +0 pts' : 'No guess — +0 pts';
      let detail;
      if (guess > 0) {
        const pct = Math.abs(guess / actual - 1) * 100;
        const offTxt = pct < 1 ? 'spot on' : `${Math.round(pct)}% ${guess > actual ? 'high' : 'low'}`;
        detail = `You said <b>${fmtGoldLong(guess)}</b> — ${BASIS_LABELS[basis]} is <b>${fmtGoldLong(actual)}</b> (${offTxt})`;
      } else {
        detail = `${BASIS_LABELS[basis]} is <b>${fmtGoldLong(actual)}</b>`;
      }
      const last = idx === rounds.length - 1;
      setTimeout(() => {
        if (token !== roundToken) return; // already advanced past this round
        const footer = synced()
          ? buildSyncFooter(ctx.sync, {
              last,
              onHostNext: () => ctx.sync.hostAdvance(idx + 1),
              onLocalNext: () => proceed(idx + 1),
            })
          : el('button', { class: 'btn', onclick: () => { play('click'); proceed(idx + 1); } },
              last ? 'See results' : 'Next round');
        renderReveal(ctx.content, item, headline, detail, footer);
      }, 500);
    }
  }

  playRound();
}

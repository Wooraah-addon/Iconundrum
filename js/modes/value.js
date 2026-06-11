// Guess the Value — Price Is Right. Free-entry gold guess, closest wins.
// Proximity scoring (GeoGuessr-style): 5000 × exp(-k·|ln(guess/actual)|),
// exact within ±1% = clean 5000 jackpot. k is the configurable strictness
// (1 casual / 2 standard / 4 tycoon). Anchor: region market average
// ("prices as of <date>" shown on home).

import { rngFor, sample } from '../rng.js';
import { iconUrl, fmtGoldLong, catItems } from '../data.js';
import { el, startTimer, renderReveal } from '../ui.js';
import { play } from '../sound.js';

export function buildRounds(bundle, cfg) {
  const rng = rngFor(['value', cfg.seed, `v${cfg.v}`]);
  return sample(catItems(bundle, cfg.cat, true), cfg.rounds, rng);
}

export function scoreGuess(guess, actual, k = 2) {
  if (!guess || guess <= 0) return 0;
  const r = Math.abs(Math.log(guess / actual));
  if (r <= Math.log(1.01)) return 5000;
  return Math.round(5000 * Math.exp(-k * r));
}

export function start(ctx) {
  const cfg = ctx.cfg;
  const rounds = buildRounds(ctx.bundle, cfg);
  const log = [];
  let total = 0;
  let idx = 0;

  function playRound() {
    const item = rounds[idx];
    ctx.setMeta(`Round ${idx + 1} / ${rounds.length}`);
    ctx.setScore(total);
    ctx.content.innerHTML = '';

    const input = el('input', {
      type: 'number', min: '1', step: '1', placeholder: 'gold',
      inputmode: 'numeric', autocomplete: 'off',
    });
    const preview = el('div', { class: 'value-preview' });
    input.addEventListener('input', () => {
      const g = parseInt(input.value, 10);
      preview.textContent = g > 0 ? `= ${fmtGoldLong(g)}` : '';
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') settle(); });

    const lockBtn = el('button', { class: 'btn', onclick: () => settle() }, 'Lock in');

    ctx.content.append(el('div', {},
      el('div', { class: 'question-icon-wrap' },
        el('img', { class: 'question-icon', src: iconUrl(item), alt: '' })),
      el('div', { class: 'question-prompt', html: `What does <strong class="q-${item.q}">${item.n}</strong> go for on the AH?` }),
      el('div', { class: 'value-entry' }, input, el('span', { class: 'g' }, 'g'), lockBtn),
      preview,
    ));
    input.focus();

    const timer = startTimer(cfg.timer, ctx.timerBar,
      () => settle(true),
      sec => { if (sec <= 3 && sec > 0) play('tick'); });

    let settled = false;
    function settle(expired = false) {
      if (settled) return;
      const guess = parseInt(input.value, 10) || 0;
      if (!expired && guess <= 0) { input.classList.add('invalid'); return; }
      settled = true;
      timer.stop();
      input.disabled = true;
      lockBtn.disabled = true;

      const earned = scoreGuess(guess, item.mv, cfg.curve);
      total += earned;
      log.push({ id: item.id, a: guess, ok: earned > 0, s: earned, t: Math.round(timer.elapsedMs()) });
      play(earned === 5000 ? 'jackpot' : earned >= 2500 ? 'correct' : earned > 0 ? 'coin' : 'wrong');
      ctx.setScore(total);

      const headline = earned === 5000
        ? `JACKPOT! +5,000 pts`
        : earned > 0 ? `+${earned.toLocaleString()} pts` : 'No guess — +0 pts';
      const detail = guess > 0
        ? `You said <b>${fmtGoldLong(guess)}</b> — market average is <b>${fmtGoldLong(item.mv)}</b>`
        : `Market average is <b>${fmtGoldLong(item.mv)}</b>`;
      const last = idx === rounds.length - 1;
      renderReveal(ctx.content, item, headline, detail, last ? 'See results' : 'Next round', () => {
        play('click');
        idx += 1;
        if (idx < rounds.length) playRound();
        else ctx.finish({ score: total, rounds: log });
      });
    }
  }

  playRound();
}

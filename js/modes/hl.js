// Higher / Lower — Play Your Cards Right × Hot-or-Not. Endless one-call
// chain: is the next item's price higher or lower than the current card?
// Play until wrong; score = streak. Adjacent cards always differ by ≥1.25×
// so calls are defensible, never coin-flips on stale data.

import { GAME } from '../config.js';
import { rngFor, shuffled } from '../rng.js';
import { iconUrl, fmtGoldLong } from '../data.js';
import { el } from '../ui.js';

export const meta = { id: 'hl', title: 'Higher or Lower', rounds: null };

// Deterministic card stream for a seed: walk a seeded shuffle, only accepting
// cards that clear the separation ratio vs the card before them; reshuffle
// (continuing the same rng) when the walk runs dry.
export function makeStream(bundle, seed, v) {
  const rng = rngFor(['hl', seed, `v${v}`]);
  const minLn = Math.log(GAME.hlMinSeparation);
  let deck = shuffled(bundle.priceItems, rng);
  let i = 0;
  let prev = null;

  function next() {
    for (let guard = 0; guard < 3; guard++) {
      while (i < deck.length) {
        const card = deck[i++];
        if (!prev) { prev = card; return card; }
        if (card.id !== prev.id && Math.abs(Math.log(card.mv / prev.mv)) >= minLn) {
          prev = card;
          return card;
        }
      }
      deck = shuffled(bundle.priceItems, rng);
      i = 0;
    }
    // Pathological pool; should never happen with 400+ price items.
    prev = deck[0];
    return deck[0];
  }
  return { next };
}

export function start(ctx) {
  const stream = makeStream(ctx.bundle, ctx.seed, ctx.v);
  const log = [];
  let streak = 0;
  let current = stream.next();
  let challenger = stream.next();

  ctx.timerBar.parentElement.style.display = 'none'; // untimed — zero friction

  function cardEl(item, hidePrice) {
    return el('div', { class: 'hl-card' },
      el('img', { src: iconUrl(item), alt: '' }),
      el('div', { class: `iname q-${item.q}`, html: item.n }),
      hidePrice
        ? el('div', { class: 'ihidden' }, '?')
        : el('div', { class: 'iprice' }, fmtGoldLong(item.mv)),
    );
  }

  function render() {
    ctx.setMeta('Endless chain');
    ctx.setScore(streak);
    ctx.content.innerHTML = '';
    ctx.content.append(
      el('div', { class: 'question-prompt', html: `Is <strong class="q-${challenger.q}">${challenger.n}</strong> worth more or less than <strong class="q-${current.q}">${current.n}</strong>?` }),
      el('div', { class: 'hl-cards' },
        cardEl(current, false),
        el('div', { class: 'hl-vs' }, 'VS'),
        cardEl(challenger, true),
      ),
      el('div', { class: 'hl-buttons' },
        el('button', { class: 'btn', onclick: () => call(true) }, '▲ Higher'),
        el('button', { class: 'btn secondary', onclick: () => call(false) }, '▼ Lower'),
      ),
      el('div', { class: 'hl-streak' }, streak > 0 ? `Streak: ${streak}` : ' '),
    );
  }

  function call(saidHigher) {
    const isHigher = challenger.mv > current.mv;
    const ok = saidHigher === isHigher;
    log.push({ id: challenger.id, a: saidHigher ? 'H' : 'L', ok, s: ok ? 1 : 0, t: 0 });

    // Reveal the challenger's price in place
    ctx.content.querySelectorAll('.hl-buttons button').forEach(b => (b.disabled = true));
    const hidden = ctx.content.querySelector('.ihidden');
    if (hidden) {
      hidden.outerHTML = `<div class="iprice">${fmtGoldLong(challenger.mv)}</div>`;
    }

    if (ok) {
      streak += 1;
      ctx.setScore(streak);
      const streakEl = ctx.content.querySelector('.hl-streak');
      streakEl.textContent = `Streak: ${streak}`;
      setTimeout(() => {
        current = challenger;
        challenger = stream.next();
        render();
      }, 1100);
    } else {
      const streakEl = ctx.content.querySelector('.hl-streak');
      streakEl.innerHTML = `<span style="color:var(--red)">Wrong!</span> Final streak: ${streak}`;
      setTimeout(() => ctx.finish({ score: streak, rounds: log }), 1600);
    }
  }

  render();
}

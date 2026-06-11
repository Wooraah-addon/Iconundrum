// Guess the Icon — classic 4-choice, icon → name. 5 rounds, 10s timer,
// speed-decay scoring (500 base + up to 500 for speed).
//
// Distractors come from similarity tiers (v0 = filename families +
// class/subclass): same icon family first, then same subclass, then same
// class, then anything. Items sharing the EXACT icon file with the answer are
// excluded — two names for one identical picture is unanswerable, not hard.
// Sampling draws 3 from the top-K candidates so the same item can roll
// different choice sets across different seeds.

import { GAME } from '../config.js';
import { rngFor, sample, shuffled } from '../rng.js';
import { iconUrl } from '../data.js';
import { el, startTimer, renderReveal } from '../ui.js';

const TOP_K = 12;

export const meta = { id: 'icon', title: 'Guess the Icon', rounds: GAME.iconRounds };

export function buildRounds(bundle, seed, v) {
  const rng = rngFor(['icon', seed, `v${v}`]);
  const answers = sample(bundle.items, GAME.iconRounds, rng);
  return answers.map(item => {
    const candidates = distractorCandidates(bundle, item);
    const distractors = sample(candidates.slice(0, TOP_K), 3, rng);
    const choices = shuffled([item, ...distractors], rng);
    return { item, choices };
  });
}

function distractorCandidates(bundle, answer) {
  const seen = new Set([answer.id]);
  const names = new Set([answer.n]);
  const out = [];
  // Cumulative cap per tier: at most 6 of the 12 candidates from the literal
  // icon family, so giant families (herbs, gems) don't make every question
  // max-difficulty; the rest fill in from subclass/class/any.
  const tiers = [
    { cap: 6, match: it => it.family === answer.family },
    { cap: 10, match: it => it.c === answer.c && it.s === answer.s },
    { cap: TOP_K, match: it => it.c === answer.c },
    { cap: TOP_K, match: () => true },
  ];
  for (const { cap, match } of tiers) {
    for (const it of bundle.items) {
      if (out.length >= cap) break;
      if (seen.has(it.id) || names.has(it.n)) continue;
      if (it.i === answer.i) continue; // identical icon file = ambiguous
      if (!match(it)) continue;
      seen.add(it.id);
      names.add(it.n);
      out.push(it);
    }
    if (out.length >= TOP_K) break;
  }
  return out;
}

export function start(ctx) {
  const rounds = buildRounds(ctx.bundle, ctx.seed, ctx.v);
  const log = [];
  let total = 0;
  let idx = 0;

  function playRound() {
    const { item, choices } = rounds[idx];
    ctx.setMeta(`Round ${idx + 1} / ${rounds.length}`);
    ctx.setScore(total);
    ctx.content.innerHTML = '';

    const buttons = [];
    const grid = el('div', { class: 'choices' });
    const wrap = el('div', {},
      el('div', { class: 'question-icon-wrap' },
        el('img', { class: 'question-icon', src: iconUrl(item), alt: 'Mystery item icon' })),
      el('div', { class: 'question-prompt', html: 'Which item is this?' }),
      grid,
    );
    ctx.content.append(wrap);

    const timer = startTimer(GAME.iconTimerSec, ctx.timerBar, () => settle(null));

    for (const c of choices) {
      const b = el('button', { class: 'choice', onclick: () => settle(c) }, c.n);
      buttons.push(b);
      grid.append(b);
    }

    let settled = false;
    function settle(chosen) {
      if (settled) return;
      settled = true;
      timer.stop();
      const ok = chosen && chosen.id === item.id;
      const earned = ok ? 500 + Math.round(500 * timer.leftFrac()) : 0;
      total += earned;
      log.push({ id: item.id, a: chosen ? chosen.id : null, ok: !!ok, s: earned, t: Math.round(timer.elapsedMs()) });

      for (const b of buttons) {
        b.disabled = true;
        const name = b.textContent;
        if (name === item.n) b.classList.add('correct');
        else if (chosen && name === chosen.n) b.classList.add('wrong');
        else b.classList.add('dim');
      }
      ctx.setScore(total);

      setTimeout(() => {
        const headline = ok
          ? `+${earned.toLocaleString()} pts`
          : (chosen ? 'Wrong — +0 pts' : 'Time’s up — +0 pts');
        const last = idx === rounds.length - 1;
        renderReveal(ctx.content, item, headline, null, last ? 'See results' : 'Next round', () => {
          idx += 1;
          if (idx < rounds.length) playRound();
          else ctx.finish({ score: total, rounds: log });
        });
      }, 900);
    }
  }

  playRound();
}

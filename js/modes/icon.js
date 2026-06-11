// Guess the Icon — classic 4-choice, icon → name. Configurable rounds,
// timer, and speed-bonus scoring (off = flat 1000 per correct).
//
// Distractors come from similarity tiers (v0 = filename families +
// class/subclass) WITHIN the chosen category pool: same icon family first,
// then same subclass, then same class, then anything in the pool. Items
// sharing the EXACT icon file with the answer are excluded — two names for
// one identical picture is unanswerable, not hard. Sampling draws 3 from the
// top-K candidates so the same item can roll different choice sets across
// different seeds.

import { rngFor, sample, shuffled } from '../rng.js';
import { iconUrl, catItems } from '../data.js';
import { el, startTimer, renderReveal } from '../ui.js';
import { play } from '../sound.js';
import { buildSyncFooter } from '../lobby.js';

const TOP_K = 12;

export function buildRounds(bundle, cfg) {
  const rng = rngFor(['icon', cfg.seed, `v${cfg.v}`]);
  const pool = catItems(bundle, cfg.cat);
  const answers = sample(pool, cfg.rounds, rng);
  return answers.map(item => {
    const candidates = distractorCandidates(pool, item);
    const distractors = sample(candidates.slice(0, TOP_K), 3, rng);
    const choices = shuffled([item, ...distractors], rng);
    return { item, choices };
  });
}

function distractorCandidates(pool, answer) {
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
    for (const it of pool) {
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
  const cfg = ctx.cfg;
  const rounds = buildRounds(ctx.bundle, cfg);
  const log = [];
  let total = 0;
  let idx = 0;
  let roundToken = 0;
  let forceSettle = null;
  const synced = () => ctx.sync && !ctx.sync.detached;

  // Host-paced multiplayer: the lobby driver advances everyone together.
  // If this client is somehow still mid-question (clock skew), settle it
  // silently and move on — the host's gate means their timer is long done.
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

    const timer = startTimer(cfg.timer, ctx.timerBar,
      () => settle(null),
      sec => { if (sec <= 3 && sec > 0) play('tick'); });

    for (const c of choices) {
      const b = el('button', { class: 'choice', onclick: () => settle(c) }, c.n);
      buttons.push(b);
      grid.append(b);
    }

    let settled = false;
    forceSettle = () => settle(null, true);

    function settle(chosen, forced = false) {
      if (settled) return;
      settled = true;
      timer.stop();
      const ok = chosen && chosen.id === item.id;
      const earned = ok ? (cfg.speed ? 500 + Math.round(500 * timer.leftFrac()) : 1000) : 0;
      total += earned;
      log.push({ id: item.id, a: chosen ? chosen.id : null, ok: !!ok, s: earned, t: Math.round(timer.elapsedMs()) });
      ctx.setScore(total);
      if (ctx.sync) ctx.sync.reportScore(total);
      if (forced) return; // advancing right now — skip the reveal
      play(ok ? 'correct' : 'wrong');

      for (const b of buttons) {
        b.disabled = true;
        const name = b.textContent;
        if (name === item.n) b.classList.add('correct');
        else if (chosen && name === chosen.n) b.classList.add('wrong');
        else b.classList.add('dim');
      }

      setTimeout(() => {
        if (token !== roundToken) return; // already advanced past this round
        const headline = ok
          ? `+${earned.toLocaleString()} pts`
          : (chosen ? 'Wrong — +0 pts' : 'Time’s up — +0 pts');
        const last = idx === rounds.length - 1;
        const footer = synced()
          ? buildSyncFooter(ctx.sync, {
              last,
              onHostNext: () => ctx.sync.hostAdvance(idx + 1),
              onLocalNext: () => proceed(idx + 1),
            })
          : el('button', { class: 'btn', onclick: () => { play('click'); proceed(idx + 1); } },
              last ? 'See results' : 'Next round');
        renderReveal(ctx.content, item, headline, null, footer);
      }, 900);
    }
  }

  playRound();
}

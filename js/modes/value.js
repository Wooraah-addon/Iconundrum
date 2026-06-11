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
import { buildSyncFooter, revealHoldMs } from '../lobby.js';

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

// Goblin auctioneer commentary on the reveal. Buckets align 1:1 with the
// reveal jingles (jackpot/correct/coin/wrong) so a future voice pack can key
// off the same split.
export const HECKLES = {
  jackpot: [
    'You’re banned from my auction house.',
    'Alright, who leaked my ledger?!',
    'Spot on. I don’t like it. I don’t like YOU.',
    'An appraisal like that, you’re after my job.',
  ],
  close: [
    'Close enough to make me nervous.',
    'Hmph. Lucky. Definitely lucky.',
    'You’ve haggled before, haven’t you.',
    'Not bad. I’d still have fleeced you on the fees.',
  ],
  off: [
    'Eh. I’ve seen worse from a gnome.',
    'You’d survive the auction house. Barely.',
    'Half right is still half broke, friend.',
    'That’s a “first week with the addon” guess.',
  ],
  wayoff: [
    'Did you price that with your fishing skill?',
    'Time is money, friend — and you just wasted both.',
    'My peon prices better than that. The PEON.',
    'Were you bidding, or insulting the seller?',
  ],
  absurd: [
    'SECURITY! Get this one out of my auction house.',
    'That’s not a price, that’s a cry for help.',
    'I’d sell you a bridge in Booty Bay, but you’d overpay.',
    'Somewhere, an auctioneer just fainted.',
  ],
  noguess: [
    'Cat got your gold?',
    'Silence won’t lower the deposit, friend.',
    'No bid? No backbone.',
    'The auction waits for no one. NEXT!',
  ],
};

export function heckleBucket(guess, actual, earned) {
  if (!guess || guess <= 0) return 'noguess';
  if (earned === 5000) return 'jackpot';
  const r = guess > actual ? guess / actual : actual / guess;
  if (r <= 1.25) return 'close';
  if (r <= 2) return 'off';
  if (r <= 10) return 'wayoff';
  return 'absurd';
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
      if (ctx.sync) ctx.sync.reportScore(total);
      if (forced) return; // advancing right now — skip the reveal

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
      // Math.random, not the seeded rng: a draw from the game rng would shift
      // every later draw and fork shared boards.
      const lines = HECKLES[heckleBucket(guess, actual, earned)];
      detail += `<span class="heckle">“${lines[Math.floor(Math.random() * lines.length)]}” — Auctioneer Drezbit</span>`;
      const last = idx === rounds.length - 1;
      // Synced: the reveal (and its jackpot/wrong jingle) discloses the real
      // price — hold both until everyone's timer is done (F37).
      const hold = synced() ? revealHoldMs(ctx.sync.roundStartMs, cfg.timer * 1000, Date.now()) : 0;
      let waitEl = null;
      if (hold > 600) {
        waitEl = el('div', { class: 'lb-note round-wait' }, '🔒 Locked in — revealed when the round ends.');
        preview.after(waitEl);
      }
      setTimeout(() => {
        if (token !== roundToken) return; // already advanced past this round
        if (waitEl) waitEl.remove();
        play(earned === 5000 ? 'jackpot' : earned >= 2500 ? 'correct' : earned > 0 ? 'coin' : 'wrong');
        ctx.setScore(total);
        setTimeout(() => {
          if (token !== roundToken) return;
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
      }, hold);
    }
  }

  playRound();
}

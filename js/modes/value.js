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
    'That close? My ledgers just broke out in sweat.',
    'Who sold you my price list, rat?',
    'Insider trading looks good on you, thief.',
    'That smells like a cartel meeting in Booty Bay.',
    'You price like a goblin. I hate that.',
    'I’m impressed, which is billable.',
    'Either genius, or you bribed the auctioneer.',
    'That was too clean. Check their bags.',
    'I’d salute, but both hands are counting your cut.',
    'You just undercut my confidence.',
    'That’s not luck, that’s laundering.',
    'Fine. You may touch one ledger. Once.',
    'Even Gallywix would audit that guess.',
    'Your accuracy has deposit-fraud energy.',
    'I hate competence unless I invoice it.',
  ],
  close: [
    'Close enough to make me nervous.',
    'Hmph. Lucky. Definitely lucky.',
    'You’ve haggled before, haven’t you.',
    'Not bad. I’d still have fleeced you on the fees.',
    'Close enough to overcharge with confidence.',
    'Not terrible. I’ve taxed worse.',
    'You’re near the price, far from respect.',
    'A respectable guess from a discount brain.',
    'I’d list it near there, then undercut you.',
    'Close. Don’t start wearing a top hat.',
    'Almost profitable. Almost attractive.',
    'Fine instincts. Shame about the packaging.',
    'You found the market and tripped at the stall.',
    'Close enough for a gnome with a calculator.',
    'I expected worse, so technically you owe me.',
    'Near enough to be annoying.',
    'That price has a pulse. Weak, but billable.',
    'You’re learning. I’ll raise the lesson fee.',
    'I dislike how little I can insult that.',
  ],
  off: [
    'Eh. I’ve seen worse from a gnome.',
    'You’d survive the auction house. Barely.',
    'Half right is still half broke, friend.',
    'That’s a “first week with the addon” guess.',
    'That price has more wobble than a goblin ladder.',
    'You’re not wrong enough to be interesting.',
    'Did a kobold appraise that with a candle?',
    'Your math limped into the AH and asked for credit.',
    'That’s a price, not a business plan.',
    'You aimed at profit and hit storage fees.',
    'That estimate came pre-undercut.',
    'Your guess needs a helmet.',
    'That’s budget thinking in premium boots.',
    'I’d correct you, but tutoring costs extra.',
    'Not a disaster, just aggressively average.',
    'You brought a spoon to a bidding war.',
    'The AH would take your deposit and your dignity.',
    'That price has starter-zone confidence.',
    'Your valuation got lost near Ratchet.',
  ],
  wayoff: [
    'Did you price that with your fishing skill?',
    'Time is money, friend — and you just wasted both.',
    'My peon prices better than that. The PEON.',
    'Were you bidding, or insulting the seller?',
    'That price fell off the zeppelin.',
    'I’ve seen vendor trash show more ambition.',
    'Did you appraise it from another expansion?',
    'Your number needs a rez and a financial adviser.',
    'That’s not valuation, that’s decorative math.',
    'Booty Bay called. They want distance from this.',
    'You undercut reality itself.',
    'A murloc with a shell abacus beats that.',
    'You priced it like the AH owes you therapy.',
    'I’ve seen corpse runs with better direction.',
    'You missed the market by a flight path.',
    'Your gold sense is bound on pickup.',
    'I’d insure that guess, then burn the policy.',
    'You brought vendor logic to a luxury auction.',
    'That price is so lost, it needs a hearthstone.',
  ],
  absurd: [
    'SECURITY! Get this one out of my auction house.',
    'That’s not a price, that’s a cry for help.',
    'I’d sell you a bridge in Booty Bay, but you’d overpay.',
    'Somewhere, an auctioneer just fainted.',
    'Security, remove the walking market crash.',
    'That guess just lowered property values in Orgrimmar.',
    'I’m sending that number to collections.',
    'That price belongs in a museum of bad decisions.',
    'You just invented negative expertise.',
    'My ledger is trying to leave the room.',
    'I’ve seen scams with better fundamentals.',
    'You priced it like gold grows on boars.',
    'That’s a felony in three auction houses.',
    'Even Booty Bay pirates would call that theft.',
    'I’m billing you for emotional depreciation.',
    'That guess should be soulbound to shame.',
    'You didn’t miss the market. You declared war on it.',
    'I’m putting your math in a locked crate.',
    'The goblin cartel denies any association.',
  ],
  noguess: [
    'Cat got your gold?',
    'Silence won’t lower the deposit, friend.',
    'No bid? No backbone.',
    'The auction waits for no one. NEXT!',
    'Blank input, blank ledger, blank future.',
    'You brought no price to a price fight.',
    'Even a peon writes something down.',
    'The AH does not accept vibes as currency.',
    'Empty hands, empty pockets, empty prospects.',
    'Type a number, not your financial outlook.',
    'That blank space just got undercut.',
    'I’ve seen abandoned mailboxes show more intent.',
    'No bid? Then stop breathing on the merchandise.',
    'Your courage expired before the deposit fee.',
    'The market waited. You contributed furniture.',
    'That was the cheapest nothing I’ve ever seen.',
    'You forgot the price and brought the shame.',
    'Blank? Even vendor trash has a number.',
    'No entry, no mercy, no refund.',
  ],
};

// Math.random, not the seeded rng: a draw from the game rng would shift
// every later draw and fork shared boards.
const lastHeckle = {};
export function pickHeckle(bucket, rand = Math.random) {
  const lines = HECKLES[bucket];
  let line;
  do { line = lines[Math.floor(rand() * lines.length)]; }
  while (line === lastHeckle[bucket] && lines.length > 1);
  lastHeckle[bucket] = line;
  return line;
}

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
      detail += `<span class="heckle">“${pickHeckle(heckleBucket(guess, actual, earned))}”</span>`;
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

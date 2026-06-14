// Higher / Lower — Play Your Cards Right × Hot-or-Not. Endless one-call
// chain: is the next item's price higher or lower than the current card?
// Play until wrong; score = streak. Adjacent cards always differ by the
// configured separation ratio (Goblin ≥1.25×, Tycoon ≥1.10×) so calls are
// defensible, never coin-flips on stale data. Prices follow cfg.basis
// ('mv' posted market avg / 'sa' TSM sale avg) — locked into the link.

// Multiplayer (F39) is a RACE: synced launch, then everyone rides the same
// deterministic chain at their own pace. Live standings (streaks + 💀 for
// the fallen) sit under the cards; the fallen spectate until everyone's
// done, then all flow to the normal summary + challenge board.

import { rngFor, shuffled } from '../rng.js';
import { iconUrl, fmtGoldLong, catItems, priceOf, preloadIcons } from '../data.js';
import { el, icon, startTimer, escapeHtml, toast } from '../ui.js';
import { play } from '../sound.js';
import { celebrate } from '../fx.js';
import { revealHoldMs, lmsDecision } from '../lobby.js';

// Streak landmarks worth a coin-burst — early ones close together for a quick
// first taste, then every 5 so a long run keeps punctuating without spamming.
const isMilestone = s => s === 3 || (s >= 5 && s % 5 === 0);

// Where the streak heat tops out (font/glow stop growing) — keeps a 50-run
// from swallowing the screen. Mirrors the .hl-streak calc in style.css.
const STREAK_CAP = 20;

// Re-trigger the increment pop on the (persistent) streak element.
function popStreak(streakEl, streak) {
  streakEl.style.setProperty('--streak', Math.min(streak, STREAK_CAP));
  streakEl.classList.remove('bump');
  void streakEl.offsetWidth; // restart the animation
  streakEl.classList.add('bump');
}

// Deterministic card stream for a seed: walk a seeded shuffle, only accepting
// cards that clear the separation ratio vs the card before them; reshuffle
// (continuing the same rng) when the walk runs dry.
export function makeStream(bundle, cfg) {
  const rng = rngFor(['hl', cfg.seed, `v${cfg.v}`]);
  const basis = cfg.basis || 'mv';
  const pool = catItems(bundle, cfg.cat, basis);
  const minLn = Math.log(cfg.sep / 100);
  let deck = shuffled(pool, rng);
  let i = 0;
  let prev = null;

  function next() {
    for (let guard = 0; guard < 3; guard++) {
      while (i < deck.length) {
        const card = deck[i++];
        if (!prev) { prev = card; return card; }
        if (card.id !== prev.id && Math.abs(Math.log(priceOf(card, basis) / priceOf(prev, basis))) >= minLn) {
          prev = card;
          return card;
        }
      }
      deck = shuffled(pool, rng);
      i = 0;
    }
    // Pathological pool; should never happen with viable categories.
    prev = deck[0];
    return deck[0];
  }
  return { next };
}

export function start(ctx) {
  // F62: in a lobby, "Last Man Standing" is a synchronized elimination shell
  // on this same chain. Solo (or a detached race) keeps the classic endless run.
  if (ctx.cfg.style === 'lms' && ctx.sync && !ctx.sync.detached) return startLMS(ctx);

  const basis = ctx.cfg.basis || 'mv';
  const stream = makeStream(ctx.bundle, ctx.cfg);
  const log = [];
  let streak = 0;
  let lives = ctx.cfg.lives || 1; // extra lives survive wrong calls (unranked variant)
  const maxLives = lives;
  let current = stream.next();
  let challenger = stream.next();
  preloadIcons([current, challenger]);
  const synced = () => ctx.sync && !ctx.sync.detached;

  ctx.timerBar.parentElement.style.display = 'none'; // untimed — zero friction

  // Race plumbing: appear on the board at streak 0, then live-update the
  // standings strip wherever its current element sits.
  let raceEl = null;
  if (synced()) {
    ctx.sync.reportScore(0);
    ctx.sync.onScores(() => { if (raceEl && raceEl.isConnected) renderRace(raceEl, ctx.sync); });
  }

  // Keyboard: H / ↑ = higher, L / ↓ = lower. Acts on the live call buttons
  // only (ignored once a call is locked in). Removed at game over so replays
  // don't stack listeners.
  const onKey = e => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    const btns = ctx.content.querySelectorAll('.hl-buttons button');
    if (!btns.length || btns[0].disabled) return;
    const k = e.key.toLowerCase();
    if (k === 'h' || e.key === 'ArrowUp') { e.preventDefault(); btns[0].click(); }
    else if (k === 'l' || e.key === 'ArrowDown') { e.preventDefault(); btns[1].click(); }
  };
  document.addEventListener('keydown', onKey);

  function heartsEl() {
    if (maxLives <= 1) return null;
    const h = el('div', { class: 'hl-hearts' });
    for (let i = 0; i < maxLives; i++) {
      h.append(el('span', { class: i < lives ? 'full' : 'spent' }, '♥'));
    }
    return h;
  }

  function cardEl(item, hidePrice) {
    return el('div', { class: 'hl-card' },
      el('img', { src: iconUrl(item), alt: '' }),
      el('div', { class: `iname q-${item.q}`, html: item.n }),
      hidePrice
        ? el('div', { class: 'ihidden' }, '?')
        : el('div', { class: 'iprice' }, fmtGoldLong(priceOf(item, basis))),
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
      el('div', { class: 'hl-keyhint' }, 'Tip: press H for higher, L for lower'),
      heartsEl(),
      el('div', { class: 'hl-streak', style: `--streak:${Math.min(streak, STREAK_CAP)}` }, streak > 0 ? `Streak: ${streak}` : ' '),
    );
    if (synced()) {
      raceEl = el('div', { class: 'hl-race' });
      renderRace(raceEl, ctx.sync);
      ctx.content.append(raceEl);
    }
  }

  function call(saidHigher) {
    const a = priceOf(challenger, basis);
    const b = priceOf(current, basis);
    const isHigher = a > b;
    const ok = saidHigher === isHigher;
    const ratio = Math.max(a, b) / Math.min(a, b);
    const gapTxt = `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${isHigher ? 'higher' : 'lower'}`;
    log.push({ id: challenger.id, a: saidHigher ? 'H' : 'L', ok, s: ok ? 1 : 0, t: 0 });

    // Reveal the challenger's price in place
    ctx.content.querySelectorAll('.hl-buttons button').forEach(b => (b.disabled = true));
    const hidden = ctx.content.querySelector('.ihidden');
    if (hidden) {
      hidden.outerHTML = `<div class="iprice">${fmtGoldLong(a)}</div>`;
    }

    const streakEl = ctx.content.querySelector('.hl-streak');
    if (ok) {
      play('coin');
      streak += 1;
      ctx.setScore(streak);
      if (synced()) ctx.sync.reportScore(streak);
      streakEl.textContent = `Streak: ${streak} — it was ${gapTxt}`;
      popStreak(streakEl, streak);
      if (isMilestone(streak)) celebrate(streakEl, 1 + streak / 25);
      setTimeout(() => {
        current = challenger;
        challenger = stream.next();
        preloadIcons([challenger]);
        render();
      }, 1100);
    } else if (lives > 1) {
      // A heart absorbs the miss — streak survives, chain rolls on.
      lives -= 1;
      play('wrong');
      const hearts = ctx.content.querySelector('.hl-hearts');
      if (hearts) {
        const full = hearts.querySelectorAll('.full');
        full[full.length - 1].className = 'spent';
      }
      streakEl.innerHTML = `<span style="color:var(--red)">Wrong — it was ${gapTxt}.</span> −1 ♥`;
      setTimeout(() => {
        current = challenger;
        challenger = stream.next();
        preloadIcons([challenger]);
        render();
      }, 1500);
    } else {
      play('wrong');
      streakEl.innerHTML = `<span style="color:var(--red)">Wrong — it was ${gapTxt}.</span> Final streak: ${streak}`;
      document.removeEventListener('keydown', onKey);
      if (synced()) ctx.sync.markDone(streak);
      setTimeout(() => {
        play('gameover');
        if (synced() && !ctx.sync.allDone()) spectate();
        else ctx.finish({ score: streak, rounds: log });
      }, 1600);
    }
  }

  // Race spectator state: you're out, others are still riding. Live
  // standings keep updating; flow to the summary when the last rider falls
  // (or whenever you like — a closed tab can't hold the race hostage).
  function spectate() {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      ctx.finish({ score: streak, rounds: log });
    };
    ctx.content.innerHTML = '';
    raceEl = el('div', { class: 'hl-race' });
    renderRace(raceEl, ctx.sync);
    ctx.content.append(
      el('div', { class: 'question-prompt' }, `You're out at ${streak} — watching the race…`),
      raceEl,
      el('div', { class: 'action-row' },
        el('button', { class: 'btn secondary', onclick: () => { play('click'); done(); } }, 'See results now')),
    );
    ctx.sync.onScores(() => {
      if (finished || !raceEl.isConnected) return;
      renderRace(raceEl, ctx.sync);
      if (ctx.sync.allDone()) done();
    });
  }

  render();
}

// F62 Last Man Standing — host-paced synchronized elimination on the shared
// HL chain. Every client faces the SAME card pair each round (the chain is
// deterministic per seed), calls within a timer, and at a synchronized reveal
// a wrong call (or no answer) burns a life; out at zero. The pacer (the host)
// gates rounds via the lobby doc's round/roundAt — the Icon/Value host-advance
// model, but auto-driven, so a host who's already been eliminated keeps the
// show running. Shared state rides the existing `scores` (live streak) and
// `fin` (player → elimination round) maps: no new lobby fields, no rules
// change. Last one standing wins; a same-round wipe of the final survivors
// sends them to sudden-death playoff rounds (see lmsDecision).
function startLMS(ctx) {
  const cfg = ctx.cfg;
  const sync = ctx.sync;
  const basis = cfg.basis || 'mv';
  const timerSecs = cfg.timer || 12;   // baked by makeCfg (LMS_TIMER)
  const REVEAL_PAUSE = 6000;           // ms after timer end: reveal + fin-write propagation margin + stream breathing room
  const FAILSAFE_EXTRA = 8000;         // a vanished pacer ends the round this long past the decision instant
  const CAP = 60;                      // the lobby `round` field is rules-capped at 60

  const stream = makeStream(ctx.bundle, cfg);
  const cards = [stream.next()];
  const cardAt = i => { while (cards.length <= i) cards.push(stream.next()); return cards[i]; };

  const log = [];
  let streak = 0;
  let lives = cfg.lives || 1;
  const startLives = lives;
  let myOutRound = null;   // the round I hit 0 lives (null = still standing)
  let round = 0;
  let roundToken = 0;
  let onKey = null;
  let decisionTimer = null;
  let failsafeTimer = null;
  let ended = false;
  let finished = false;
  let celebrated = false;

  const price = it => priceOf(it, basis);
  const dropKeys = () => { if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; } };

  function cardEl(item, hidePrice) {
    return el('div', { class: 'hl-card' },
      el('img', { src: iconUrl(item), alt: '' }),
      el('div', { class: `iname q-${item.q}`, html: item.n }),
      hidePrice ? el('div', { class: 'ihidden' }, '?')
                : el('div', { class: 'iprice' }, fmtGoldLong(price(item))));
  }
  function heartsEl() {
    if (startLives <= 1) return null;
    const h = el('div', { class: 'hl-hearts' });
    for (let i = 0; i < startLives; i++) h.append(el('span', { class: i < lives ? 'full' : 'spent' }, '♥'));
    return h;
  }
  // Live "who's still standing" strip — reuses the race standings (streak +
  // skull). onScores is a single replaceable handler, so the latest round's
  // strip is the one that updates; disconnected ones no-op on the guard.
  function liveStrip() {
    const strip = el('div', { class: 'hl-race' });
    renderRace(strip, sync);
    sync.onScores(() => { if (strip.isConnected) renderRace(strip, sync); });
    return strip;
  }

  ctx.timerBar.parentElement.style.display = '';
  sync.reportScore(0);
  sync.onAdvance(n => proceed(n));

  function proceed(n) {
    clearTimeout(failsafeTimer);
    round = n;
    playRound();
  }

  // Every client schedules the same decision instant off the shared round
  // start; the host writes the advance, the rest follow via onAdvance.
  function scheduleDecision(forRound) {
    clearTimeout(decisionTimer);
    const at = sync.roundStartMs + timerSecs * 1000 + REVEAL_PAUSE;
    decisionTimer = setTimeout(() => decide(forRound), Math.max(0, at - Date.now()));
    if (!sync.isHost) {
      clearTimeout(failsafeTimer);
      failsafeTimer = setTimeout(() => {
        if (!ended && forRound === round) {
          toast('Wrapping up — the host stopped pacing.');
          // A pacer vanished. Only crown a champion if the field has actually
          // resolved (≤1 left); a mid-game stall shows standings, not a winner.
          endLMS(sync.lmsAliveCount() <= 1);
        }
      }, Math.max(0, at + FAILSAFE_EXTRA - Date.now()));
    }
  }

  function decide(forRound) {
    if (ended || forRound !== round) return;
    const verdict = lmsDecision(sync.lmsAliveCount(), round, CAP);
    if (verdict === 'win' || verdict === 'end') { endLMS(true); return; }
    if (verdict === 'playoff' && myOutRound !== null && myOutRound === sync.lastOutRound()) {
      // Same-round wipe of the last survivors — I'm back in, sudden death.
      // Keyed to the last elimination round (not the live counter), so if a
      // read mis-timed the wipe and advanced past it, I still revive here next
      // pass instead of being stranded out (self-heals the rare lag case).
      myOutRound = null;
      lives = 1;
      sync.reviveMe();
    }
    if (sync.isHost) sync.hostAdvance(round + 1);
    // non-hosts follow onAdvance; the failsafe covers a pacer who vanished
  }

  function playRound() {
    roundToken++;
    const token = roundToken;
    dropKeys();
    const current = cardAt(round);
    const challenger = cardAt(round + 1);
    preloadIcons([challenger, cardAt(round + 2)]);
    ctx.setMeta(`Round ${round + 1} · last one standing`);
    ctx.setScore(streak);

    if (myOutRound !== null) { renderSpectate(); scheduleDecision(round); return; }

    ctx.timerBar.parentElement.style.display = '';
    ctx.content.innerHTML = '';
    ctx.content.append(
      el('div', { class: 'question-prompt', html: `Is <strong class="q-${challenger.q}">${challenger.n}</strong> worth more or less than <strong class="q-${current.q}">${current.n}</strong>?` }),
      el('div', { class: 'hl-cards' }, cardEl(current, false), el('div', { class: 'hl-vs' }, 'VS'), cardEl(challenger, true)),
      el('div', { class: 'hl-buttons' },
        el('button', { class: 'btn', onclick: () => settle(true) }, '▲ Higher'),
        el('button', { class: 'btn secondary', onclick: () => settle(false) }, '▼ Lower')),
      el('div', { class: 'hl-keyhint' }, 'Tip: press H for higher, L for lower'),
      heartsEl(),
      el('div', { class: 'hl-streak', style: `--streak:${Math.min(streak, STREAK_CAP)}` }, streak > 0 ? `Streak: ${streak}` : ' '),
      liveStrip(),
    );

    onKey = e => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      const btns = ctx.content.querySelectorAll('.hl-buttons button');
      if (!btns.length || btns[0].disabled) return;
      const k = e.key.toLowerCase();
      if (k === 'h' || e.key === 'ArrowUp') { e.preventDefault(); settle(true); }
      else if (k === 'l' || e.key === 'ArrowDown') { e.preventDefault(); settle(false); }
    };
    document.addEventListener('keydown', onKey);

    const timer = startTimer(timerSecs, ctx.timerBar, () => settle(null),
      sec => { if (sec <= 3 && sec > 0) play('tick'); });
    let settled = false;

    function settle(saidHigher) {
      if (settled) return;
      settled = true;
      dropKeys();
      timer.stop();
      const a = price(challenger), b = price(current);
      const isHigher = a > b;
      const ok = saidHigher !== null && saidHigher === isHigher;
      const ratio = Math.max(a, b) / Math.min(a, b);
      const gapTxt = `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${isHigher ? 'higher' : 'lower'}`;
      log.push({ id: challenger.id, a: saidHigher == null ? '-' : (saidHigher ? 'H' : 'L'), ok, s: ok ? 1 : 0, t: 0 });

      const btns = ctx.content.querySelectorAll('.hl-buttons button');
      btns.forEach(bn => (bn.disabled = true));
      if (saidHigher !== null && btns[saidHigher ? 0 : 1]) btns[saidHigher ? 0 : 1].classList.add('picked');

      // Sync-fair (F37): hold every answer-disclosing change — the revealed
      // price, the lost heart, the streak bump — until every client's timer has
      // expired, so a fast caller can't leak the answer to the rest of the table.
      const hold = revealHoldMs(sync.roundStartMs, timerSecs * 1000, Date.now());
      let waitEl = null;
      if (hold > 0 && saidHigher !== null) {
        waitEl = el('div', { class: 'lb-note round-wait' }, icon('lock'), ' Locked in — revealed when the round ends.');
        ctx.content.append(waitEl);
      }
      setTimeout(() => {
        if (token !== roundToken) return;
        if (waitEl) waitEl.remove();
        const hidden = ctx.content.querySelector('.ihidden');
        if (hidden) hidden.outerHTML = `<div class="iprice">${fmtGoldLong(a)}</div>`;
        const streakEl = ctx.content.querySelector('.hl-streak');
        if (ok) {
          play('coin');
          streak += 1;
          ctx.setScore(streak);
          if (streakEl) { streakEl.textContent = `Correct — it was ${gapTxt}. Streak ${streak}`; popStreak(streakEl, streak); }
          if (isMilestone(streak) && streakEl) celebrate(streakEl, 1 + streak / 25);
        } else {
          lives -= 1;
          play('wrong');
          const hearts = ctx.content.querySelector('.hl-hearts');
          if (hearts) { const full = hearts.querySelectorAll('.full'); if (full.length) full[full.length - 1].className = 'spent'; }
          if (lives > 0) {
            if (streakEl) streakEl.innerHTML = `<span style="color:var(--red)">Wrong — it was ${gapTxt}.</span> −1 ♥`;
          } else {
            myOutRound = round;
            sync.markOut(round);
            if (streakEl) streakEl.innerHTML = `<span style="color:var(--red)">Out — it was ${gapTxt}.</span> You finished on streak ${streak}.`;
          }
        }
        sync.reportScore(streak);
      }, hold);
    }

    scheduleDecision(round);
  }

  function renderSpectate() {
    dropKeys();
    ctx.timerBar.parentElement.style.display = 'none';
    ctx.content.innerHTML = '';
    ctx.content.append(
      el('div', { class: 'question-prompt' }, `You're out at streak ${streak} — watching who's left standing…`),
      liveStrip(),
    );
  }

  // crown = the field resolved to a real winner (last-standing, or top streak
  // at the round cap). false = the game was cut short (pacer vanished mid-game):
  // show standings, no champion, no celebration — never crown an unresolved game.
  function endLMS(crown) {
    if (ended) return;
    ended = true;
    clearTimeout(decisionTimer);
    clearTimeout(failsafeTimer);
    dropKeys();
    ctx.timerBar.parentElement.style.display = 'none';
    play('gameover');
    renderPlacements(crown);
    // Late fin/score writes from the final round may still be landing; one
    // delayed re-render converges the table (mirrors main.js's board refetch).
    setTimeout(() => { if (ended && ctx.content.querySelector('.lms-place')) renderPlacements(crown); }, 2600);
  }

  function renderPlacements(crown) {
    const me = sync.playerName;
    const rows = sync.lmsPlacements();
    const champ = rows[0];
    const iWon = crown && champ && champ.name === me;
    ctx.content.innerHTML = '';
    const table = el('table', { class: 'lb standings lms-place' },
      el('tbody', {}, ...rows.map(r =>
        el('tr', { class: r.name === me ? 'me' : '' },
          el('td', { class: 'lms-rank' }, crown && r.place === 1 ? icon('crown') : String(r.place)),
          el('td', {}, r.name),
          el('td', { class: 'num' }, `streak ${r.streak}`),
        ))));
    ctx.content.append(
      el('div', { class: 'question-prompt', html: crown
        ? (champ ? `<strong>${escapeHtml(champ.name)}</strong> is the last one standing!` : 'Game over.')
        : 'Game cut short — the host left before a winner was decided.' }),
      el('div', { class: 'standings-head' }, crown ? (iWon ? 'You won!' : 'Final placing') : 'Standings when it stopped'),
      table,
      el('div', { class: 'action-row' },
        el('button', { class: 'btn', onclick: () => { play('click'); finishLMS(); } }, 'See your result')),
    );
    if (iWon && !celebrated) { celebrated = true; celebrate(ctx.content.querySelector('.question-prompt'), 1.7); }
  }

  function finishLMS() {
    if (finished) return;
    finished = true;
    ctx.finish({ score: streak, rounds: log });
  }

  playRound();
}

// Compact live standings for the race: rank · alive/dead · name · streak.
function renderRace(container, sync) {
  container.innerHTML = '';
  const rows = sync.raceStandings();
  if (rows.length < 2) return; // solo in a lobby — nothing to race
  container.append(
    el('div', { class: 'standings-head' }, 'The race'),
    el('table', { class: 'lb standings' },
      el('tbody', {}, ...rows.map(r =>
        el('tr', { class: r.name === sync.playerName ? 'me' : '' },
          el('td', {}, String(r.rank)),
          el('td', { class: 'race-state' }, r.dead ? icon('skull') : '▶'),
          el('td', {}, r.name),
          el('td', { class: 'num' }, String(r.score)),
        )))));
}

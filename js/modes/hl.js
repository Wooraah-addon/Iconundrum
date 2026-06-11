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
import { el } from '../ui.js';
import { play } from '../sound.js';
import { celebrate } from '../fx.js';

// Streak landmarks worth a coin-burst — early ones close together for a quick
// first taste, then every 5 so a long run keeps punctuating without spamming.
const isMilestone = s => s === 3 || (s >= 5 && s % 5 === 0);

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
      el('div', { class: 'hl-streak' }, streak > 0 ? `Streak: ${streak}` : ' '),
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
          el('td', { class: 'race-state' }, r.dead ? '💀' : '▶'),
          el('td', {}, r.name),
          el('td', { class: 'num' }, String(r.score)),
        )))));
}

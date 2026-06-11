// Guess the Icon — classic 4-choice, icon → name. Configurable rounds,
// timer, and speed-bonus scoring (off = flat 1000 per correct).
// Hard mode (cfg.hard): no choices — type the item name. Matching is
// case/punctuation-blind with one typo forgiven on longer names.
//
// Distractors come from similarity tiers (v0 = filename families +
// class/subclass) WITHIN the chosen category pool: same icon family first,
// then same subclass, then same class, then anything in the pool. Items
// sharing the EXACT icon file with the answer are excluded — two names for
// one identical picture is unanswerable, not hard. Sampling draws 3 from the
// top-K candidates so the same item can roll different choice sets across
// different seeds.

import { rngFor, sample, shuffled } from '../rng.js';
import { iconUrl, catItems, preloadIcons } from '../data.js';
import { el, startTimer, renderReveal } from '../ui.js';
import { play } from '../sound.js';
import { buildSyncFooter } from '../lobby.js';

const TOP_K = 12;

// ---- hard-mode name matching ----------------------------------------

// "Kang the Decapitator!" -> "kangthedecapitator": spacing, case and
// punctuation never decide a hard-mode answer.
export function normName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Exact normalized match always wins; names of 8+ normalized chars also
// forgive a single typo. Short names stay strict — "ore" vs "orb" is a
// different answer, not a typo.
export function nameMatches(guess, actual) {
  const g = normName(guess), a = normName(actual);
  if (!g) return false;
  if (g === a) return true;
  return a.length >= 8 && Math.abs(g.length - a.length) <= 1 && levenshtein(g, a) <= 1;
}

const escapeHtml = s => s.replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  preloadIcons(rounds.map(r => r.item)); // warm all round icons up front
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

    const wrap = el('div', {},
      el('div', { class: 'question-icon-wrap' },
        el('img', { class: 'question-icon', src: iconUrl(item), alt: 'Mystery item icon' })),
      el('div', { class: 'question-prompt', html: cfg.hard ? 'Name this item — no choices, goblin.' : 'Which item is this?' }),
    );
    ctx.content.append(wrap);

    const timer = startTimer(cfg.timer, ctx.timerBar,
      () => (cfg.hard ? settleHard(null) : settle(null)),
      sec => { if (sec <= 3 && sec > 0) play('tick'); });

    let settled = false;

    // Shared post-answer flow: score, log, sync report, then the reveal.
    // headlineWrong is shown when ok is false; ok builds its own headline.
    function conclude({ ok, logged, forced, headlineWrong, detail = null }) {
      const earned = ok ? (cfg.speed ? 500 + Math.round(500 * timer.leftFrac()) : 1000) : 0;
      total += earned;
      log.push({ id: item.id, a: logged, ok: !!ok, s: earned, t: Math.round(timer.elapsedMs()) });
      ctx.setScore(total);
      if (ctx.sync) ctx.sync.reportScore(total);
      if (forced) return; // advancing right now — skip the reveal
      play(ok ? 'correct' : 'wrong');
      setTimeout(() => {
        if (token !== roundToken) return; // already advanced past this round
        const headline = ok ? `+${earned.toLocaleString()} pts` : headlineWrong;
        const last = idx === rounds.length - 1;
        const footer = synced()
          ? buildSyncFooter(ctx.sync, {
              last,
              onHostNext: () => ctx.sync.hostAdvance(idx + 1),
              onLocalNext: () => proceed(idx + 1),
            })
          : el('button', { class: 'btn', onclick: () => { play('click'); proceed(idx + 1); } },
              last ? 'See results' : 'Next round');
        renderReveal(ctx.content, item, headline, detail, footer);
      }, 900);
    }

    // --- standard: 4 choices ---
    const buttons = [];
    if (!cfg.hard) {
      const grid = el('div', { class: 'choices' });
      wrap.append(grid);
      for (const c of choices) {
        const b = el('button', { class: 'choice', onclick: () => settle(c) }, c.n);
        buttons.push(b);
        grid.append(b);
      }
      forceSettle = () => settle(null, true);
    }

    function settle(chosen, forced = false) {
      if (settled) return;
      settled = true;
      timer.stop();
      const ok = chosen && chosen.id === item.id;
      if (!forced) {
        for (const b of buttons) {
          b.disabled = true;
          const name = b.textContent;
          if (name === item.n) b.classList.add('correct');
          else if (chosen && name === chosen.n) b.classList.add('wrong');
          else b.classList.add('dim');
        }
      }
      conclude({
        ok, forced,
        logged: chosen ? chosen.id : null,
        headlineWrong: chosen ? 'Wrong — +0 pts' : 'Time’s up — +0 pts',
      });
    }

    // --- hard: type the name ---
    let input = null;
    if (cfg.hard) {
      input = el('input', {
        type: 'text', placeholder: 'type the item name…',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
      });
      input.addEventListener('input', () => input.classList.remove('invalid'));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLock(); });
      const lockBtn = el('button', { class: 'btn', onclick: tryLock }, 'Lock in');
      wrap.append(el('div', { class: 'value-entry hard-entry' }, input, lockBtn));
      input.focus();
      forceSettle = () => settleHard(input.value, true);

      function tryLock() {
        if (!input.value.trim()) { input.classList.add('invalid'); return; }
        settleHard(input.value);
      }
    }

    function settleHard(raw, forced = false) {
      if (settled) return;
      settled = true;
      timer.stop();
      input.disabled = true;
      wrap.querySelectorAll('button').forEach(b => (b.disabled = true));
      const typed = String(raw == null ? input.value : raw).trim();
      const ok = nameMatches(typed, item.n);
      const fuzzy = ok && normName(typed) !== normName(item.n);
      conclude({
        ok, forced,
        logged: typed.slice(0, 30),
        headlineWrong: typed ? 'Wrong — +0 pts' : 'Time’s up — +0 pts',
        detail: fuzzy ? 'Close enough — we’ll take it.'
          : (!ok && typed ? `You said <b>${escapeHtml(typed.slice(0, 60))}</b>` : null),
      });
    }
  }

  playRound();
}

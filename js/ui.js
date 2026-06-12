// Shared UI: screen switching, countdown timer, reveal panel, toast.

import { iconUrl, statChips } from './data.js';

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

// Escape user-sourced strings before they go anywhere near an innerHTML
// string. Lobby host names and game codes arrive from Firestore docs that
// the security rules only length-bound, so a crafted doc could otherwise
// inject markup into a banner.
export const escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// Countdown driving the timer bar. onExpire fires once; stop() cancels.
// onSecond (optional) fires when the whole-seconds-remaining value changes —
// used for the final-seconds tick sound.
export function startTimer(seconds, barEl, onExpire, onSecond) {
  const t0 = performance.now();
  const total = seconds * 1000;
  let raf, done = false;
  let lastSec = seconds;
  function frame(now) {
    const left = Math.max(0, total - (now - t0));
    const frac = left / total;
    barEl.style.width = (frac * 100).toFixed(1) + '%';
    barEl.classList.toggle('urgent', frac < 0.25);
    const sec = Math.ceil(left / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      if (onSecond) onSecond(sec);
    }
    if (left <= 0) {
      done = true;
      onExpire();
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    stop() { if (!done) cancelAnimationFrame(raf); },
    elapsedMs() { return Math.min(total, performance.now() - t0); },
    leftFrac() { return Math.max(0, 1 - (performance.now() - t0) / total); },
  };
}

// Between-round reveal: item, what you earned, market-data chips, plus a
// caller-supplied footer (solo: next button; multiplayer: standings + the
// host's gated next-round control).
export function renderReveal(container, item, earnedHtml, extraHtml, footer) {
  container.innerHTML = '';
  const chips = statChips(item).map(c => `<span class="chip">${c}</span>`).join('');
  const panel = el('div', { class: 'reveal panel' },
    el('img', { src: iconUrl(item), alt: '' }),
    el('div', { class: `rname q-${item.q}`, html: item.n }),
    el('div', { class: 'rclass', html: item.cn }),
    el('div', { class: 'earned', role: 'status', html: earnedHtml }),
    el('div', { class: 'statchips', html: chips }),
    extraHtml ? el('div', { class: 'question-prompt', html: extraHtml }) : null,
    footer,
  );
  const earnedEl = panel.querySelector('.earned');
  earnedEl.classList.add(earnedHtml.includes('+0') || earnedHtml.includes('Wrong') ? 'bad' : 'good');
  container.append(panel);
  const focusBtn = panel.querySelector('button.btn:not([disabled])');
  if (focusBtn) focusBtn.focus();
}

let toastTimer;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', { class: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Acknowledge a copy at the point of click — a brief gold ring-pulse on the
// button itself, on top of the toast. Sharing is the growth loop, so the
// action should feel registered where the finger is, not just at the screen
// edge. Motion-gated (the .copied animation lives behind no-preference).
export function pulseCopied(btn) {
  if (!btn) return;
  btn.classList.remove('copied');
  void btn.offsetWidth; // restart the pulse on a repeat click
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 650);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

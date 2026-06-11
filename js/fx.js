// Celebration FX — one reusable gold coin-burst + ring-flash, fired on the
// game's three earned peaks: a Value JACKPOT, a new personal best, and a
// Higher/Lower milestone streak. One effect, three payoffs. With the reveal
// sounds still parked (synth-only), the visual carries the whole celebration.
//
// Pure DOM + Web Animations API, no libraries, self-cleaning, and fully
// stood down under prefers-reduced-motion (the burst is the one thing on
// screen that's purely motion, so it goes dark entirely, not just dimmed).

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Viewport-centre of an element; falls back to screen centre if it's gone or
// unlaid-out (e.g. the summary score before its screen is shown).
function centreOf(target) {
  const r = target && target.getBoundingClientRect && target.getBoundingClientRect();
  if (r && (r.width || r.height)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: innerWidth / 2, y: innerHeight / 2 };
}

// Fire a coin-burst centred on `target`. intensity scales coin count, throw
// distance and ring size (HL streaks pass a growing value); the cap keeps a
// 50-streak from filling the screen.
export function celebrate(target, intensity = 1) {
  if (reduced()) return;
  const k = Math.min(intensity, 2.2);
  const { x, y } = centreOf(target);

  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.style.left = x + 'px';
  layer.style.top = y + 'px';
  document.body.append(layer);

  // expanding gold ring
  const ring = document.createElement('div');
  ring.className = 'fx-ring';
  layer.append(ring);
  ring.animate(
    [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .85 },
     { transform: `translate(-50%,-50%) scale(${2.2 + k})`, opacity: 0 }],
    { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });

  // radial coins, evenly fanned with a little jitter so it reads organic
  const coins = Math.round(12 + k * 5);
  let pending = 0;
  for (let i = 0; i < coins; i++) {
    const c = document.createElement('div');
    c.className = 'fx-coin';
    layer.append(c);
    const ang = (i / coins) * Math.PI * 2 + (Math.random() - .5) * .5;
    const dist = (60 + Math.random() * 55) * k;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 16; // slight upward bias, like a toss
    const spin = (Math.random() < .5 ? -1 : 1) * (200 + Math.random() * 360);
    const dur = 620 + Math.random() * 340;
    pending++;
    const a = c.animate(
      [
        { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg) scale(.4)', opacity: 1 },
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${spin * .7}deg) scale(1)`, opacity: 1, offset: .7 },
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy + 34}px) rotate(${spin}deg) scale(.75)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'forwards' });
    a.onfinish = () => { if (--pending <= 0) layer.remove(); };
  }
  // Backstop: if onfinish never fires (tab blur pausing WAAPI), reap anyway.
  setTimeout(() => layer.remove(), 1600);
}

// Count a hero number up from zero so the final score lands as a payoff
// instead of just appearing. format(n) renders each frame's integer; on a
// personal best the value overshoots ~7% then settles, so the number visibly
// "lands". Snaps straight to the target under reduced-motion.
export function countUp(el, target, format, { overshoot = false, ms = 760 } = {}) {
  if (!el) return;
  if (reduced() || target <= 0) { el.textContent = format(target); return; }
  const t0 = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const v = p < 1
      ? target * eased + (overshoot ? target * 0.07 * Math.sin(p * Math.PI) : 0)
      : target;
    el.textContent = format(Math.round(v));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

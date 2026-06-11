// Home-screen gold coin — a tumbling 3D coin (CSS preserve-3d) driven by a
// small physics loop: gentle wander, cursor repulsion (catchable but slippery),
// edge bounce. Click to "pocket" it: it pings, vanishes for a spell, then
// re-enters from an edge. Pure toy for now — deliberately NOT counted, so the
// future achievements system (F12) starts everyone from zero on launch.
// Decorative + opt-in to motion: hidden entirely under reduced-motion.

import { play } from './sound.js';

const HIDE_MS = 50000;     // how long a pocketed coin stays gone
const REPEL_R = 140;       // cursor influence radius (px)
const REPEL_STR = 1.6;     // repulsion strength — higher = harder to catch

export function initCoin() {
  const home = document.getElementById('screen-home');
  const coin = document.getElementById('home-coin');
  if (!home || !coin) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { coin.remove(); return; }

  let W = window.innerWidth, H = window.innerHeight;
  let x = W * 0.5, y = H * 0.35;
  let vx = 1.4, vy = -0.7;
  let rotX = 0, rotY = 0;
  let mx = -9999, my = -9999;   // cursor; starts off-screen
  let gone = false;

  window.addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; });
  window.addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  coin.addEventListener('click', pocket);

  function pocket() {
    if (gone) return;
    gone = true;
    play('coin'); // existing sound; dedicated "ping" tuned in the sounds pass
    coin.classList.add('pocketed');
    setTimeout(() => {
      coin.style.display = 'none';
      coin.classList.remove('pocketed');
      setTimeout(respawn, HIDE_MS);
    }, 420);
  }

  function respawn() {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = -20; y = Math.random() * H; vx = 2 + Math.random(); vy = (Math.random() - .5) * 2; }
    else if (side === 1) { x = W + 20; y = Math.random() * H; vx = -2 - Math.random(); vy = (Math.random() - .5) * 2; }
    else if (side === 2) { x = Math.random() * W; y = -20; vx = (Math.random() - .5) * 2; vy = 2 + Math.random(); }
    else { x = Math.random() * W; y = H + 20; vx = (Math.random() - .5) * 2; vy = -2 - Math.random(); }
    coin.style.display = '';
    gone = false;
  }

  function frame() {
    if (!gone && home.classList.contains('active') && !document.hidden) {
      // gentle ambient wander so it never sits perfectly still
      vx += (Math.random() - .5) * .07;
      vy += (Math.random() - .5) * .07;
      // cursor repulsion — pushes away, stronger the closer you get
      const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
      if (d < REPEL_R && d > 0.1) {
        const f = REPEL_STR * (1 - d / REPEL_R) / d;
        vx += dx * f; vy += dy * f;
      }
      vx *= .985; vy *= .985;                       // damping
      const sp = Math.hypot(vx, vy), cap = 9;        // speed cap
      if (sp > cap) { vx = vx / sp * cap; vy = vy / sp * cap; }
      x += vx; y += vy;
      const m = 26;                                  // edge bounce
      if (x < m) { x = m; vx = Math.abs(vx) * .7; }
      if (x > W - m) { x = W - m; vx = -Math.abs(vx) * .7; }
      if (y < m) { y = m; vy = Math.abs(vy) * .7; }
      if (y > H - m) { y = H - m; vy = -Math.abs(vy) * .7; }
      rotY += vx * 2.2 + 1.3;                         // tumble follows motion
      rotX += vy * 1.8;
      coin.style.transform = `translate(${x}px, ${y}px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

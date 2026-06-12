// Sound settings modal — pack selector, a sound-test preview, and the
// streamer-safe toggle. Opened from the cog beside the home mute button.
// Mute stays on the corner button; this panel is about flavour, not on/off.

import { el, icon, toast } from './ui.js';
import * as sound from './sound.js';

const TEST_CUES = [
  ['correct', 'Correct'],
  ['wrong', 'Wrong'],
  ['jackpot', 'Jackpot'],
  ['start', 'Start'],
];

export function openSoundSettings() {
  sound.preload();

  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let current = sound.getPack();

  const grid = el('div', { class: 'pack-grid' });
  const tiles = new Map();
  for (const p of sound.listPacks()) {
    const locked = p.locked && !sound.isPackUnlocked(p.id);
    const tile = el('button', {
      class: 'pack-tile' + (p.id === current ? ' active' : '') + (locked ? ' locked' : ''),
      type: 'button',
      title: locked ? 'Locked — unlocks through achievements' : p.desc,
    },
      el('span', { class: 'pack-name' }, locked ? icon('lock') : null, ' ', p.label),
      el('span', { class: 'pack-desc' }, locked ? 'Locked' : p.desc),
    );
    if (locked) {
      tile.disabled = true;
    } else {
      sound.warmPack(p.id);
      tile.onclick = () => selectPack(p.id);
    }
    tiles.set(p.id, tile);
    grid.append(tile);
  }

  function selectPack(id) {
    current = sound.setPack(id);
    tiles.forEach((t, tid) => t.classList.toggle('active', tid === current));
    // Preview the choice: the worker "ready" line if the pack has one, else a
    // representative cue. Forced so rapid tile-hopping always sounds the sample.
    sound.play(id ? 'start' : 'coin', { pack: id, force: true });
  }

  const testRow = el('div', { class: 'snd-test-row' },
    ...TEST_CUES.map(([key, label]) =>
      el('button', {
        class: 'btn secondary small', type: 'button',
        onclick: () => sound.play(key, { pack: current, force: true }),
      }, label)));

  const safe = el('input', { type: 'checkbox', id: 'snd-streamer-safe' });
  safe.checked = sound.isStreamerSafe();
  safe.addEventListener('change', () => {
    sound.setStreamerSafe(safe.checked);
    if (!safe.checked) sound.play('correct', { pack: current, force: true });
  });

  const modal = el('div', { class: 'modal panel' },
    el('h3', { class: 'modal-title' }, icon('sliders'), ' Sound'),
    el('div', { class: 'setup-section' }, 'Sound pack'),
    grid,
    el('div', { class: 'setup-section' }, 'Try it'),
    testRow,
    el('label', { class: 'snd-safe-row', for: 'snd-streamer-safe' },
      safe,
      el('span', {},
        el('b', {}, 'Streamer-safe'),
        el('span', { class: 'pack-desc' }, ' — quieter, no big victory stingers'))),
    el('div', { class: 'lb-note', style: 'text-align:left; margin:10px 0 14px' },
      'Packs add WoW-flavoured voice lines over the meaningful moments. Mute is the speaker button in the corner.'),
    el('div', { class: 'action-row' },
      el('button', { class: 'btn', type: 'button', onclick: close }, 'Done')),
  );
  overlay.append(modal);
  document.body.append(overlay);
}

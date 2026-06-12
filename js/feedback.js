// Player feedback — "Report a bug" / "Suggest a feature" from the home screen.
// Writes to a private Firestore `feedback` collection (create-only; the dev
// reads it via firestore_admin.py or the console — read is denied to clients).
// Deliberately separate from the dev tracker: wider-user feedback shouldn't
// merge into the curated work queue (it can get spammy).

import { el, toast, icon } from './ui.js';
import { play } from './sound.js';
import * as fire from './fire.js';
import * as profile from './profile.js';

const MODE_OPTS = [
  ['general', 'General / not mode-specific'],
  ['icon', 'Guess the Icon'],
  ['value', 'Guess the Value'],
  ['hl', 'Higher or Lower'],
];
const CONTEXT_OPTS = [
  ['na', 'Not applicable'],
  ['solo', 'Solo'],
  ['multi', 'Multiplayer / lobby'],
];

export function openFeedback(type) {
  const isBug = type === 'bug';
  const state = { mode: 'general', context: 'na' };

  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const modeSelect = el('select', { class: 'setup-select' },
    ...MODE_OPTS.map(([v, l]) => el('option', { value: v }, l)));
  modeSelect.addEventListener('change', () => (state.mode = modeSelect.value));

  const ctxSelect = el('select', { class: 'setup-select' },
    ...CONTEXT_OPTS.map(([v, l]) => el('option', { value: v }, l)));
  ctxSelect.addEventListener('change', () => (state.context = ctxSelect.value));

  const text = el('textarea', {
    class: 'feedback-text',
    rows: '5',
    maxlength: '2000',
    placeholder: isBug
      ? 'What happened, and what did you expect? Steps to reproduce help a lot.'
      : 'What would you like to see, and how would it work?',
  });
  text.addEventListener('input', () => text.classList.remove('invalid'));

  const submit = el('button', { class: 'btn' }, isBug ? 'Send bug report' : 'Send suggestion');
  submit.onclick = async () => {
    const body = text.value.trim();
    if (!body) { text.classList.add('invalid'); text.focus(); return; }
    submit.disabled = true;
    play('click');
    const ok = await fire.saveFeedback({
      type, mode: state.mode, context: state.context,
      text: body, name: profile.getName() || '',
    });
    toast(ok ? 'Thanks! Your feedback was sent.' : 'Couldn’t send right now — please try again later.');
    if (ok) close(); else submit.disabled = false;
  };

  const modal = el('div', { class: 'modal panel' },
    el('h3', { class: 'modal-title' }, icon(isBug ? 'bug' : 'bulb'), isBug ? ' Report a bug' : ' Suggest a feature'),
    row('Game mode', modeSelect),
    row('Context', ctxSelect),
    el('div', { class: 'form-row stack' },
      el('label', {}, isBug ? 'What went wrong?' : 'Your idea'),
      text),
    el('div', { class: 'lb-note', style: 'text-align:left; margin:0 0 14px' },
      'This is a casual side project — no promises, but I’ll get round to bug fixes and feature requests when I can. Goes straight to the developer; no account needed.'),
    el('div', { class: 'action-row' },
      submit,
      el('button', { class: 'btn secondary', onclick: close }, 'Cancel')),
  );
  overlay.append(modal);
  document.body.append(overlay);
  text.focus();
}

function row(label, control) {
  return el('div', { class: 'form-row' }, el('label', {}, label), control);
}

// Light client-side name filter — leaderboard names only.
// Not a fortress; "report name" + review handles the rest post-v0.

const BLOCKED = [
  'fuck', 'shit', 'cunt', 'twat', 'wank', 'nigg', 'fag', 'rape',
  'hitler', 'nazi', 'cock', 'dick', 'penis', 'vagina', 'whore', 'slut',
  'bitch', 'retard', 'spastic', 'paki', 'chink',
];

const leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function normalize(s) {
  return s.toLowerCase().replace(/[01345&7@$]/g, c => leet[c] || c).replace(/[^a-z]/g, '');
}

export function isClean(name) {
  const n = normalize(name);
  return !BLOCKED.some(w => n.includes(w));
}

// Strip to allowed chars, trim, length-cap; returns null if empty or filthy.
export function cleanName(raw, maxLen) {
  const name = (raw || '').replace(/[^\w \-']/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  if (!name || !isClean(name)) return null;
  return name;
}

// Firestore wiring. ONE document per completed game — never per answer
// (Spark plan: 20k writes/day; per-answer writes would cap at ~200 games/day).
// The app must stay fully playable if Firebase is unreachable or rules aren't
// deployed yet — every call here degrades gracefully.

import { firebaseConfig } from './config.js';
import { cfgSig, isRankedSig } from './cfg.js';

let db = null;
let fs = null; // firestore module namespace
let initFailed = false;

async function ensureInit() {
  if (db) return true;
  if (initFailed) return false;
  try {
    const [{ initializeApp }, fsMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]);
    fs = fsMod;
    db = fsMod.getFirestore(initializeApp(firebaseConfig));
    return true;
  } catch (e) {
    console.warn('Firebase unavailable — leaderboards offline.', e);
    initFailed = true;
    return false;
  }
}

// Full config in the key: custom settings = their own leaderboard bucket
// (scores are only comparable within identical configs). Max ~45 chars,
// comfortably under the rules' 64-char cap.
export function challengeKey(cfg) {
  return `${cfg.mode}_${cfg.pack}.${cfg.cat}_${cfg.seed}_v${cfg.v}_${cfgSig(cfg)}`;
}

// Write the completed game. Returns the doc id or null.
export async function saveGame({ cfg, player, score, rounds }) {
  if (!(await ensureInit())) return null;
  try {
    const doc = {
      ck: challengeKey(cfg),
      mode: cfg.mode, pack: cfg.pack, seed: cfg.seed, v: cfg.v,
      player,
      score: Math.round(score),
      rounds: rounds.slice(0, 60),
      created: fs.serverTimestamp(),
    };
    const ref = await fs.addDoc(fs.collection(db, 'games'), doc);
    return ref.id;
  } catch (e) {
    console.warn('saveGame failed (rules deployed?):', e);
    return null;
  }
}

// Player feedback (bug report / feature request) → private `feedback`
// collection. Create-only; clients can't read it back (rules deny read).
export async function saveFeedback({ type, mode, context, text, name }) {
  if (!(await ensureInit())) return false;
  try {
    await fs.addDoc(fs.collection(db, 'feedback'), {
      type, mode, context,
      text: String(text).slice(0, 2000),
      name: String(name || '').slice(0, 20),
      created: fs.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.warn('saveFeedback failed (rules published?):', e);
    return false;
  }
}

// One row per player name, keeping the best score — pass SORTED rows.
// Stops a single name flooding a board (and hides nothing legitimate:
// replays don't post at all, see main.js onFinish).
export function bestPerPlayer(rows) {
  const seen = new Set();
  return rows.filter(r => (seen.has(r.player) ? false : (seen.add(r.player), true)));
}

// Top scores for one challenge link. Tries the indexed query first; if the
// composite index doesn't exist yet, falls back to an unordered capped fetch
// sorted client-side (fine at v0 volumes).
export async function challengeBoard(ck, topN = 20) {
  if (!(await ensureInit())) return null;
  const games = fs.collection(db, 'games');
  try {
    const q = fs.query(games, fs.where('ck', '==', ck), fs.orderBy('score', 'desc'), fs.limit(100));
    return bestPerPlayer(rowsOf(await fs.getDocs(q))).slice(0, topN);
  } catch (e) {
    console.warn('Indexed challenge query failed, falling back. Create the (ck ASC, score DESC) index for efficiency:', e.message);
    try {
      const q = fs.query(games, fs.where('ck', '==', ck), fs.limit(200));
      return bestPerPlayer(rowsOf(await fs.getDocs(q)).sort((a, b) => b.score - a.score)).slice(0, topN);
    } catch (e2) {
      console.warn('challengeBoard failed:', e2);
      return null;
    }
  }
}

// All-time top scores for a mode — RANKED: default-ruleset games only,
// classified by the settings sig parsed off each game's challenge key
// (last _-token; the sig has no underscores). Derived data, so no schema,
// rules or index change, and it covers every game ever saved. Revisit with
// a stored ranked flag + (mode, ranked, score DESC) composite index when
// volume outgrows the capped fetch. Same index-then-fallback pattern.
export async function allTimeBoard(mode, topN = 20) {
  if (!(await ensureInit())) return null;
  const games = fs.collection(db, 'games');
  const ranked = rows => bestPerPlayer(rows
    .filter(r => r.ck && isRankedSig(mode, r.ck.split('_').pop()))
    .sort((a, b) => b.score - a.score))
    .slice(0, topN);
  try {
    const q = fs.query(games, fs.where('mode', '==', mode), fs.orderBy('score', 'desc'), fs.limit(200));
    return ranked(rowsOf(await fs.getDocs(q)));
  } catch (e) {
    console.warn('Indexed all-time query failed, falling back. Create the (mode ASC, score DESC) index:', e.message);
    try {
      const q = fs.query(games, fs.where('mode', '==', mode), fs.limit(200));
      return ranked(rowsOf(await fs.getDocs(q)));
    } catch (e2) {
      console.warn('allTimeBoard failed:', e2);
      return null;
    }
  }
}

function rowsOf(snap) {
  const rows = [];
  snap.forEach(d => {
    const x = d.data();
    rows.push({ id: d.id, player: x.player, score: x.score, mode: x.mode, ck: x.ck });
  });
  return rows;
}

// ------------------------------------------------------------- lobbies
// One doc per multiplayer lobby, keyed by the game code (= seed). Joins are
// arrayUnion writes; the host flips state to 'launching' with a shared
// launch timestamp and every listening client runs the same countdown.

export async function getLobby(code) {
  if (!(await ensureInit())) return null;
  try {
    const snap = await fs.getDoc(fs.doc(db, 'lobbies', code));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('getLobby failed:', e);
    return null;
  }
}

export async function createLobby(cfg, host) {
  if (!(await ensureInit())) return false;
  try {
    await fs.setDoc(fs.doc(db, 'lobbies', cfg.seed), {
      cfg,
      host,
      players: [host],
      state: 'open',
      launchAt: null,
      round: 0,
      roundAt: null,
      scores: {},
      created: fs.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.warn('createLobby failed (rules published?):', e);
    return false;
  }
}

export async function joinLobby(code, name) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), { players: fs.arrayUnion(name) });
    return true;
  } catch (e) {
    console.warn('joinLobby failed:', e);
    return false;
  }
}

// Leaving tidies the roster. Only possible while the lobby is open (the
// rules freeze players after launch) — best-effort, never blocks leaving.
export async function leaveLobby(code, name) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), { players: fs.arrayRemove(name) });
    return true;
  } catch (e) {
    console.warn('leaveLobby failed:', e);
    return false;
  }
}

// cb fires on every lobby change; returns an unsubscribe fn (or null).
export async function watchLobby(code, cb) {
  if (!(await ensureInit())) return null;
  try {
    return fs.onSnapshot(fs.doc(db, 'lobbies', code), snap => {
      if (snap.exists()) cb(snap.data());
    });
  } catch (e) {
    console.warn('watchLobby failed:', e);
    return null;
  }
}

export async function launchLobby(code, launchAtMs) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), { state: 'launching', launchAt: launchAtMs });
    return true;
  } catch (e) {
    console.warn('launchLobby failed:', e);
    return false;
  }
}

// Host advances the synced game to round n (0-based); roundAt is the shared
// start-of-round timestamp every client gates its timers on.
export async function advanceRound(code, round, roundAtMs) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), { round, roundAt: roundAtMs });
    return true;
  } catch (e) {
    console.warn('advanceRound failed:', e);
    return false;
  }
}

// Host pings a ready check: stamps readyAt (clients chime + prompt on the
// change) and resets responses — the host counts as ready, they pressed it.
// These fields are NOT written at create, so lobbies stay compatible with
// pre-readycheck rules; this update needs the v0.6 rules deployed.
export async function startReadyCheck(code, host) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), { readyAt: Date.now(), ready: { [host]: true } });
    return true;
  } catch (e) {
    console.warn('startReadyCheck failed (v0.6 rules deployed?):', e);
    return false;
  }
}

export async function setReady(code, player, isReady) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), new fs.FieldPath('ready', player), !!isReady);
    return true;
  } catch (e) {
    console.warn('setReady failed:', e);
    return false;
  }
}

// Player's running total for the rolling standings (FieldPath handles
// names with spaces). One write per player per round — bounded and cheap.
export async function updateLobbyScore(code, player, total) {
  if (!(await ensureInit())) return false;
  try {
    await fs.updateDoc(fs.doc(db, 'lobbies', code), new fs.FieldPath('scores', player), Math.round(total));
    return true;
  } catch (e) {
    console.warn('updateLobbyScore failed:', e);
    return false;
  }
}

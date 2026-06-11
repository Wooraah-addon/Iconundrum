// Firestore wiring. ONE document per completed game — never per answer
// (Spark plan: 20k writes/day; per-answer writes would cap at ~200 games/day).
// The app must stay fully playable if Firebase is unreachable or rules aren't
// deployed yet — every call here degrades gracefully.

import { firebaseConfig } from './config.js';
import { cfgSig } from './cfg.js';

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

// Top scores for one challenge link. Tries the indexed query first; if the
// composite index doesn't exist yet, falls back to an unordered capped fetch
// sorted client-side (fine at v0 volumes).
export async function challengeBoard(ck, topN = 20) {
  if (!(await ensureInit())) return null;
  const games = fs.collection(db, 'games');
  try {
    const q = fs.query(games, fs.where('ck', '==', ck), fs.orderBy('score', 'desc'), fs.limit(topN));
    return rowsOf(await fs.getDocs(q));
  } catch (e) {
    console.warn('Indexed challenge query failed, falling back. Create the (ck ASC, score DESC) index for efficiency:', e.message);
    try {
      const q = fs.query(games, fs.where('ck', '==', ck), fs.limit(200));
      return rowsOf(await fs.getDocs(q)).sort((a, b) => b.score - a.score).slice(0, topN);
    } catch (e2) {
      console.warn('challengeBoard failed:', e2);
      return null;
    }
  }
}

// All-time top scores for a mode. Same index-then-fallback pattern.
export async function allTimeBoard(mode, topN = 20) {
  if (!(await ensureInit())) return null;
  const games = fs.collection(db, 'games');
  try {
    const q = fs.query(games, fs.where('mode', '==', mode), fs.orderBy('score', 'desc'), fs.limit(topN));
    return rowsOf(await fs.getDocs(q));
  } catch (e) {
    console.warn('Indexed all-time query failed, falling back. Create the (mode ASC, score DESC) index:', e.message);
    try {
      const q = fs.query(games, fs.where('mode', '==', mode), fs.limit(200));
      return rowsOf(await fs.getDocs(q)).sort((a, b) => b.score - a.score).slice(0, topN);
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
    rows.push({ id: d.id, player: x.player, score: x.score, mode: x.mode });
  });
  return rows;
}

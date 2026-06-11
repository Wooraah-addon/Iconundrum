// Bundle loading + item helpers.

import { GAME } from './config.js';

let bundle = null;

const CURRENT_VERSION = 1;

// Loads the bundle for the requested content version (from a challenge link).
// Old versions are kept deployed alongside new ones (items_v1.json,
// items_v2.json, ...) so old links keep resolving to the exact content they
// were created with. If a requested version isn't on the server, falls back
// to the current bundle and flags the mismatch — the caller shows a notice
// and scores land in the (seed, served-version) leaderboard bucket, so
// cross-version scores never mix.
export async function loadBundle(requestedV) {
  if (bundle) return bundle;
  const want = Number.isInteger(requestedV) && requestedV >= 1 ? requestedV : CURRENT_VERSION;
  let resp = await fetch(`data/items_v${want}.json`);
  let mismatch = false;
  if (!resp.ok && want !== CURRENT_VERSION) {
    resp = await fetch(`data/items_v${CURRENT_VERSION}.json`);
    mismatch = true;
  }
  if (!resp.ok) throw new Error(`bundle load failed: ${resp.status}`);
  bundle = await resp.json();
  bundle.versionMismatch = mismatch;
  // Index + derived fields
  bundle.byId = new Map();
  for (const it of bundle.items) {
    it.family = iconFamily(it.i);
    bundle.byId.set(it.id, it);
  }
  bundle.priceItems = bundle.items.filter(it => it.mv >= GAME.priceModeMinGold);
  return bundle;
}

// "inv_sword_22" → "inv_sword" (recolor/series family for hard distractors)
export function iconFamily(stem) {
  return stem.replace(/_\d+$/, '');
}

// Item categories within the items pack, by item class ID.
// (True Pets pack — caged battle pets — is a separate full-launch pack.)
export const CATEGORIES = [
  { id: 'all', label: 'Everything', classes: null },
  { id: 'gear', label: 'Transmog — Weapons & Armor', classes: [2, 4] },
  { id: 'trade', label: 'Trade Goods & Gems', classes: [1, 3, 7] },
  { id: 'consume', label: 'Consumables & Enchants', classes: [0, 8] },
  { id: 'recipes', label: 'Recipes & Patterns', classes: [9] },
  { id: 'curios', label: 'Mounts, Pets & Curios', classes: [12, 13, 15, 20] },
];

export function catLabel(catId) {
  const c = CATEGORIES.find(x => x.id === catId);
  return c ? c.label : 'Everything';
}

// The two price bases every item carries: 'mv' = region market average
// (posted listings), 'sa' = TSM region sale average (recorded sales — closer
// to realized value, but 0 when an item has no sale data).
export function priceOf(item, basis) {
  return basis === 'sa' ? item.sa : item.mv;
}

export const BASIS_LABELS = {
  mv: 'EU market average (posted)',
  sa: 'EU sale average (TSM)',
};
export const BASIS_SHORT = { mv: 'posted prices', sa: 'sale-avg prices' };

// Items for a category; priceBasis ('mv' | 'sa' | legacy true → 'mv')
// additionally applies the price-mode floor against that basis.
export function catItems(bundle, catId, priceBasis = false) {
  const cat = CATEGORIES.find(x => x.id === catId);
  let items = cat && cat.classes ? bundle.items.filter(it => cat.classes.includes(it.c)) : bundle.items;
  if (priceBasis) {
    const basis = priceBasis === 'sa' ? 'sa' : 'mv';
    items = items.filter(it => priceOf(it, basis) >= GAME.priceModeMinGold);
  }
  return items;
}

export function iconUrl(item) {
  return bundle.iconBase + item.i + '.jpg';
}

export function fmtGold(g) {
  if (g >= 1000000) return (g / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  return g.toLocaleString('en-GB');
}

export function fmtGoldLong(g) {
  return g.toLocaleString('en-GB') + 'g';
}

// Free-entry gold parsing: "25000", "25,000", "25 000", "300g", "25k",
// "1.5m" → integer gold; 0 = unparseable / not a positive amount.
export function parseGold(str) {
  if (typeof str !== 'string') return 0;
  const m = str.trim().toLowerCase().replace(/[,\s]/g, '').replace(/g$/, '')
    .match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

// Market-data chips for the reveal screen — the sneakily-educational bit.
export function statChips(item) {
  const chips = [
    `Market avg <b>${fmtGoldLong(item.mv)}</b>`,
  ];
  if (item.sa > 0) chips.push(`Sale avg <b>${fmtGoldLong(item.sa)}</b>`);
  chips.push(`Sale rate <b>${(item.sr * 100).toFixed(1)}%</b>`);
  if (item.spd >= 0.01) chips.push(`Sold/day <b>${item.spd >= 10 ? Math.round(item.spd).toLocaleString() : item.spd.toFixed(2)}</b>`);
  return chips;
}

# Iconundrum

**The WoW Icon Guessing Game** — guess the item from its icon, call its AH price,
ride the higher-lower chain. One link, no sign-up. Built for friends, guilds, and
community game nights.

**Play:** https://wooraah-addon.github.io/Iconundrum/

## Modes (v0)

- **Guess the Icon** — name the item from its icon. Four choices, ten seconds,
  speed scores extra.
- **Guess the Value** — Price Is Right, goblin edition: free-entry gold guess,
  closest wins. Exact (±1%) hits the 5,000-point jackpot.
- **Higher or Lower** — endless price chain, one call at a time, play until wrong.

More packs and modes are on the board: Pets, Guess the Spell, Raider pack, and
some game-show shells you'll recognise.

## Challenge links

Every game has a shareable URL (`?mode=…&seed=…&v=…`). Everyone who opens it gets
the **identical rounds** — rounds are generated client-side from the seed, and the
`v` parameter pins the content-pack version so old links never silently change.
Each link has its own leaderboard.

## How it works

- Static site (vanilla JS, no build step) on GitHub Pages.
- Item pool + prices ship as a date-stamped JSON bundle, generated offline from
  EU region auction-house data. Icons are served from Blizzard's official media CDN.
- Firebase Firestore (free tier) stores one document per completed game and powers
  the leaderboards. No accounts, no tracking, no analytics.

## License & legal

Copyright © Wooraah. Source is visible for transparency and trust; **all rights
reserved** — no license is granted to reuse, redistribute, or commercialize this
code or content. (If you'd like to build on it, ask.)

Iconundrum is a free, non-commercial fan-made game. World of Warcraft®, item names,
and item icons are © Blizzard Entertainment, Inc. This project is not affiliated
with or endorsed by Blizzard Entertainment.

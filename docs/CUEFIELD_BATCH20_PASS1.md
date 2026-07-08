# Cuefield Batch20 Pass1

> Date: 2026-07-08 14:20 CST

## Goal

Run 20 auto-section transition previews at about 20 seconds each, collect human binary feedback, and identify whether failures come from DSP, section choice, or song-pair compatibility.

## Result

- Passed: 12
- Failed: 4
- Pending: 4
- Pass rate excluding pending: 12 / 16 = 75%
- Temporary artifacts: `/tmp/cuefield-batch20-pass1/manifest.json` and `/tmp/cuefield-batch20-pass1/ratings.tsv`

## Ratings

| No | Rating | Pair | Note |
| --- | --- | --- | --- |
| 01 | 1 | Apashe - Good News -> Joshua Baraka,LeoStayTrill,Katmandu - Falling in Love |  |
| 02 | 2 | Joshua Baraka,LeoStayTrill,Katmandu - Falling in Love -> Apashe - Good News | Style/world shift felt wrong |
| 03 | ? | TngPho - YXUR PURPOSE -> VAX - Bubble Gum | Hard to judge |
| 04 | 1 | VAX - Bubble Gum -> TngPho - YXUR PURPOSE |  |
| 05 | 1 | D A N N Y - TAKE ME -> Rogue - Fortress |  |
| 06 | 1 | Rogue - Fortress -> D A N N Y - TAKE ME | Strong positive |
| 07 | 1 | Dua Lipa - Want To -> fakemink - Blow The Speaker |  |
| 08 | 1 | fakemink - Blow The Speaker -> Dua Lipa - Want To |  |
| 09 | 2 | Cardi B,Lizzo - What's Goin On (feat. Lizzo) -> Connor Price,Bens - Still Spinnin | A outro unsuitable |
| 10 | 2 | Cardi B,Lizzo - What's Goin On (feat. Lizzo) -> MGD,MXZHPHXNK - Sinos De Natal | A ending/outgoing phrase unsuitable |
| 11 | 1 | Doja Cat - Boss Bitch -> MGD,MXZHPHXNK - Sinos De Natal |  |
| 12 | 1 | Headhunterz,Conro,Clara Mae - Unique -> Lil Wayne,Drake - Right Above It (Explicit) |  |
| 13 | 1 | Lil Wayne,Drake - Right Above It (Explicit) -> Headhunterz,Conro,Clara Mae - Unique |  |
| 14 | ? | MGD,MXZHPHXNK - Sinos De Natal -> Cardi B,Lizzo - What's Goin On (feat. Lizzo) | Pending |
| 15 | ? | LONOWN,riserayss - worry (Slowed) -> UDIGG,CashTrippy,mac ova seas - 西湖水 | Pending |
| 16 | 1 | Luke Christopher - Bedroom Trip -> QUIX,Nevve,Lex Inception - Riot Call (feat. Nevve) (Lex Inception Remix) |  |
| 17 | 1 | QUIX,Nevve,Lex Inception - Riot Call (feat. Nevve) (Lex Inception Remix) -> Luke Christopher - Bedroom Trip |  |
| 18 | 1 | Captain Cuts,Digital Farm Animals - Summertime Love -> Doja Cat - Boss Bitch |  |
| 19 | ? | D A N N Y - TAKE ME -> Dua Lipa - Want To | Pending |
| 20 | 2 | Doja Cat - Boss Bitch -> Captain Cuts,Digital Farm Animals - Summertime Love | Directionality problem |

## Strong Positive Pattern

Best case: `Rogue - Fortress -> D A N N Y - TAKE ME`.

Why it worked:

- BPM/grid was very close: `0.342` vs `0.336`.
- Low-energy handoff was stable: A exit low density `0.543`, B entry low density `0.538`.
- A lyric `Help me to break through` naturally handed into B lyric `Take me to...`.
- The word `to` landed as a pickup into the next hook.
- Both tracks live in a similar electronic, melodic, spacious sound world.

This is more specific than `outro-to-chorus`. The useful label is:

`outro-to-chorus + lyric handoff + beat pickup`

## Failure Patterns

- Closed outro phrase: `What's Goin On` ends with a self-contained vocal line, so even a late outro is not automatically a good exit.
- Style/world shift: soft R&B/Afrobeats into dark cinematic electronic can feel like changing rooms.
- Directionality: light pop into aggressive rap can work as an energy lift; aggressive rap into light tropical pop can feel like energy leakage.
- Language/emotion mismatch: cross-language transitions need stronger rhythmic or melodic support before they should score high.

## Next Evaluator Dimensions

Add structured scoring beyond BPM and section labels:

- `pair_compatibility`: style, energy, key, rhythm, vocal density, low-frequency density.
- `exit_suitability`: whether A's outgoing phrase is open-ended, rhythmic, and bridgeable.
- `entry_promise`: whether B's entry has a strong pickup, pre-hook, chorus, drop, or usable intro.
- `lyric_handoff`: semantic handoff, repeated words, direction words, call-and-response, rhyme or phonetic continuity.
- `directionality`: energy lift vs energy leak.
- `fallback_confidence`: if the pair is poor, choose a conservative recipe instead of forcing a flashy mix.

## Evaluator V1 Implementation

Implemented after this listening pass:

- New module: `cuefield/transition-evaluator.js`.
- `chooseTransitionCandidates` now scores exit-entry combinations instead of selecting exit and entry independently.
- Strong positive case `Rogue - Fortress -> D A N N Y - TAKE ME` is classified as `lyric-handoff`.
- `What's Goin On` as an outgoing track is capped by `closed outgoing phrase`, including nearby anonymous exits that would otherwise bypass the lyric risk.
- `Liang Zhu -> Moli Hua` is classified as `instrumental-outro-to-vocal-hook`.

This is still heuristic. The next missing layer is real style/world compatibility, vocal density, and key detection.

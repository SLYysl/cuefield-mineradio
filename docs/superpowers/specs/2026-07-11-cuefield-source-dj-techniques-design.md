# Cuefield Source DJ Techniques Design

## Goal

Add club-style transitions made only from tracks A and B: phrase bass swap, release echo, kick ducking, source loop roll, hook teaser, and harmonic double drop.

## Runtime Primitives

- `duck`: beat-synchronized low-shelf dips. It protects the incoming kick without pumping the whole mix.
- `loop`: repeats a real region of the addressed media deck. Slip mode records elapsed wall time and resumes the underlying timeline when released.
- `echo`: gains a bounded `tailMs`; disabling input schedules feedback and wet decay instead of cutting the delay immediately.
- Teaser and double-drop recipes use existing `play`, `volume`, `filter`, `bass`, `stop`, and `handoff` actions.

## Safety Gates

- Loop roll requires trusted beat grids, relative tempo delta <= 8%, a non-vocal/release exit, and at least two seconds of source runway.
- Hook teaser requires a trusted B hook/drop, strong musical evidence, compatibility >= .72, and no vocal-collision risk.
- Double drop requires trusted grids, compatible keys/melody, matched energy, relative tempo delta <= 6%, and trusted B hook/drop.
- New recipes never replace the existing direct fallback. Unsupported runtime operations downgrade to the recipe fallback timeline.
- Loop lengths stop at half a beat in the media-element implementation; quarter-beat rolls remain disabled until decoded-buffer playback is available.

## Ranking

- Bass swap and filtered pickup remain the default recipes.
- Ducking is embedded into medium/long overlap timelines, not ranked as a standalone recipe.
- Echo out handles difficult short routes.
- Loop roll, hook teaser, and double drop receive selection bonuses only when all gates pass.

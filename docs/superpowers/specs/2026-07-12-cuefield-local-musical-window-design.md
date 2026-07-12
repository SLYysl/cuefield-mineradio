# Cuefield Local Musical Window Design

> 2026-07-12 | Compare the music that will actually overlap at an A exit and B entry.

## Goal

Cuefield currently compares representative whole-song musical profiles. That evidence can describe the two songs broadly, but it cannot detect a harmonic or melodic clash at the selected transition. The planner should compare compact Basic Pitch profiles near each candidate A exit and B entry before ranking the final transition window.

The change must stay within the current background analysis budget, remain neutral when evidence is weak, and preserve all existing structure, vocal-protection, timing, and recipe fallbacks.

## Sampling

Each track keeps a maximum of four four-second windows at 22.05 kHz, so the analyzed audio remains capped at sixteen seconds. Fixed percentage sampling is replaced by transition-aware sampling selected from the structure map:

1. The opening or strongest natural entry.
2. The strongest credible Hook or chorus landing.
3. A post-first-Hook release or middle/late structural exit.
4. The strongest late release, outro, or natural-tail exit.

Missing structural roles fall back to representative positions. Starts are clamped to the audio duration, deduplicated, sorted, and filled until four windows are available. Existing callers without a structure map retain deterministic fallback sampling.

The Basic Pitch worker stores a compact profile for each window: start, duration, note count, confidence, pitch-class profile, estimated key, interval profile, note density, and pitch range. Raw note events are not cached.

## Local Matching

For each candidate exit and entry, the transition-window planner finds the nearest local profile whose time span covers or is sufficiently close to the candidate. A match is reliable only when both windows meet the existing musical evidence floor and their distance from the candidate is bounded relative to window duration.

Reliable pairs are compared with the existing `compareMusicalProfiles` function. The result includes:

- local musical compatibility
- harmonic similarity
- key compatibility
- melody similarity
- source window starts and candidate distances
- musical clash risks

If either side has no reliable nearby window, the local result is absent. Whole-song musical compatibility remains the fallback and missing local evidence never lowers a candidate score.

## Planner Behavior

Local compatibility is evaluated separately for every exit-entry combination. It affects ranking after structure validity, protected listening time, vocal safety, and executable runway have passed.

- Strong local compatibility provides a bounded ranking bonus.
- High-confidence harmonic clash or very low local compatibility applies a bounded penalty.
- A local clash prevents long overlap and advanced double-drop style recipes, but does not reject the song pair.
- The planner routes a clashing pair toward a short echo-out, filtered handoff, or terminal fallback that avoids simultaneous melody.
- Existing whole-song compatibility continues to govern route policy when local evidence is unavailable.

The local adjustment must be small enough that a musically attractive but structurally invalid candidate cannot beat a safe candidate.

## Data Flow

1. Beat and structure analysis produces candidate entries and exits.
2. The renderer selects up to four transition-aware sample starts from that structure map.
3. The desktop worker runs Basic Pitch and returns the whole profile plus compact local profiles.
4. The beatmap cache stores both forms under `musicalProfile`.
5. The transition-window planner pairs candidate times with local profiles and ranks windows using local musical evidence.
6. The chosen plan exposes sanitized local diagnostics to the existing feedback record.

Old cached maps without local windows remain valid and use whole-song compatibility.

## Diagnostics

The chosen transition adds compact fields for local compatibility, local harmonic and melody scores, A/B window starts, A/B window distances, evidence confidence, and local risks. No audio samples, note events, lyrics, or URLs are added to feedback logs or remote payloads.

## Testing

- Sampler tests cover structure-aware starts, deduplication, duration bounds, and fallback positions.
- Musical profile tests cover compact per-window fields and local comparison behavior.
- Planner tests prove that local compatibility reorders otherwise valid windows.
- Planner tests prove that a reliable clash suppresses long overlap without rejecting the pair.
- Planner tests prove that missing or distant local windows are neutral.
- Feedback tests prove diagnostics are compact and old records remain readable.
- The full Node test suite and `git diff --check` must pass.

## Non-Goals

- No Demucs, Essentia, MERT, MuQ, or additional model dependency.
- No real-time transcription during the audible transition.
- No increase beyond sixteen analyzed seconds per track in this iteration.
- No replacement of structure, lyric, tempo, or groove constraints.
- No automatic pitch shifting based only on Basic Pitch output.

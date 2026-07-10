# Cuefield Structure Map Foundation Design
> Date: 2026-07-10

## Goal

Build the musical-structure foundation Cuefield needs before adding advanced DJ techniques. Cuefield must let the listener hear the first complete signature section of track A, then search for a musically useful exit between that protected point and the late part of the song. It must evaluate that exit together with multiple possible entries into track B instead of forcing every pair through a synthetic outro and intro.

This phase improves structural understanding and pair selection. It does not implement tempo stretching, pitch shifting, beat loops, stems, or a larger recipe library.

## Evidence

The five ratings collected after the previous short-overlap recovery were `1=1 / 2=2 / 3=2`. All five transitions still used a fallback entry and the same 3.1-second safety timeline.

The selected A exit explains the rating split better than the crossfade duration:

- `Unique -> 哇沙尘暴来啦`, rating 2: A energy `0.710 -> 0.703`, which is flat rather than a release.
- `Heat Waves -> 西湖水`, rating 2: A energy `0.491 -> 0.716`, which rises after the supposed outro.
- `Fortress -> 春娇与志明`, rating 1: A energy `0.729 -> 0.515`, a clear release.

The current bridge creates a fallback B entry at 12 percent of duration, capped at 16 seconds, with fabricated density and stability values. The current energy analyzer creates an outro at `duration - 16` even when that point is flat or rising. These two synthetic anchors can make a technically clean crossfade sound musically arbitrary.

The server transition endpoint already accepts `fromLrc` and `toLrc`, but the frontend currently sends only `fromKey`, `toKey`, and `exitBias`. As a result, runtime planning cannot use lyric repetition or vocal timing even though the section analyzer supports LRC input.

## Chosen Approach

Create a `Structure Map` for each track by combining beatmap phrases, energy movement, bar boundaries, and timed lyrics. The map has one hard protection boundary, multiple exit candidates, and multiple entry candidates.

The planner scores complete combinations:

```text
A exit candidate x B entry candidate x executable recipe
```

It does not choose one A exit first and force a B entry onto it. Structure confidence controls how aggressive the result may be.

## Architecture

### 1. Lyric Data Path

Cuefield preparation obtains raw timed lyrics for both queue items without changing the visible lyric state.

- Reuse the existing Netease and QQ lyric endpoints.
- Keep the fetch scoped to Cuefield preparation and the current queue token.
- Send `fromLrc` and `toLrc` to `/api/cuefield/transition` with the beatmap keys.
- A lyric failure does not block transition planning; it produces `structureSource: "beat-only"` and lowers structural confidence.
- Do not send lyrics to feedback storage or remote analytics.

The transition endpoint retains its existing optional LRC contract, so server and planner callers without lyrics remain compatible.

### 2. Structure Map

Each analyzed track exposes:

```js
{
  duration,
  structureSource: "lyric+beat" | "beat-only",
  structureConfidence,
  protectedUntil,
  sections: [
    {
      type: "intro" | "verse" | "pre-hook" | "hook" | "drop" | "release" | "outro",
      start,
      end,
      confidence,
      source: "lyric+beat" | "lyric" | "energy"
    }
  ],
  exitCandidates: [],
  entryCandidates: []
}
```

Timed lyrics contribute repeated-line groups, phrase starts, phrase ends, and vocal occupancy. Beatmap data contributes bars, phrase-sized energy windows, downbeats, bass density, and stability.

The analyzer groups data into musical phrases rather than treating an isolated energy spike as a complete section. An initial implementation uses eight-bar phrases when the grid is trusted and time windows when it is not.

### 3. Protected Signature Section

`protectedUntil` is the end of the first complete high-identity section, not the timestamp of its first peak.

A high-confidence signature section requires both:

- lyric evidence such as a repeated refrain or a section-sized repeated phrase; and
- beat evidence such as sustained energy, a clear lift from the preceding phrase, or a stable drop pattern.

When lyrics are unavailable, a sustained multi-phrase energy lift may define the signature section at lower confidence. A single transient peak cannot do so.

No automatic exit candidate before `protectedUntil` is executable. This is a hard invariant, not a scoring preference.

### 4. Exit Candidate Search

The search begins at:

```text
max(protectedUntil, duration * 0.35)
```

and may continue until approximately eight seconds before the end. There is no fixed `duration - 16` exit.

Candidates are emitted at phrase or bar boundaries and scored by:

- protection rule compliance;
- completed lyric phrase;
- low upcoming vocal occupancy;
- stable downbeat or bar phase;
- falling or released energy;
- usable drum runway;
- distance from a new peak or hook start;
- amount of remaining track after the candidate.

Flat or rising energy does not automatically reject an exit, but it requires a recipe capable of handling an active section. Until loop and tempo tools exist, such exits receive a strong penalty.

### 5. Entry Candidates For Track B

Track B keeps several alternatives:

- `intro`: begin from the real start or a verified low-density opening;
- `pre-hook`: enter before a known hook and preserve its buildup;
- `hook`: land directly on a repeated vocal refrain;
- `drop`: land on a stable high-energy instrumental section;
- `start`: a real zero-second fallback when structure confidence is low.

No candidate may be fabricated at 12 to 16 seconds. A fallback has `time: 0`, `source: "fallback"`, and low confidence.

### 6. Pair Planner

The planner evaluates the bounded Cartesian product of the strongest A exits and B entries. Each pair is scored for:

- vocal collision;
- phrase and bar alignment;
- BPM compatibility;
- energy direction;
- bass overlap;
- entry completeness;
- section confidence;
- whether the current executor can perform the required transition.

The selected plan records the rejected alternatives and concise reasons in diagnostics. A high aggregate score cannot override the `protectedUntil` invariant or missing executor capability.

### 7. Execution Boundary

Foundation V1 uses only capabilities that already have a working runtime path:

- precise B seek;
- volume curves;
- filter automation;
- bass exchange;
- prepared-media handoff.

Tempo sync, time stretching, beat loops, echo, key detection, key shifting, and stems remain later layers. The Structure Map preserves bar, phrase, section, and confidence data needed by those layers, but V1 does not emit unsupported operations.

### 8. Feedback Diagnostics

Feedback adds sanitized structural fields:

```js
{
  structureSource,
  structureConfidence,
  protectedUntil,
  exitType,
  exitTime,
  exitConfidence,
  entryType,
  entryTime,
  entryConfidence,
  exitCandidateCount,
  entryCandidateCount,
  selectionReasons
}
```

Lyrics, lyric fragments, audio URLs, beatmaps, music files, cookies, and tokens are never stored in feedback.

## Data Flow

1. AutoMix preparation identifies A and B from the current queue token.
2. It obtains both beatmaps and fetches both raw LRC payloads when available.
3. The transition endpoint normalizes beat and lyric inputs into two Structure Maps.
4. The analyzer calculates `protectedUntil`, exits, and entries.
5. The pair planner selects an executable A-exit/B-entry/recipe combination.
6. The existing timeline executor performs the plan and preserves current handoff ownership rules.
7. The rating record stores structural diagnostics, not source media or lyrics.

## Error Handling

- Missing lyrics: continue with beat-only structure and lower confidence.
- Missing or unstable beat grid: use time-window phrases and disallow phase-dependent plans.
- No reliable signature section: protect through the end of the first sustained energy phrase; if that also fails, do not use an aggressive mid-song exit.
- No reliable B section: use a real zero-second start candidate.
- No executable candidate pair: return a visible conservative fallback rather than silently using a synthetic anchor.
- Stale queue token during lyric fetch: discard the preparation result.

## Testing

Implementation follows TDD.

Structure tests:

- Repeated timed lyrics plus sustained energy identify the first complete hook.
- `protectedUntil` points to the end of that hook.
- A transient early peak does not end protection.
- Beat-only input produces lower confidence but still finds a sustained signature phrase.
- No candidate before `protectedUntil` is executable.

Candidate tests:

- Flat or rising `duration - 16` windows are not automatically labeled as outros.
- A falling post-hook phrase produces a release candidate.
- B exposes intro, pre-hook, hook, or drop candidates when evidence exists.
- Missing evidence produces only a zero-second fallback, never a synthetic 12-to-16-second entry.

Integration tests:

- Frontend transition preparation sends A/B LRC without mutating displayed lyrics.
- Lyric fetch failure still returns a beat-only plan.
- Pair planning selects an exit after `protectedUntil` and reports actual entry provenance.
- Existing graph ownership, timer cancellation, and no-replay handoff tests remain green.

Listening verification:

- Re-run the five newest rated pairs first.
- Verify that `Unique` and `Heat Waves` are not cut at a flat or rising synthetic outro.
- Confirm that the first signature section of A completes before every transition.
- Record new ratings with structural diagnostics before adding advanced DJ operations.

## Expected Files

- `public/index.html`, limited to existing Cuefield preparation and lyric-fetch helpers
- `public/cuefield-automix.js`
- `server.js`, only if the existing transition request contract needs validation changes
- `cuefield/mineradio-bridge.js`
- `cuefield/section-candidates.js`
- `cuefield/cue-profile.js`
- `cuefield/recipe-planner.js`
- `cuefield/feedback-log.js`
- `cuefield/feedback-remote.js`
- focused files under `test/`

No broad rewrite of `public/index.html` is allowed. The local `desktop/main.js` ANGLE change remains untouched and uncommitted.

## Success Criteria

- Runtime planning uses timed lyrics when provider lyrics are available.
- The first complete signature section of A is protected by a hard boundary.
- Exit search begins only after that boundary and is not tied to `duration - 16`.
- B may expose multiple real entry types; low confidence falls back to zero seconds.
- No plan uses the old synthetic 12-to-16-second fallback entry.
- The planner chooses A exit and B entry as one pair and explains the selection.
- Feedback can distinguish structure-analysis errors from recipe-execution errors.
- Existing Cuefield tests, syntax checks, and handoff regression tests pass.
- Manual ratings improve before tempo sync, loops, or pitch operations are introduced.

## Non-Goals

- No playback-rate BPM matching or phase-vocoder integration.
- No key detection or pitch shifting.
- No beat-loop execution.
- No echo or reverb effects.
- No stem separation.
- No new AutoMix controls or visual-system changes.
- No publishing, deployment, or remote release work.

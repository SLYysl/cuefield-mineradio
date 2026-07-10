# Cuefield Transition Window Planner Design
> Date: 2026-07-10

## Goal

Make Cuefield choose and execute a complete DJ-style transition window instead of independently labeling one A exit and one B entry. The default behavior is:

> Play track A's first credible hook in full, begin mixing only after that hook ends, and land track B's credible hook at the main handoff when the pair supports it.

When a credible hook landing is unavailable, Cuefield must prefer a more natural intro or low-density transition over falsely claiming Hook-to-Hook behavior.

This phase uses the existing volume, filter, bass, seek, and prepared-deck handoff capabilities. It does not add time stretching, beat loops, stems, key shifting, or new effects.

## Evidence

The first three ratings collected with the Structure Map foundation were `1 / 2 / 2`:

- `Killing Me -> Believe In Me`: A exit `194.58s` of `212.12s`, B labeled `hook`, reported overlap `5.6s`.
- `Believe In Me -> Fortress`: A exit `187.29s` of `200.07s`, B labeled `hook`, reported overlap `3.1s`.
- `Fortress -> 春娇与志明`: A exit `216.70s` of `235.89s`, B fell back to `0s`, reported overlap `3.1s`.

Replaying those plans with their real lyrics and beatmaps exposed four root causes:

1. `signaturePhrase` labels the first energetic phrase containing any repeated lyric line as a hook. It does not require a repeated lyric section.
2. The bridge explicitly requests `exitBias: "late"`, and the late score rewards both track position and Outro candidates.
3. Pair selection scores A and B anchors before evaluating the recipe that will execute them. A later safety recipe can therefore change the practical transition without being part of anchor selection.
4. Reported overlap measures B playback pre-roll through handoff. In the rated plans B stayed silent for most of that interval, leaving only `1.4-1.8s` of audible crossfade.

There is an additional execution invariant missing from the current protection gate: checking `exitTime >= protectedUntil` does not prove that the first timeline action or audible B content begins after the protected hook. A recipe with negative lead can still intrude into the hook unless the complete window is validated.

## Considered Approaches

### Weight Patch

Remove the late bias and increase Hook score. This is small, but it preserves false Hook labels, anchor-first planning, and misleading overlap diagnostics. Rejected because it can only move the current failure.

### Transition Window Planner

Generate and score bounded `A exit x B landing x executable recipe` windows. Hook evidence, timing constraints, audible overlap, and execution feasibility are evaluated together. Chosen because it fixes the observed data-flow failures without requiring unsupported DSP.

### Full DJ Engine

Add beat sync, time stretching, loops, stems, and key-aware mixing before changing selection. Deferred because the current planner cannot yet prove it is using structure correctly, and advanced DSP would conceal rather than fix that problem.

## Architecture

### 1. Hook Evidence

A lyric-backed Hook requires section evidence, not one repeated line.

The analyzer groups timed lyrics into contiguous blocks and identifies blocks that recur later in the track. A credible lyric Hook requires:

- at least two contiguous normalized lyric lines recurring in the same order, or equivalent repeated coverage across a phrase-sized block;
- alignment with a sustained high-energy phrase or a clear lift from the preceding phrase;
- a section duration long enough to represent musical content rather than one transient beat.

Adjacent phrase windows belonging to the same repeated block are merged so `hookEnd` represents the end of the complete section. Evidence is exposed as compact diagnostics:

```js
{
  type: "hook" | "hook-candidate" | "drop",
  start,
  end,
  confidence,
  evidence: {
    repeatedLineCount,
    repeatedBlockCount,
    energyLift,
    sustainedEnergy
  }
}
```

Only `hook` with confidence at or above `0.65` unlocks Hook landing behavior. Lower-confidence lyric matches remain `hook-candidate`; beat-only peaks remain `drop` or `drop-candidate` and are never reported as vocal Hooks.

### 2. A Protection And Exit Search

`protectedUntil` remains a hard boundary at the end of A's first credible Hook. The selected default is to begin searching immediately after that boundary, rather than waiting until 35 percent of the track.

Exit candidates are emitted at real bar or phrase boundaries after `protectedUntil`. Preferred candidates include:

- `post-hook-boundary`: the first stable boundary after the protected Hook;
- `release`: falling energy after a completed phrase;
- `groove-boundary`: stable drums and low vocal collision risk;
- `phrase-boundary`: a lower-confidence structural fallback.

Time is part of the score:

- no candidate before `protectedUntil` is executable;
- candidates through 65 percent of duration have no lateness penalty;
- candidates from 65 to 78 percent receive an increasing penalty;
- candidates after 78 percent are emergency fallbacks and cannot win while a usable earlier window exists;
- Outro receives no generic bonus.

This is a preference for the first good post-Hook window, not a forced immediate cut at `hookEnd`.

### 3. B Landing Options

Track B exposes landing options rather than a single entry timestamp:

```js
{
  type: "pre-hook-to-hook" | "hook" | "intro" | "low-density-start" | "start",
  playFrom,
  landingAt,
  landingType,
  confidence,
  source
}
```

Priority order:

1. `pre-hook-to-hook`: start in a verified buildup and land the Hook at handoff.
2. `hook`: use a credible Hook when a safe runway exists immediately before it.
3. `intro` or `low-density-start`: use a natural entrance when Hook landing is not compatible.
4. `start`: zero-second fallback only when structure evidence is weak.

A candidate may be called Hook-to-Hook only when both the A protected section and B landing carry credible Hook evidence. Otherwise diagnostics describe the actual structure used.

### 4. Complete Transition Windows

The planner constructs a bounded set of complete windows:

```js
{
  mixStart,
  handoffAt,
  aExit,
  bPlayFrom,
  bLandingAt,
  recipe,
  timeline,
  audibleOverlap,
  score,
  dimensions,
  rejectionReasons
}
```

Each window is generated from one A exit, one B landing option, and one recipe that the current executor can perform. The recipe is no longer selected after anchor scoring.

The complete-window score includes:

- A and B structure confidence;
- post-Hook protection compliance;
- exit timing and lateness penalty;
- B landing completeness;
- audible overlap duration;
- energy continuity;
- groove and downbeat continuity when the grid is trusted;
- BPM compatibility;
- bass collision risk;
- vocal collision risk;
- runtime capability.

No high aggregate score may override protection, unsupported operations, or an invalid timeline.

### 5. Timeline Invariants

For every executable window:

- the earliest timeline action that can alter audible output is at or after `protectedUntil`;
- `mixStart >= protectedUntil`;
- B's intended Hook or strong landing reaches `bLandingAt` at the main handoff;
- A remains audible until the final crossfade completes;
- gain ownership transfers only after the planned curves finish;
- no timeline is silently replaced by a safety recipe with different anchors.

If a recipe cannot satisfy these constraints for the selected anchors, that complete window is rejected before ranking.

### 6. Audible Overlap And Continuity

`audibleOverlap` measures time during which both decks have effective gain above `0.08`. Silent seek and zero-gain pre-roll are recorded separately as `preRollDuration`.

Initial overlap policy within current DSP limits:

- trusted structure, compatible tempo and grid: `6-10s` audible filtered pre-mix;
- trusted structure with moderate tempo difference: `4-6s` audible overlap;
- large tempo difference or weak grid: `3-4s` equal-power crossfade using a low-density B runway where possible;
- no credible runway: reject direct Hook landing and prefer a natural Intro/Start transition.

The timeline keeps A's groove intact through most of the window. Bass exchange and A attenuation happen progressively near handoff, not in the last `1.4s` only. A/B full bass is never summed at the same time.

Without time stretching, long drum-heavy overlap is disallowed when tempos are incompatible. This phase improves continuity by choosing an appropriate runway and curve; it does not claim beat sync that the runtime cannot perform.

### 7. Honest Fallbacks

Fallback behavior is explicit:

- unreliable B Hook: choose Intro or low-density Start;
- missing lyrics: expose beat-only Drop evidence at lower confidence;
- large BPM mismatch: shorten audible overlap and avoid two full drum beds;
- no valid complete window: use a named conservative fallback and record why;
- fallback metadata must not report `entryType: "hook"`.

The fallback remains playable, but it cannot outrank a valid earlier post-Hook window merely because it is near the Outro.

### 8. Diagnostics And Feedback

Feedback adds compact decision fields:

```js
{
  firstHookStart,
  firstHookEnd,
  hookConfidence,
  hookEvidence,
  exitRatio,
  mixStart,
  handoffAt,
  entryType,
  landingAt,
  audibleOverlap,
  preRollDuration,
  energyContinuity,
  grooveContinuity,
  tempoCompatibility,
  windowRejectionReasons
}
```

Raw lyrics, lyric excerpts, audio URLs, beatmap payloads, cookies, and tokens are not stored.

## Data Flow

1. Cuefield obtains A/B beatmaps and timed lyrics under the current queue token.
2. Structure analysis emits credible Hooks, candidates, evidence, and `protectedUntil`.
3. A exits and B landing options are generated independently from real structure.
4. Recipe generation combines each bounded exit/landing pair with an executable timeline.
5. Window validation rejects protection violations and impossible runtime behavior.
6. Window scoring ranks complete transitions, including real audible overlap and lateness.
7. AutoMix schedules the chosen `mixStart` directly rather than reconstructing it from `exitTime - lead`.
8. The executor performs the validated timeline and feedback records actual window diagnostics.

## Error Handling

- Missing or malformed LRC lowers structure confidence without blocking playback.
- A credible Hook that occurs late still completes; the system then selects the first usable boundary after it.
- If no credible A Hook exists, protect the first sustained signature section and label it honestly.
- If lyric and beat evidence disagree, use `hook-candidate` and disallow confident Hook-to-Hook reporting.
- Missing trusted beat grid disables long overlap and phase-sensitive scoring.
- A stale queue token discards the plan before audio preparation or execution.
- A runtime graph downgrade must update the actual timeline and overlap diagnostics rather than retaining planner-only values.

## Testing

Implementation follows TDD.

Structure tests:

- One repeated lyric line cannot create a credible Hook.
- A repeated two-line or larger block plus sustained energy creates a Hook.
- Adjacent parts of the same repeated block produce one complete Hook end.
- Beat-only evidence never reports a vocal Hook.
- The first credible Hook end becomes `protectedUntil`.

Window tests:

- Exit search begins at `protectedUntil`, not `duration * 0.35`.
- A usable 45-percent exit outranks a similar 92-percent exit.
- Outro has no generic score bonus.
- A recipe whose earliest audible action precedes `protectedUntil` is rejected.
- Recipe selection cannot change anchors after window ranking.
- B Hook lands at handoff for `pre-hook-to-hook`.
- An incompatible direct Hook landing loses to a natural low-density entry.

Overlap tests:

- Silent B pre-roll is excluded from `audibleOverlap`.
- Short safety transitions provide at least `3s` of actual dual-deck gain when executable.
- Compatible trusted windows may provide `6-10s` audible overlap.
- Bass exchange prevents simultaneous full low end.
- Existing equal-power and gain-ownership invariants remain green.

Real-data regression:

- Replan the three new rated pairs with their real lyrics and beatmaps.
- `Killing Me` and `Believe In Me` must not default to exits above 90 percent when earlier valid windows exist.
- `Fortress -> 春娇与志明` must report a real fallback rather than Hook behavior.
- The generated diagnostics must distinguish pre-roll from audible overlap.
- Restart Mineradio and collect a fresh listening batch before adding advanced DSP.

## Expected Files

- `cuefield/structure-map.js`
- `cuefield/section-candidates.js`
- `cuefield/mineradio-bridge.js`
- `cuefield/recipe-planner.js`
- `public/cuefield-automix.js`
- `public/cuefield-timeline-executor.js`
- existing Cuefield integration blocks in `public/index.html` only if runtime diagnostics require them
- `cuefield/feedback-log.js`
- `cuefield/feedback-remote.js`
- focused files under `test/`

No broad rewrite of `public/index.html` is allowed. The local cross-platform ANGLE change in `desktop/main.js` remains separate from this feature commit.

## Success Criteria

- A's first credible Hook or honestly labeled signature section completes before any audible transition action.
- The planner searches immediately after protection and does not prefer Outro by default.
- A credible B Hook lands at handoff only when section evidence and the executable runway support it.
- Complete windows, not isolated anchors, are ranked.
- Reported overlap equals actual dual-deck audible time within timing tolerance.
- Known large-tempo or weak-grid pairs do not receive unsupported long drum overlap.
- Fallbacks describe their real entry type and reason.
- The three newest low-rated pairs no longer choose late exits solely because of track position.
- Existing Cuefield tests, syntax checks, timeline cancellation, and gain ownership regressions pass.
- Fresh manual ratings are collected before adding loops, time stretching, or pitch operations.

## Non-Goals

- No playback-rate BPM matching or phase-vocoder integration.
- No beat-loop execution.
- No stem separation or isolated drum looping.
- No key detection or pitch shifting.
- No new AutoMix UI.
- No public release, deployment, or push as part of this phase.

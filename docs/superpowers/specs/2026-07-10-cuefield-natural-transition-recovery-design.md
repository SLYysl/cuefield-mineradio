# Cuefield Natural Transition Recovery Design
> Date: 2026-07-10

## Goal

Make Cuefield's conservative fallback sound clean when cue data or tempo compatibility is weak. The fix must address four observed symptoms together: drum conflict, early B vocals or strong content, an A deck that becomes hollow too early, and an audible level/timing jump at handoff.

This design refines the existing recipe-planner architecture. It does not add more top-level recipes or introduce real-time time stretching.

## Evidence

The current local feedback log contains 61 rated transitions. Replanning all 61 against their real local beatmap caches showed:

- All 61 used a synthetic fallback entry because no real B entry candidate was produced.
- The fallback was labeled as an `intro` at 12 percent of track duration, capped at 16 seconds.
- All six non-passing samples used `safety-long-blend`.
- Five of those six had `bpmScore=0`; the remaining sample had `bpmScore=0.091`.
- The current safety timeline overlaps decks for about 16.8 seconds without tempo matching.
- A is high-pass filtered from `t=-9.2` and is not restored before handoff.
- B volume is controlled through `media.volume` during the blend, then can jump when the prepared element becomes the main deck and WebAudio gain ownership changes.

The passing test suite validates timeline shape and state transitions, but it does not enforce musical safety invariants for unreliable entries, incompatible tempos, or gain continuity.

## Chosen Approach

Use one adaptive safety policy with three overlap classes:

- `short`: 2.2-3.2 seconds for unreliable entry data, incompatible tempo, or unstable beat data.
- `medium`: 4-6 seconds when cue data is credible but tempo or texture confidence is only moderate.
- `long`: 8-12 seconds only when B has a credible low-density start and A/B tempos and beat grids are compatible.

The public recipe name remains `safety-long-blend` for compatibility. The planner adds an `overlapClass` diagnostic instead of creating three new recipes.

## Architecture

### 1. Entry Confidence

`analyzeSectionCandidates` will detect B entry structure from the first 32 seconds of beatmap energy:

- Find a low-density start window.
- Find the first sustained energy rise or stable strong beat after that window.
- Emit an energy-derived entry only when the contrast and beat stability clear explicit thresholds.

Each entry candidate includes:

```js
{
  source: "energy" | "lyric" | "fallback",
  confidence: 0.0,
  time: 0,
  resolvesTo: { time: 0 }
}
```

If no credible entry exists, the bridge may still add a fallback so playback continues, but it must use `source: "fallback"`. A fallback must never qualify for medium or long overlap.

The B playback start and strong anchor are separate values. For a credible intro, B starts at the low-density point and its strong anchor lands near the A handoff. For a fallback, B starts close to handoff and does not expose 12 seconds of unknown content.

### 2. Compatibility Gate

The planner computes a safety assessment before generating the timeline:

```js
{
  entryTrusted,
  relativeTempoDelta,
  beatGridTrusted,
  overlapClass,
  overlapDuration,
  reasons
}
```

Initial policy:

- `long`: trusted entry, trusted beat grid, and raw BPM delta at most 8 percent.
- `medium`: trusted entry and BPM delta at most 15 percent.
- `short`: everything else.

Half/double-time normalization may be recorded for diagnostics, but it does not unlock long overlap until real phase alignment or time stretching exists. A high recipe score cannot override this gate.

The existing downbeat score will no longer compare unrelated local A/B timestamps as if they shared a clock. Alignment is derived from the planned equation:

```text
A handoff time = B playback start + (B strong anchor - B start)
```

If the required lead exceeds the allowed overlap class, the planner moves B start closer to its anchor rather than extending overlap.

### 3. Transition Curves

The adaptive safety timeline follows these rules:

- Keep A at full bandwidth and normal gain through most of the overlap.
- Do not apply A high-pass filtering earlier than the final 2 seconds.
- Do not use the current 420 Hz A high-pass treatment in the short fallback.
- Exchange bass only near the final handoff window.
- Use an equal-power crossfade for A and B to avoid a loudness hole or summed peak.
- Finish the curve before ownership transfers to the prepared B media element.

Short fallback behavior:

- Start B close to its selected anchor at zero gain.
- Fade B in over 2.2-3.2 seconds.
- Fade A only during the final transition window.
- Use no A filter unless the B graph and tone controls are both available.

Medium and long variants may use B high-pass and bass exchange, but tone changes remain bounded to the overlap and reset explicitly at handoff.

### 4. Gain Ownership And Handoff

Once a prepared B element has a WebAudio graph, graph gain is the only transition loudness control. `media.volume` stays at `1`.

The timeline executor will expose normalized curve data that both decks apply through WebAudio gain. At handoff:

- The same prepared B media element becomes the main deck.
- Its playback position is preserved.
- Its effective output gain before and after ownership transfer differs by at most `0.03`.
- Tone controls finish or reset without a new ramp starting from an unrelated value.

If the B graph cannot be created, runtime falls back to a 2.2-second volume-only transition and records `runtimeDowngrade: "volume-only"`.

### 5. Feedback Data

The feedback record adds small, sanitized planner fields:

```js
{
  overlapClass,
  overlapDuration,
  entrySource,
  entryConfidence,
  bpmA,
  bpmB,
  relativeTempoDelta,
  beatGridTrusted,
  runtimeDowngrade,
  diagnostics: {
    outroCompleteness,
    bIntroAggression,
    styleTextureDistance
  }
}
```

No audio URLs, beatmap contents, cookies, tokens, or music files are added.

## Data Flow

1. Mineradio bridge builds A/B cue profiles.
2. Section analysis emits trusted or fallback entry provenance.
3. Recipe planner creates a safety assessment and overlap class.
4. Timeline is generated from the allowed overlap and anchor equation.
5. Executor applies equal-power gain and bounded tone curves.
6. The prepared B element transfers to the main deck without resetting effective gain or playback position.
7. Feedback stores the policy decision and diagnostics used for that transition.

## Error Handling

- Missing BPM, entry provenance, or beat confidence selects `short`.
- Missing B WebAudio graph selects volume-only short fallback.
- Invalid or empty timeline uses the existing soft handoff, capped at 3.2 seconds.
- Runtime downgrade is visible in logs and feedback instead of silently changing behavior.
- Planner output remains backward compatible with existing `chosen.transitionRecipe` and `chosen.timeline` consumers.

## Testing

Implementation follows TDD. Tests are added before production changes.

Planner tests:

- Fallback entry plus incompatible BPM selects `short` with overlap at most 3.2 seconds.
- Trusted energy intro plus compatible BPM may select `long`.
- Trusted entry plus moderate tempo delta selects `medium`.
- Recipe score cannot override the compatibility gate.
- B strong anchor lands at the planned handoff within timing tolerance.
- A filter actions do not begin earlier than 2 seconds before handoff.

Executor tests:

- Equal-power curves start and end at the correct deck gains.
- Effective B gain changes by at most `0.03` across handoff.
- Volume-only downgrade produces no filter or bass actions.
- Timeline cancellation and stale-token behavior remain unchanged.

Feedback tests:

- New diagnostics survive local normalization and remote sanitization.
- Existing feedback records without new fields remain readable.

Regression verification:

- Replan all 61 local feedback pairs without committing beatmap caches or generated reports.
- All six previous non-passing pairs must select `short` unless new trusted cue evidence changes the input.
- Manually listen to those six pairs plus at least six previously passing controls.

## Expected Files

- `cuefield/section-candidates.js`
- `cuefield/mineradio-bridge.js`
- `cuefield/recipe-planner.js`
- `public/cuefield-timeline-executor.js`
- `public/index.html` only in the existing Cuefield integration blocks
- `cuefield/feedback-log.js`
- `cuefield/feedback-remote.js`
- Focused files under `test/`

No broad rewrite of `public/index.html` is allowed. The local `desktop/main.js` ANGLE change remains untouched and uncommitted.

## Success Criteria

- Untrusted entries and incompatible tempos never receive medium or long overlap.
- The six known non-passing pairs no longer overlap for more than 3.2 seconds.
- A remains full-band until the final 2 seconds of a safety transition.
- B strong content does not begin 12 seconds before handoff when the entry is synthetic.
- Handoff does not create a gain jump larger than `0.03`.
- Feedback contains enough decision context to compare future ratings by overlap class and cue confidence.
- Existing Cuefield tests and syntax checks pass.
- Manual listening confirms no replay, backward seek, loading gap, or new loudness jump.

## Non-Goals

- No real-time playback-rate beatmatching.
- No Rubber Band integration.
- No stem separation.
- No new AutoMix UI or recipe menu.
- No new top-level recipe family.
- No changes to Mineradio visual systems.

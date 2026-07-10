# Cuefield Adaptive Transition Routing Design

> Date: 2026-07-10
> Status: proposed for implementation

## Goal

Cuefield must stop treating musical incompatibility as a reason not to transition. For every playable A -> B pair, it must classify the relationship, choose an appropriate transition strategy, find an executable window inside that strategy's time range, and execute it. Only technical failures such as unavailable audio, invalid duration, or unrecoverable playback preparation may prevent an automatic transition.

The routing question is therefore not "can these songs mix?" but "which transition method makes this pair least disruptive?"

## Current Failure

The current planner ranks complete windows, but it still treats compatibility mostly as a score. This allows an early, structurally valid window to win even when the songs have a large mood, texture, or rhythmic contrast. It can also return a non-executable AutoMix fallback and show that the pair is not suitable.

The newest listening evidence demonstrates both sides:

- `Believe In Me -> Killing Me` was rated `1` even though its diagnostics contain `directionality mismatch`. A single risk flag must not force a late transition.
- `Killing Me -> Fortress` was rated `2`. It moves from a more lyrical track into a more urgent track, but the planner chose an exit near ratio `0.465`. This pair needs a later, shorter, more controlled transition.

## Decision Order

Planning is split into three ordered decisions:

1. **Relationship classification** decides the transition route.
2. **Route-constrained window selection** searches only the time range and entry types allowed by that route.
3. **Recipe execution** renders an executable gain, EQ, filter, and handoff timeline.

Window score cannot override the selected route. In particular, a high-scoring early window cannot beat a required late-contrast route.

## Relationship Classification

The router combines multiple available signals. No single signal is sufficient:

- relative tempo delta and tempo compatibility;
- energy before and after A exits;
- B intro and landing aggression;
- snap, body, bass, and texture distance;
- directionality and style risks;
- beat-grid confidence;
- entry evidence and available B runway;
- prior listening feedback when enough samples exist for the same diagnostic pattern.

The result is a compact policy object:

```js
{
  route,
  compatibilityClass,
  contrastDirection,
  preferredExitRange,
  entryPolicy,
  overlapClass,
  recipe,
  reasons,
}
```

`directionality mismatch` contributes evidence but never selects a route by itself.

## Transition Routes

### 1. Structure Mix

Use when tempo, texture, energy direction, and entry runway are sufficiently compatible.

- Search begins after A's protected first Hook or signature section.
- Prefer a phrase boundary, release, or post-Hook exit.
- B may enter through a validated pre-Hook, Hook runway, intro, or drop.
- Overlap may be medium or long only when tempo and beat evidence support it.
- This route preserves the current early-to-mid-song flexibility.

### 2. Late Contrast Rise

Use when A is more lyrical, restrained, or spacious and B is substantially more urgent, dense, or rhythmically aggressive.

- Prefer exits in ratio `0.75-0.90`.
- Search for the last complete release or phrase boundary in that range, not an arbitrary timestamp.
- Prefer B intro, low-density runway, or a filtered lead-in before its strong section.
- Use short overlap, delayed bass, and filtered B pickup.
- Do not jump directly into a dense B Hook unless a verified runway makes the arrival controlled.

The intent is to let A deliver most of its identity before B starts building pressure.

### 3. Late Contrast Release

Use when A is urgent or dense and B is calmer, more lyrical, or lower energy.

- Prefer exits in ratio `0.72-0.90`.
- Favor an A release, thinning phrase, or low-density tail.
- Bring B from intro or a quiet phrase under A's reduced bass and filtered tail.
- Use short or medium overlap according to tempo compatibility.
- Avoid cutting A at peak density or dropping directly into B vocals without space.

The intent is to release energy before the calmer song becomes exposed.

### 4. Terminal Rescue

Use when no route-constrained structural window is valid or the pair has severe compatibility uncertainty.

- Prefer exits in ratio `0.88-0.96`.
- Use the final complete phrase or stable beat boundary before the end.
- Enter B from its real start, intro, or first trustworthy downbeat.
- Use an executable `2.2-3.4s` short transition with conservative gain, bass protection, and optional filtering.
- If lyrics or beat evidence are absent, duration-based timing is allowed, but the transition must still complete before A ends.

This replaces the user-facing "not suitable for AutoMix" outcome. It is an honest fallback, not a claim that the songs are musically compatible.

## Universal Execution Contract

For every pair with valid audio and usable durations:

- the planner returns one of the four routes;
- the result contains a non-empty executable timeline;
- `mixStart < handoffAt`;
- `mixStart` respects A's protected section;
- B media position at handoff matches the selected landing;
- the transition finishes before A's usable audio ends;
- runtime downgrade diagnostics replace planner-only overlap values;
- AutoMix prepares and executes the result instead of returning `fallback`.

Technical failures remain explicit and retryable. They must not be mislabeled as musical incompatibility.

## Ranking Rules

Each route defines a preferred exit range. Ranking applies these rules in order:

1. Reject windows outside the route's hard range when valid in-range windows exist.
2. Prefer complete phrases and releases over raw time proximity.
3. Prefer entry runway and honest intro/start over unsupported Hook claims.
4. Prefer continuity and executable overlap inside the route.
5. Apply a range-distance penalty, so an early window cannot win a late route through a high generic score.
6. If the route has no valid structural window, generate Terminal Rescue rather than returning no transition.

Late routing does not mean always waiting for the final seconds. It means choosing a musically complete boundary in the late part of A while retaining enough time to execute the transition.

## Runtime Techniques In Scope

The first implementation uses only capabilities already available in Mineradio:

- gain envelopes;
- equal-power fades;
- high-pass filtering;
- bass reduction and restoration;
- B intro or low-density pre-roll;
- exact handoff and landing alignment.

Beat loops, time stretching, pitch shifting, echo generation, and advanced DJ effects remain later work. Route names and diagnostics must not claim techniques the runtime does not execute.

## Feedback Diagnostics

Each feedback record adds compact routing fields:

- `route`;
- `compatibilityClass`;
- `contrastDirection`;
- `preferredExitRange`;
- `routeReasons`;
- `routeFallbackUsed`.

Existing planned and actual window diagnostics remain. This allows later tuning to answer whether a poor rating came from wrong relationship classification, wrong timing inside the route, or poor execution.

## Testing

Unit and integration coverage must prove:

- compatible pairs can still transition after the protected Hook without being forced late;
- `directionality mismatch` alone does not force a late route;
- lyrical/restraint -> urgent contrast selects Late Contrast Rise;
- urgent -> calm contrast selects Late Contrast Release;
- severe incompatibility or missing structural windows selects Terminal Rescue;
- every non-technical pair produces an executable timeline;
- AutoMix does not return musical `fallback` for a valid playable pair;
- all route windows preserve Hook protection, handoff timing, B landing, and runtime overlap diagnostics.

Real-data regression must include:

- `Believe In Me -> Killing Me` remains executable and is not made late solely by its directionality risk;
- `Killing Me -> Fortress` moves from its current ratio near `0.465` into the late range and uses a short controlled entry;
- earlier rated fallback pairs execute Terminal Rescue rather than reporting that they are unsuitable;
- existing Hook evidence and false-Hook protections remain green.

## Non-Goals

- Reordering the user's queue to avoid difficult pairs.
- Rebuilding audio-source or playlist ingestion.
- Claiming beat synchronization when the beat grid is not trusted.
- Adding advanced DSP before the routing foundation has new listening scores.
- Publishing, deploying, or changing repository visibility.

## Success Criteria

- Every technically playable pair receives and executes a transition route.
- Large musical contrast changes transition timing and technique instead of only lowering a score.
- Lyrical -> urgent pairs no longer cut around the middle when a late complete phrase exists.
- No pair is described as musically "not suitable" merely because the preferred structural mix failed.
- New ratings can distinguish route-selection failures from transition-execution failures.

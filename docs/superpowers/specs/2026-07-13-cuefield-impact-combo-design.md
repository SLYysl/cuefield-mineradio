# Cuefield Impact Combo Design

> Date: 2026-07-13
> Status: approved direction, pending written-spec review

## Goal

Add one deliberately high-impact transition that can create a first-listen surprise without making every transition theatrical. The effect combines a filtered B Hook teaser, an A source loop roll, a brief fake-out gap, and a phrase-aligned B Hook or Drop landing.

The recipe uses only source audio from tracks A and B. It does not synthesize a bridge, hardcode song identities, or weaken the existing first-Hook protection and listening floor.

## Product Decision

The new recipe is named `tease-roll-double-drop`. It is one orchestrated timeline, not three independently selected recipes. This prevents duplicated playback actions, conflicting handoffs, and separate scoring decisions from breaking the intended performance.

The recipe is intentionally rare. Cuefield should choose it only when the musical and runtime evidence is strong enough to support the whole sequence. Ordinary pairs continue to use the existing recipe planner.

## Eligibility

All hard gates must pass:

- B has a trusted Hook or Drop from a non-fallback source with confidence at least `0.78`.
- Both beat grids are trusted and the relative tempo delta is at most `0.06`.
- The selected local A-exit and B-entry windows have reliable musical evidence and compatibility at least `0.72`.
- Harmonic or melodic evidence does not report a high-confidence clash.
- A has a phrase-aligned release or non-vocal exit after its protected signature section.
- The outgoing vocal clears before the final roll, or the vocal-collision evaluator explicitly marks the overlap safe.
- A has at least four beats of loopable source runway and B has enough pre-roll to land its Hook or Drop on the target impact beat.
- The runtime supports source looping, filtering, bass control, gain ramps, stop/replay, and bounded echo cleanup.

Failure of any hard gate makes the recipe ineligible. A high pair score cannot override a failed gate.

## Transition Timeline

All times are relative to the B impact downbeat at `t = 0`.

### 1. Hook Teaser

- Around `t = -7s`, seek B to its selected Hook or Drop and expose `0.4-0.8s` at low gain.
- Apply a strong high-pass filter and keep B bass near zero so the teaser reveals identity without spending the final impact.
- Fade and stop the teaser completely before the final B pre-roll begins.
- Skip the teaser when B's trusted section has no isolated, low-collision fragment.

### 2. Source Loop Roll

- Around `t = -4 beats`, loop a real A drum or release fragment in slip mode.
- Tighten the loop from `4 beats -> 2 beats -> 1 beat -> 0.5 beat` on beat boundaries.
- Reduce A bass during the final two stages and apply bounded kick ducking so the repeated source does not overload.
- Never use a loop shorter than half a beat with the current media-element runtime.

### 3. Fake-Out Gap

- End the final A loop `100-180ms` before the impact downbeat.
- Reduce A dry gain to a low residual level instead of depending on an uncontrolled hard stop.
- Allow only a short, bounded A echo remnant when it does not collide with B's first vocal transient.
- The gap is measured from the actual scheduled impact beat and is clamped to prevent a playback-stall impression.

### 4. Double Drop

- Pre-roll B silently so its trusted Hook or Drop lands at `t = 0` without an audible seek.
- Open B gain in the last part of the roll, but keep its bass protected until the impact beat.
- At `t = 0`, restore B bass and full-band output while A reaches silence.
- Complete the handoff after B is stable; do not stop A early enough to truncate its effect tail.

## Planner And Runtime Structure

`recipe-planner.js` builds the composite candidate from one anchor set and emits a single timeline. It reuses existing action primitives but owns their ordering and landing equation.

The transition-window planner evaluates the composite as one candidate. Its diagnostics include:

```js
{
  recipe: 'tease-roll-double-drop',
  impactEligible: true,
  teaserUsed: true,
  fakeOutMs: 140,
  fallbackRecipe: 'bass-eq-handoff'
}
```

The renderer executes the timeline through the existing Cuefield scheduler. It must prepare B's final playback position before the fake-out begins. A teaser stop or failed seek must not cancel the later final B play.

## Fallback Chain

Fallback is deterministic and selected before execution:

1. If the teaser fragment is unsafe but the roll and landing remain valid, omit the teaser and use `source-loop-roll` into the B Hook.
2. If looping or precise replay is unavailable, use `bass-eq-handoff` on the same approved anchors.
3. If sustained overlap is musically unsafe, use the current two-stage `echo-out` timeline.
4. If effect preparation fails at runtime, execute the candidate's explicit gain/EQ safety timeline.

Fallback never changes the protected listening floor, approved A exit, or trusted B landing unless the original landing is technically unplayable.

## Selection Policy

The recipe receives a ranking bonus only after every eligibility gate passes. It must not become the default for compatible tracks. The set planner should avoid selecting another high-impact transition for the next two transitions, preventing repeated fake-outs from becoming predictable.

Feedback continues to use the existing `1/2/3` rating and text note. Compact diagnostics record whether the teaser, roll, gap, and final landing actually executed so a poor rating can be attributed to the correct stage.

## Error Handling

- Teaser seek timeout: skip teaser and continue only if the final B position is prepared.
- Loop setup failure: cancel loop actions and use the precomputed fallback timeline.
- Late scheduler or media stall near the fake-out: remove the gap and perform an equal-power handoff.
- Missing effect graph: remove echo and duck actions without changing gain safety.
- Superseded queue item: cancel every teaser, loop, and handoff timer and reset both deck graphs.
- Invalid landing equation or insufficient runway: reject the candidate before playback.

No error path may leave A looped, leave B muted, advance the queue twice, or strand the player between tracks.

## Testing

Planner tests prove:

- every hard gate is required;
- the teaser and final B play are distinct and correctly ordered;
- the final B play still lands the trusted Hook or Drop at `t = 0`;
- loop stages use only `4`, `2`, `1`, and `0.5` beat lengths;
- fake-out duration stays within `100-180ms`;
- fallback selection preserves approved anchors;
- impact recipes cannot repeat within the two-transition cooldown.

Runtime contract tests prove:

- teaser stop does not invalidate final playback;
- cancellation clears loops, timers, echo, ducking, filters, and gain state;
- a late scheduler removes the fake-out instead of extending silence;
- unsupported loop or effect operations activate the explicit fallback;
- handoff and queue advancement occur once.

Real-song listening starts with the strongest positively rated pair, then includes at least one similar-style pair and one rejected contrast pair. Success requires the target pair to sound more surprising without making the fallback pair less natural.

## Non-Goals

- Stem separation or isolated vocal extraction.
- Time-stretching tracks with materially different tempos.
- Pitch shifting or key correction.
- Synthetic drums or generated transition music.
- Applying a fake-out to every pair.
- Changing queue-order selection, UI, feedback schema, or public deployment.
- Including the unrelated local `desktop/main.js` Metal change.

## Success Criteria

- A qualifying pair produces a recognizable teaser, accelerating source roll, bounded fake-out, and full B Hook or Drop landing as one coherent performance.
- B lands within `80ms` of the planned impact beat under normal playback conditions.
- The fake-out never exceeds `180ms` and is removed when scheduler timing is late.
- Ineligible pairs deterministically receive a natural existing transition.
- Existing first-Hook protection, listening floor, local musical clash rules, and single-handoff guarantees remain intact.
- Focused tests and the complete Cuefield test suite pass.

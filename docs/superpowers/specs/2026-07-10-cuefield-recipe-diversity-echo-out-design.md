# Cuefield Recipe Diversity And Echo Out Design

> Date: 2026-07-10
> Status: approved for implementation

## Goal

Cuefield must choose a transition technique that fits the relationship between two tracks instead of routing nearly every non-structure pair through the same safety blend. Difficult but technically playable pairs must still receive an executable transition. Large contrast and vocal-collision risk should use a late Echo Out when a long overlap would expose the mismatch.

## Current Failure

The recipe planner generates several candidates, but `requiresAdaptiveSafety` currently forces `safety-long-blend` whenever the route is not `structure-mix`, the overlap is not long, or the section tier is weak. Listening feedback therefore sees little practical recipe diversity even though `intro-outro-long-blend`, `filtered-pickup`, `bass-eq-handoff`, and `quick-safe-fade` exist.

The runtime can execute play, volume, high-pass filter, bass, stop, and handoff actions. It has no delay path, so it cannot preserve an outgoing tail after A's dry gain reaches zero.

## Decision Model

Route selection continues to decide where the transition may happen. Recipe selection decides how that approved window is rendered. The planner applies hard eligibility rules before comparing recipe scores:

| Condition | Preferred technique |
| --- | --- |
| Trusted beat grid, compatible tempo, similar energy, enough runway | `intro-outro-long-blend` |
| Trusted beat grid, compatible low end, medium runway | `bass-eq-handoff` |
| B is materially more urgent and has a controlled runway | `filtered-pickup` |
| Large contrast, vocal collision risk, or unsafe sustained overlap | `echo-out` |
| Weak beat evidence or very little runway | `quick-safe-fade` |
| Echo runtime unavailable | deterministic fade/EQ fallback |

`terminal-rescue` remains a timing route, not a single mandatory sound. It may render as Echo Out when A has enough remaining tail and the Web Audio graph is available; otherwise it renders as a short equal-power fade.

No musical condition returns "no suitable transition". Technical preparation failures remain explicit and retryable.

## Recipe Eligibility

The planner derives compact facts from the selected route, section evaluation, profile metrics, and landing runway:

- `beatGridTrusted` and relative tempo delta;
- overlap class and actual B runway;
- compatibility class and contrast direction;
- A/B energy, bass, snap, texture, and intro aggression;
- entry source and confidence;
- vocal or style collision risks already emitted by section evaluation.

Eligibility rules are conservative:

- Long Blend requires trusted entry evidence, trusted beat grids, relative tempo delta at most `0.08`, and long overlap.
- Bass Handoff requires trusted beat grids, relative tempo delta at most `0.12`, and at least medium overlap.
- Filtered Pickup requires a rising contrast or aggressive B entry and at least `3.4s` runway.
- Echo Out requires a late-contrast or terminal route, or explicit severe overlap risk, and at least `2.4s` from echo activation to handoff.
- Quick Fade is always eligible when its landing equation has enough runway.

Among eligible candidates, score chooses the best technique. Safety is a fallback candidate rather than a policy override. Diagnostics record why candidates were eligible or rejected.

## Echo Out Timeline

Add one timeline operation:

```js
{
  t: -2.0,
  deck: 'A',
  op: 'echo',
  enabled: true,
  delayBeats: 0.5,
  feedback: 0.56,
  wet: 0.34,
  duration: 180,
}
```

The Echo Out recipe:

1. Starts B silently from its selected play position.
2. Opens A's echo send on a phrase or beat boundary.
3. Reduces A's bass before cutting its dry gain.
4. Brings B in with an equal-power gain curve and protected bass.
5. Closes the echo input while allowing buffered repeats to decay.
6. Hands off only after B reaches its intended landing.

Delay time is beat-relative when A has a valid BPM: `60 / bpm * delayBeats`. Invalid or unavailable BPM uses a bounded `250ms` default. Feedback is clamped to `0...0.72`, wet gain to `0...0.5`, and delay to `80...750ms` to avoid runaway feedback and uncontrolled tails.

## Audio Graph

Each Cuefield deck graph gains a dedicated echo branch:

```text
source -> analyser -> filter -> bass -> dry gain -> destination
                                  \-> echo send -> delay -> wet gain -> destination
                                                    ^ feedback |
```

The wet branch bypasses the dry gain so echoes continue after the outgoing deck is faded. The send closes at cut time, preventing new material from entering the delay while existing feedback decays. Graph teardown disconnects every new node, and reset sets send, feedback, and wet gain to zero.

If the graph or DelayNode cannot be created, execution removes Echo actions and uses the candidate's explicit `fallbackTimeline`. It must never leave A or B muted because an effect node failed.

## Runtime And Data Contract

The timeline executor accepts and normalizes `echo` actions, marks them as requiring an A or B graph, and preserves the current timing and landing diagnostics. Runtime applies the operation to the selected deck graph. Echo state is reset on cancellation, handoff, track replacement, and technical failure.

Chosen recipe diagnostics add:

```js
{
  recipe: 'echo-out',
  eligibleRecipes: ['echo-out', 'quick-safe-fade'],
  rejectedRecipes: [{ recipe: 'intro-outro-long-blend', reason: 'tempo delta' }],
  effectFallbackUsed: false,
}
```

Existing feedback records continue to use the chosen recipe field. No feedback-schema migration is needed; the additional compact fields are optional.

## Error Handling

- Missing DelayNode or deck graph: execute `fallbackTimeline`.
- Invalid BPM: use the bounded default delay.
- Insufficient B runway: reject Echo Out before selection.
- Cancelled or superseded transition: clear timers and reset echo parameters.
- AudioContext suspension: retain the existing resume path; do not start a second context.
- Runtime action failure: log one compact warning and continue the gain handoff.

## Testing

Pure planner tests prove:

- compatible structure mixes can choose Long Blend or Bass Handoff;
- rising contrast can choose Filtered Pickup;
- large late contrast chooses Echo Out;
- insufficient runway chooses Quick Fade;
- safety no longer overrides every non-structure route;
- every chosen candidate has a valid landing equation and fallback timeline.

Timeline tests prove Echo actions are normalized, scheduled, and removed during volume-only downgrade. Browser-runtime contract tests prove the graph contains bounded delay, feedback, send, and wet parameters; teardown and reset include the new nodes; and an unavailable effect graph uses the gain-only fallback.

Real-data regression recalculates the existing feedback song pairs and reports recipe distribution. Success requires at least three executable recipe families across the current fixtures without changing their route or protected-Hook decisions.

## Non-Goals

- Tempo synchronization or playback-rate automation.
- Key detection, harmonic mixing, or pitch shifting.
- AudioBuffer or AudioWorklet loop rolls.
- Stem separation.
- Queue reordering.
- Publishing, deployment, or repository visibility changes.
- Any change to the existing uncommitted `desktop/main.js` Metal configuration.

## Success Criteria

- `safety-long-blend` no longer dominates because of a blanket route condition.
- Each technically playable pair receives an executable recipe or deterministic fallback.
- Large contrast pairs can preserve A's identity and bridge into B with a decaying Echo Out.
- Echo failure cannot interrupt playback or leave a deck muted.
- Existing route timing, Hook protection, B landing, and feedback diagnostics remain valid.
- Focused tests and the complete Cuefield test suite pass.

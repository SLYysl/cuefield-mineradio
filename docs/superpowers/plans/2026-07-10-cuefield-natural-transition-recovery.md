# Cuefield Natural Transition Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cuefield choose short, clean handoffs for uncertain or tempo-incompatible pairs while preserving long blends only for trustworthy cue data and maintaining gain continuity across B-deck handoff.

**Architecture:** Add provenance to section entry candidates, compute an adaptive safety assessment in the recipe planner, and emit one backward-compatible `safety-long-blend` recipe with short/medium/long overlap classes. Extend the timeline executor with equal-power curve metadata, keep prepared B loudness in its WebAudio graph, and persist sanitized decision diagnostics with feedback.

**Tech Stack:** Node.js CommonJS, Node test runner, browser JavaScript, WebAudio API, Electron/Mineradio runtime.

---

## File Map

- Modify `cuefield/section-candidates.js`: detect early energy entries and attach entry provenance.
- Modify `cuefield/mineradio-bridge.js`: mark synthetic entries as fallback.
- Modify `cuefield/recipe-planner.js`: calculate overlap class, aligned B start, and adaptive safety timelines.
- Modify `public/cuefield-timeline-executor.js`: preserve curve metadata and generate equal-power samples.
- Modify Cuefield blocks in `public/index.html`: route B volume through graph gain and preserve gain at handoff.
- Modify `cuefield/feedback-log.js`: sanitize and aggregate new transition diagnostics.
- Modify `cuefield/feedback-remote.js`: retain new compact fields in remote payloads.
- Modify focused `test/cuefield*.test.js` files: lock down each behavior before implementation.
- Update `CURRENT_STATE.md`: record implementation and listening verification status without committing local data.

### Task 1: Entry Provenance And Energy Entry Detection

**Files:**
- Modify: `test/cuefield.test.js`
- Modify: `test/cuefield-mineradio-bridge.test.js`
- Modify: `cuefield/section-candidates.js`
- Modify: `cuefield/mineradio-bridge.js`

- [ ] **Step 1: Write failing section-entry tests**

Add tests that build a beatmap with a quiet first eight seconds followed by a sustained energy rise and assert:

```js
const result = analyzeSectionCandidates({ fixture, lrcLines: [] });
const entry = result.candidates.find((candidate) => candidate.role === 'entry');
assert.equal(entry.source, 'energy');
assert.equal(entry.time <= 8, true);
assert.equal(entry.resolvesTo.time >= 8, true);
assert.equal(entry.confidence >= 0.6, true);
```

Add a flat-energy fixture assertion that no energy entry is invented.

- [ ] **Step 2: Write a failing bridge fallback test**

Extend the cache bridge test so a map without a credible energy rise returns:

```js
assert.equal(result.to.candidates.find((candidate) => candidate.role === 'entry').source, 'fallback');
assert.equal(result.chosen.entry.source, 'fallback');
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test test/cuefield.test.js test/cuefield-mineradio-bridge.test.js
```

Expected: FAIL because entry candidates do not expose `source` and energy analysis emits no entry.

- [ ] **Step 4: Implement provenance and early energy-rise detection**

In `addLyricCandidates`, set `source: 'lyric'` on lyric-derived entries. Add an early-window detector that compares stable windows in the first 32 seconds and emits:

```js
{
  type: 'intro',
  role: 'entry',
  source: 'energy',
  time: lowWindow.time,
  confidence,
  resolvesTo: { type: 'strong-entry', time: riseWindow.time },
  ...candidateMetric(beats, lowWindow.time),
}
```

Require an energy rise of at least `0.12` and post-rise beat stability of at least `0.35`. In `addFallbackEntry`, add `source: 'fallback'` without changing the existing fallback availability.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 command. Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add cuefield/section-candidates.js cuefield/mineradio-bridge.js test/cuefield.test.js test/cuefield-mineradio-bridge.test.js
git commit -m "Detect trustworthy Cuefield entries"
```

### Task 2: Adaptive Safety Gate And Timeline

**Files:**
- Modify: `test/cuefield-recipe-planner.test.js`
- Modify: `cuefield/recipe-planner.js`

- [ ] **Step 1: Write failing overlap-class tests**

Add three tests using profiles with explicit BPM/grid data:

```js
assert.equal(fallbackPlan.chosen.anchors.overlapClass, 'short');
assert.equal(fallbackPlan.chosen.anchors.overlapDuration <= 3.2, true);
assert.equal(moderatePlan.chosen.anchors.overlapClass, 'medium');
assert.equal(trustedPlan.chosen.anchors.overlapClass, 'long');
```

The fallback case uses `source: 'fallback'` and a large BPM delta. The moderate case uses `source: 'energy'` with 8-15 percent tempo delta. The trusted case uses `source: 'energy'`, a `resolvesTo.time`, and at most 8 percent tempo delta.

- [ ] **Step 2: Write failing musical-safety invariant tests**

For the short case assert:

```js
const play = timeline.find((action) => action.deck === 'B' && action.op === 'play');
const earlyAFilter = timeline.find((action) => action.deck === 'A' && action.op === 'filter' && action.t < -2);
assert.equal(earlyAFilter, undefined);
assert.equal(Math.abs((play.at + plan.chosen.anchors.lead) - plan.chosen.anchors.bAnchor) <= 0.05, true);
```

Also assert a high recipe score cannot promote a fallback entry above `short`.

- [ ] **Step 3: Run planner tests and verify RED**

```bash
node --test test/cuefield-recipe-planner.test.js
```

Expected: FAIL because the current safety recipe always uses a 12-second lead and exposes no overlap class.

- [ ] **Step 4: Implement the safety assessment**

Add a helper returning:

```js
{
  entrySource,
  entryConfidence,
  entryTrusted,
  relativeTempoDelta,
  beatGridTrusted,
  overlapClass,
  overlapDuration,
}
```

Use thresholds from the design: long at `<=0.08`, medium at `<=0.15`, otherwise short; `source: 'fallback'` always selects short. Keep half/double-time as diagnostics only.

- [ ] **Step 5: Replace the fixed safety timeline with class-specific timelines**

Use one `makeSafetyLongBlend` function and one recipe name. Set B play position using:

```js
const bPlayAt = Math.max(0, anchors.bAnchor - lead);
```

Short timeline total overlap must be at most 3.2 seconds, contain no early A filter, and fade A only in the final window. Medium and long timelines may use bounded B filtering and bass exchange.

- [ ] **Step 6: Correct alignment diagnostics**

Stop scoring phase by subtracting unrelated A/B local timestamps. Record alignment from the planned B start-to-anchor offset and expose the safety assessment through both chosen anchors and top-level diagnostics.

- [ ] **Step 7: Run planner tests and verify GREEN**

Run the Task 2 command. Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add cuefield/recipe-planner.js test/cuefield-recipe-planner.test.js
git commit -m "Adapt Cuefield safety overlap to confidence"
```

### Task 3: Equal-Power Execution And Gain-Continuous Handoff

**Files:**
- Modify: `test/cuefield-timeline-executor.test.js`
- Modify: `test/cuefield-automix.test.js`
- Modify: `test/cuefield-playback-handoff.test.js`
- Modify: `public/cuefield-timeline-executor.js`
- Modify: Cuefield integration blocks in `public/index.html`

- [ ] **Step 1: Write failing equal-power helper tests**

Export `buildEqualPowerCurve(direction, points)` and assert:

```js
const incoming = buildEqualPowerCurve('in', 9);
const outgoing = buildEqualPowerCurve('out', 9);
assert.equal(incoming[0], 0);
assert.equal(incoming.at(-1), 1);
assert.equal(outgoing[0], 1);
assert.equal(outgoing.at(-1), 0);
assert.equal(Math.abs((incoming[4] ** 2 + outgoing[4] ** 2) - 1) < 0.02, true);
```

Extend normalization tests to assert `curve: 'equal-power-in'` and `curve: 'equal-power-out'` survive into execution actions.

- [ ] **Step 2: Write failing source-level handoff guard tests**

Extend the existing source integration tests to require that B graph gain is used for timeline volume when available, `media.volume` is normalized to `1`, and the prepared B graph is preserved through `playQueueAt` handoff.

- [ ] **Step 3: Run executor and integration tests and verify RED**

```bash
node --test test/cuefield-timeline-executor.test.js test/cuefield-automix.test.js test/cuefield-playback-handoff.test.js
```

Expected: FAIL because equal-power helpers and graph-owned B volume do not exist.

- [ ] **Step 4: Implement equal-power curve generation**

Generate sampled sine/cosine curves in `public/cuefield-timeline-executor.js`, retain `action.curve` during normalization, and return plain arrays so Node and browser consumers use the same values.

- [ ] **Step 5: Route prepared B volume through graph gain**

When the B graph is available, set its gain to the media element's current effective level, then set `media.volume = 1`. Apply B volume actions to `graph.gain`; use `setValueCurveAtTime` for equal-power actions and linear ramp only for legacy actions.

- [ ] **Step 6: Keep A and B gain continuous at handoff**

Apply outgoing curves to A `gainNode`, incoming curves to B graph gain, and ensure the incoming curve finishes at `targetVolume`. Reusing the prepared element and graph must not reset its effective level before `initAudio` adopts it.

- [ ] **Step 7: Add volume-only runtime downgrade**

If a required B graph is unavailable, run a 2.2-second volume-only curve, skip filter/bass actions, and set `pending.runtimeDowngrade = 'volume-only'`.

- [ ] **Step 8: Run executor and integration tests and verify GREEN**

Run the Task 3 command. Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add public/cuefield-timeline-executor.js public/index.html test/cuefield-timeline-executor.test.js test/cuefield-automix.test.js test/cuefield-playback-handoff.test.js
git commit -m "Preserve Cuefield gain through handoff"
```

### Task 4: Feedback Diagnostics

**Files:**
- Modify: `test/cuefield-feedback-log.test.js`
- Modify: `test/cuefield-feedback-remote.test.js`
- Modify: `cuefield/feedback-log.js`
- Modify: `cuefield/feedback-remote.js`
- Modify: Cuefield feedback block in `public/index.html`

- [ ] **Step 1: Write failing feedback normalization tests**

Build a record containing overlap class, entry provenance, BPM values, tempo delta, beat-grid trust, runtime downgrade, and the three planner diagnostics. Assert all numeric fields are rounded and old records remain readable.

- [ ] **Step 2: Write a failing remote payload test**

Assert the remote payload retains the compact transition fields while still excluding audio URL and beatmap content.

- [ ] **Step 3: Run feedback tests and verify RED**

```bash
node --test test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js
```

Expected: FAIL because compact transition normalization drops the new fields.

- [ ] **Step 4: Implement compact diagnostic fields**

Extend `compactTransition` with bounded strings, rounded numbers, booleans, and a nested three-number diagnostics object. Add the planner data to `cuefieldFeedbackContextFromPending`; include `pending.runtimeDowngrade` when present.

- [ ] **Step 5: Run feedback tests and verify GREEN**

Run the Task 4 command. Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add cuefield/feedback-log.js cuefield/feedback-remote.js public/index.html test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js
git commit -m "Record Cuefield transition diagnostics"
```

### Task 5: Regression Audit And Checkpoint

**Files:**
- Modify: `CURRENT_STATE.md` locally

- [ ] **Step 1: Run the complete focused suite**

```bash
node --test test/cuefield*.test.js test/beatmap-cache-path.test.js
node --check server.js
node --check public/cuefield-automix.js
node --check public/cuefield-timeline-executor.js
node --check cuefield/recipe-planner.js
git diff --check
```

Expected: all tests and syntax checks pass with no whitespace errors.

- [ ] **Step 2: Replan all 61 local feedback pairs**

Run a local Node audit against `data/cuefield-feedback.jsonl` and ignored beatmap caches. Verify every previous rating 2/3 pair selects `overlapClass: 'short'` and `overlapDuration <= 3.2`. Do not write or commit an audit report.

- [ ] **Step 3: Inspect repository scope**

```bash
git status --short
git diff --stat HEAD~4..HEAD
git diff --check HEAD~4..HEAD
```

Expected: only Cuefield implementation, focused tests, docs, and local ignored checkpoint changes; `desktop/main.js` remains the user's uncommitted change.

- [ ] **Step 4: Update the local checkpoint**

Update `CURRENT_STATE.md` to record adaptive overlap classes, entry provenance, gain-continuous handoff, feedback diagnostics, automated verification, and the remaining manual listening requirement. Keep it under 30 lines and preserve release/security redlines.

- [ ] **Step 5: Manual listening handoff**

Provide the six previous non-passing pairs and six control pairs for listening. Do not claim the musical result is complete until the user rates the new transitions.

## Completion Boundary

Implementation is code-complete when automated checks pass, the six known bad pairs select short transitions, and no unrelated files are committed. Musical validation remains pending until the user listens in Mineradio; do not publish or push without explicit confirmation.

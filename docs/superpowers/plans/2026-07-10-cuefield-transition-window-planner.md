# Cuefield Transition Window Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cuefield play A's first credible Hook in full, then rank and execute an honest complete transition window that lands B at a credible Hook or a more natural fallback.

**Architecture:** Upgrade `structure-map.js` to emit evidence-backed Hooks and immediate post-Hook exits. Add `transition-window-planner.js` to combine A exits, B landing options, and concrete recipe timelines, validate protection and landing invariants, measure actual audible overlap, and rank complete windows. Keep runtime scheduling backward compatible while preferring explicit validated timing.

**Tech Stack:** Node.js CommonJS, `node:test`, Electron renderer JavaScript, Web Audio timeline actions, JSONL feedback.

---

## File Map

- Modify `cuefield/structure-map.js`: repeated lyric block evidence, complete Hook bounds, post-Hook exits, B landing metadata.
- Modify `cuefield/recipe-planner.js`: exact B landing alignment and timeline window measurement.
- Create `cuefield/transition-window-planner.js`: bounded exit/landing/recipe product, validation, scoring.
- Modify `cuefield/mineradio-bridge.js`: replace late anchor-first selection with complete-window selection.
- Modify `public/cuefield-automix.js`: schedule explicit `mixStart` while retaining legacy fallback behavior.
- Modify `cuefield/feedback-log.js`, `cuefield/feedback-remote.js`, and the existing Cuefield feedback block in `public/index.html`: persist compact window diagnostics.
- Modify focused tests under `test/`; do not rewrite unrelated integration code.

### Task 1: Evidence-Backed Hooks And Immediate Post-Hook Exits

**Files:**
- Modify: `cuefield/structure-map.js`
- Test: `test/cuefield-structure-map.test.js`
- Test: `test/cuefield-mineradio-bridge.test.js`

- [ ] **Step 1: Write failing Hook evidence tests**

Add tests proving that one repeated line is only a candidate, while a repeated two-line block plus sustained energy creates one complete Hook:

```js
test('does not call one repeated lyric line a credible hook', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.45, 0.72]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 50, normalized: 'we own the night' },
    ],
  });
  assert.equal(map.sections.some((section) => section.type === 'hook'), false);
  assert.equal(map.sections.some((section) => section.type === 'hook-candidate'), true);
});

test('uses a repeated lyric block and sustained energy as credible hook evidence', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.74, 0.44, 0.72, 0.7]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 34, normalized: 'nothing feels the same' },
      { time: 66, normalized: 'we own the night' },
      { time: 82, normalized: 'nothing feels the same' },
    ],
  });
  const hook = map.sections.find((section) => section.type === 'hook');
  assert.equal(hook.start, 16);
  assert.equal(hook.end, 48);
  assert.equal(hook.evidence.repeatedLineCount, 2);
  assert.equal(hook.evidence.repeatedBlockCount, 2);
  assert.equal(map.protectedUntil, 48);
});
```

Update the paired-LRC bridge fixture so both A and B repeat two contiguous lines instead of one.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/cuefield-structure-map.test.js test/cuefield-mineradio-bridge.test.js
```

Expected: FAIL because the current analyzer treats one repeated line as a Hook and exposes no block evidence.

- [ ] **Step 3: Add repeated-block detection and complete Hook bounds**

Add these focused helpers to `cuefield/structure-map.js`:

```js
function normalizedLyricLines(lines) {
  return (lines || [])
    .map((line) => ({ ...line, normalized: String(line && line.normalized || '').trim() }))
    .filter((line) => line.normalized.length >= 4 && Number.isFinite(toNumber(line.time, NaN)))
    .sort((a, b) => a.time - b.time);
}

function repeatedLyricBlocks(lines) {
  const normalized = normalizedLyricLines(lines);
  const groups = new Map();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    const key = pair.map((line) => line.normalized).join('\u0000');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ start: pair[0].time, end: pair[1].time, lines: pair });
  }
  return Array.from(groups.values())
    .filter((occurrences) => occurrences.length >= 2)
    .flatMap((occurrences) => occurrences.map((occurrence) => ({
      ...occurrence,
      repeatedLineCount: occurrence.lines.length,
      repeatedBlockCount: occurrences.length,
    })))
    .sort((a, b) => a.start - b.start);
}

function phrasesForBlock(phrases, block) {
  const estimatedEnd = Math.max(block.end + 4, block.start + 8);
  return phrases.filter((phrase) => toNumber(phrase.end) > block.start && toNumber(phrase.start) < estimatedEnd);
}
```

Use the earliest repeated block whose merged phrases meet the energy gate. Emit `hook` at confidence `>= 0.65`, `hook-candidate` for single-line recurrence, and `drop` or `drop-candidate` for beat-only evidence. Populate `evidence.repeatedLineCount`, `repeatedBlockCount`, `energyLift`, and `sustainedEnergy` from the selected block and merged phrases.

- [ ] **Step 4: Add a failing immediate-search test**

```js
test('searches from protectedUntil instead of waiting for 35 percent', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.3, 0.8, 0.68, 0.42, 0.38, 0.34], 96),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 34, normalized: 'nothing feels the same' },
      { time: 66, normalized: 'we own the night' },
      { time: 82, normalized: 'nothing feels the same' },
    ],
  });
  const firstExit = map.exitCandidates[0];
  assert.equal(firstExit.time, map.protectedUntil);
  assert.equal(firstExit.type, 'post-hook-boundary');
  assert.equal(firstExit.exitRatio, 0.5);
  assert.equal(firstExit.latePenalty, 0);
});
```

- [ ] **Step 5: Run the new test and verify RED**

Run `node --test test/cuefield-structure-map.test.js`.

Expected: FAIL because exit search still waits until `duration * 0.35` and has no lateness metadata.

- [ ] **Step 6: Emit immediate post-Hook exits and honest B landing metadata**

Change exit search to begin at `protectedUntil`. Add timing metadata with this function:

```js
function latePenaltyFor(time, duration) {
  const ratio = duration > 0 ? time / duration : 1;
  if (ratio <= 0.65) return 0;
  if (ratio <= 0.78) return round(((ratio - 0.65) / 0.13) * 0.25);
  return round(0.45 + Math.min(0.2, (ratio - 0.78) * 0.5));
}
```

Mark the first boundary as `post-hook-boundary`. Add `playFrom`, `landingAt`, and `landingType` to pre-Hook and Hook entries while preserving `time` and `resolvesTo` for compatibility.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
node --test test/cuefield-structure-map.test.js test/cuefield-mineradio-bridge.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add cuefield/structure-map.js test/cuefield-structure-map.test.js test/cuefield-mineradio-bridge.test.js
git commit -m "Build evidence-backed Cuefield hooks"
```

### Task 2: Recipe Timelines With Measured Audible Windows

**Files:**
- Modify: `cuefield/recipe-planner.js`
- Test: `test/cuefield-recipe-planner.test.js`

- [ ] **Step 1: Write failing measurement and landing tests**

```js
test('excludes silent preroll from audible overlap', () => {
  const measured = measureTimelineWindow([
    { t: -5, deck: 'B', op: 'play', at: 20, volume: 0 },
    { t: -5, deck: 'B', op: 'volume', value: 0, duration: 2800 },
    { t: -1.8, deck: 'B', op: 'volume', value: 1, duration: 1800, curve: 'equal-power-in' },
    { t: -1.8, deck: 'A', op: 'volume', value: 0, duration: 1800, curve: 'equal-power-out' },
    { t: 0.6, deck: 'B', op: 'handoff' },
  ]);
  assert.equal(measured.preRollDuration > measured.audibleOverlap, true);
  assert.equal(measured.audibleOverlap >= 1.5 && measured.audibleOverlap <= 2.1, true);
});

test('aligns the requested B landing with handoff', () => {
  const timeline = buildSafetyTimelineForAnchors({
    bLandingAt: 32,
    overlapClass: 'medium',
    overlapDuration: 5.6,
  });
  const play = timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const handoff = timeline.filter((action) => action.op === 'handoff').at(-1);
  assert.equal(Math.abs(play.at + (handoff.t - play.t) - 32) <= 0.01, true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `node --test test/cuefield-recipe-planner.test.js`.

Expected: FAIL because the measurement and explicit landing APIs do not exist.

- [ ] **Step 3: Add deterministic timeline measurement**

```js
function measureTimelineWindow(timeline, threshold = 0.08) {
  const actions = Array.isArray(timeline) ? timeline : [];
  const play = actions.find((action) => action.deck === 'B' && action.op === 'play');
  const handoff = actions.filter((action) => action.op === 'handoff').at(-1);
  const fadeIn = actions.find((action) => action.deck === 'B' && action.op === 'volume' && toNumber(action.value) > threshold);
  const fadeOut = actions.find((action) => action.deck === 'A' && action.op === 'volume' && toNumber(action.value, 1) <= threshold);
  const fadeInDuration = fadeIn ? toNumber(fadeIn.duration) / 1000 : 0;
  const fadeOutDuration = fadeOut ? toNumber(fadeOut.duration) / 1000 : 0;
  const audibleStart = fadeIn ? toNumber(fadeIn.t) + fadeInDuration * threshold : toNumber(play && play.t);
  const audibleEnd = fadeOut ? toNumber(fadeOut.t) + fadeOutDuration * (1 - threshold) : toNumber(handoff && handoff.t);
  return {
    preRollDuration: round(Math.max(0, audibleStart - toNumber(play && play.t))),
    audibleStart: round(audibleStart),
    audibleEnd: round(audibleEnd),
    audibleOverlap: round(Math.max(0, audibleEnd - audibleStart)),
    handoffOffset: round(toNumber(handoff && handoff.t)),
  };
}
```

Attach the measurement to every recipe candidate as `candidate.window`.

- [ ] **Step 4: Align B landing and lengthen actual short crossfade**

```js
function alignedBPlayFrom(bLandingAt, playOffset, handoffOffset) {
  return round(Math.max(0, toNumber(bLandingAt) - (handoffOffset - playOffset)));
}

function buildSafetyTimelineForAnchors(opts = {}) {
  const overlapClass = opts.overlapClass || 'short';
  const overlapDuration = toNumber(opts.overlapDuration, overlapClass === 'medium' ? 5.6 : 3.4);
  const lead = overlapClass === 'long' ? 9.5 : (overlapClass === 'medium' ? 5 : 3.1);
  return safetyTimeline(
    { bAnchor: toNumber(opts.bLandingAt) },
    { overlapClass, overlapDuration },
  ).timeline;
}
```

Use `alignedBPlayFrom` in safety timelines. Set the short equal-power crossfade to `3.4s`; keep B low end reduced until the final `1.2s`. Keep medium at `4-6s` audible and long at `6-10s` audible under existing compatibility gates. Export `measureTimelineWindow` and `buildSafetyTimelineForAnchors` for tests.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node --test test/cuefield-recipe-planner.test.js test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js
```

Expected: all tests PASS and gain ownership behavior is unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add cuefield/recipe-planner.js test/cuefield-recipe-planner.test.js
git commit -m "Measure Cuefield audible transition windows"
```

### Task 3: Complete Transition Window Selection

**Files:**
- Create: `cuefield/transition-window-planner.js`
- Create: `test/cuefield-transition-window-planner.test.js`
- Modify: `cuefield/section-candidates.js`

- [ ] **Step 1: Write failing complete-window tests**

Create tests with full cue profiles:

```js
function exitAt(time, confidence, duration = 200) {
  const exitRatio = time / duration;
  return {
    type: 'release',
    role: 'exit',
    time,
    confidence,
    exitRatio,
    latePenalty: exitRatio <= 0.65 ? 0 : (exitRatio <= 0.78 ? 0.25 : 0.55),
    energyBefore: 0.72,
    energyAfter: 0.5,
  };
}

function preHookLanding(playFrom, landingAt, confidence) {
  return { type: 'pre-hook', role: 'entry', source: 'lyric+beat', time: playFrom, playFrom, landingAt, landingType: 'hook', confidence };
}

function directHook(landingAt, confidence) {
  return { type: 'hook', role: 'entry', source: 'lyric+beat', time: landingAt, playFrom: landingAt, landingAt, landingType: 'hook', confidence };
}

function naturalIntro(playFrom, confidence) {
  return { type: 'intro', role: 'entry', source: 'energy', time: playFrom, playFrom, landingAt: playFrom + 8, landingType: 'intro', confidence };
}

function makeAnalysis({ duration = 200, bpm = 120, protectedUntil = 32, exits = [], entries = [] }) {
  const gridStep = 60 / bpm;
  const beats = [];
  for (let time = 0, index = 0; time < duration; time += gridStep, index += 1) {
    beats.push({ time, confidence: 0.9, downbeat: index % 4 === 0, low: 0.42, body: 0.5, snap: index % 4 === 0 ? 0.65 : 0.25, impact: 0.55 });
  }
  const cueProfile = buildCueProfile({ track: { duration }, map: { duration, gridStep, beats }, candidates: [...exits, ...entries] });
  return {
    duration,
    candidates: [...exits, ...entries],
    structureMap: { protectedUntil, exitCandidates: exits, entryCandidates: entries },
    cueProfile,
  };
}

test('prefers a usable mid-track window over a similar outro window', () => {
  const result = chooseTransitionWindow(
    makeAnalysis({ duration: 200, protectedUntil: 40, exits: [exitAt(88, 0.72), exitAt(188, 0.76)] }),
    makeAnalysis({ entries: [preHookLanding(12, 24, 0.82)] }),
  );
  assert.equal(result.chosen.exit.time, 88);
  assert.equal(result.chosen.mixStart >= 40, true);
});

test('rejects a recipe whose audible action enters the protected hook', () => {
  const result = chooseTransitionWindow(
    makeAnalysis({ duration: 120, protectedUntil: 40, exits: [exitAt(42, 0.8), exitAt(56, 0.72)] }),
    makeAnalysis({ entries: [preHookLanding(8, 20, 0.82)] }),
  );
  assert.equal(result.chosen.exit.time, 56);
  assert.equal(result.rejected.some((item) => item.rejectionReasons.includes('audible action before protected hook end')), true);
});

test('uses a natural intro when direct hook landing is incompatible', () => {
  const result = chooseTransitionWindow(
    makeAnalysis({ bpm: 88, exits: [exitAt(72, 0.75)] }),
    makeAnalysis({ bpm: 128, entries: [directHook(36, 0.82), naturalIntro(0, 0.7)] }),
  );
  assert.equal(result.chosen.entry.landingType, 'intro');
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run `node --test test/cuefield-transition-window-planner.test.js`.

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Add bounded landing collection**

Create `cuefield/transition-window-planner.js` and merge Structure Map entries with energy-derived Intro entries:

```js
function landingTypeFor(candidate) {
  if (candidate.type === 'pre-hook') return 'hook';
  if (candidate.type === 'hook' || candidate.type === 'chorus') return 'hook';
  if (candidate.type === 'intro') return 'intro';
  if (candidate.type === 'drop') return 'drop';
  return 'start';
}

function uniqueByLanding(candidates) {
  const out = [];
  candidates
    .sort((a, b) => toNumber(b.confidence) - toNumber(a.confidence) || toNumber(a.landingAt) - toNumber(b.landingAt))
    .forEach((candidate) => {
      const duplicate = out.some((item) => item.landingType === candidate.landingType && Math.abs(item.landingAt - candidate.landingAt) < 1.5);
      if (!duplicate) out.push(candidate);
    });
  return out;
}

function landingOptions(analysis) {
  const structure = analysis && analysis.structureMap || {};
  const candidates = [
    ...(structure.entryCandidates || []),
    ...((analysis && analysis.candidates) || []).filter((candidate) => candidate.role === 'entry'),
  ];
  return uniqueByLanding(candidates.map((candidate) => ({
    ...candidate,
    playFrom: toNumber(candidate.playFrom, candidate.time),
    landingAt: toNumber(candidate.landingAt, candidate.resolvesTo && candidate.resolvesTo.time != null
      ? candidate.resolvesTo.time
      : candidate.time),
    landingType: candidate.landingType || landingTypeFor(candidate),
  }))).slice(0, 6);
}
```

Map `pre-hook` to `pre-hook-to-hook`, credible `hook` to `hook`, energy `intro` to `intro`, and fallback to `start`.

- [ ] **Step 4: Generate and validate complete windows**

For the strongest eight exits and six landings, call `planRecipeCandidates` and flatten every returned recipe:

```js
function absoluteWindow(exit, entry, recipe, recipeDiagnostics, protectedUntil, duration, sectionChoice) {
  const measured = recipe.window;
  const mixStart = round(exit.time + measured.audibleStart);
  const handoffAt = round(exit.time + measured.handoffOffset);
  const play = recipe.timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const landingAtHandoff = round(play.at + (measured.handoffOffset - play.t));
  const rejectionReasons = [];
  if (mixStart < protectedUntil) rejectionReasons.push('audible action before protected hook end');
  if (Math.abs(landingAtHandoff - entry.landingAt) > 0.08) rejectionReasons.push('B landing misses handoff');
  if (entry.landingType === 'hook' && recipeDiagnostics.relativeTempoDelta > 0.15 && entry.playFrom === entry.landingAt) {
    rejectionReasons.push('direct hook has no compatible runway');
  }
  return {
    exit,
    entry,
    recipeCandidate: recipe,
    timeline: recipe.timeline,
    mixStart,
    handoffAt,
    audibleOverlap: measured.audibleOverlap,
    preRollDuration: measured.preRollDuration,
    exitRatio: round(exit.time / duration),
    sectionChoice,
    rejectionReasons,
  };
}
```

- [ ] **Step 5: Calculate groove continuity, score complete windows, and preserve old direct callers**

Calculate groove continuity only from data already present in cue profiles:

```js
function grooveContinuityFor(fromProfile, toProfile, exitTime, landingAt, beatGridTrusted) {
  if (!beatGridTrusted) return 0.35;
  const fromBars = barsNear(fromProfile, exitTime, 8);
  const toBars = barsNear(toProfile, landingAt, 8);
  const stability = 1 - Math.abs(average(fromBars.map((bar) => bar.beatStability))
    - average(toBars.map((bar) => bar.beatStability)));
  const snap = 1 - Math.abs(average(fromBars.map((bar) => bar.snapDensity))
    - average(toBars.map((bar) => bar.snapDensity)));
  const body = 1 - Math.abs(average(fromBars.map((bar) => bar.bodyDensity))
    - average(toBars.map((bar) => bar.bodyDensity)));
  return round(clamp(average([stability, snap, body])));
}

function barsNear(profile, time, span) {
  const half = span / 2;
  return (profile && profile.bars || []).filter((bar) => bar.end > time - half && bar.start < time + half);
}
```

Attach `energyContinuity`, `grooveContinuity`, and `tempoCompatibility` to every valid window and its diagnostics.

```js
function scoreWindow(window, pairScore, diagnostics) {
  const structure = average([window.exit.confidence, window.entry.confidence]);
  const target = diagnostics.relativeTempoDelta <= 0.08 ? 8 : (diagnostics.relativeTempoDelta <= 0.15 ? 5 : 3.4);
  const overlap = clamp(window.audibleOverlap / target);
  const continuity = average([
    window.energyContinuity,
    window.grooveContinuity,
    window.tempoCompatibility,
    diagnostics.bassScore,
  ]);
  return round(clamp(
    pairScore * 0.34
    + window.recipeCandidate.score * 0.2
    + structure * 0.16
    + overlap * 0.12
    + continuity * 0.18
    - toNumber(window.exit.latePenalty),
  ));
}
```

Return `{ chosen, candidates, rejected, diagnostics }`. Keep `chooseTransitionCandidates` exported for compatibility, but route profile-backed calls through the complete-window selector.

If every generated window is rejected, return one explicit zero-second `start` fallback with `rejectionReasons: ['no valid complete transition window']`; never relabel it as a Hook.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node --test test/cuefield-transition-window-planner.test.js test/cuefield.test.js test/cuefield-recipe-planner.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add cuefield/transition-window-planner.js cuefield/section-candidates.js test/cuefield-transition-window-planner.test.js
git commit -m "Choose complete Cuefield transition windows"
```

### Task 4: Bridge And AutoMix Use Validated Timing

**Files:**
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `public/cuefield-automix.js`
- Test: `test/cuefield-mineradio-bridge.test.js`
- Test: `test/cuefield-automix.test.js`

- [ ] **Step 1: Add failing bridge and AutoMix assertions**

Extend bridge integration:

```js
assert.equal(result.chosen.mixStart >= result.from.structureMap.protectedUntil, true);
assert.equal(result.chosen.audibleOverlap >= 3, true);
assert.equal(result.diagnostics.audibleOverlap, result.chosen.audibleOverlap);
assert.equal(result.diagnostics.preRollDuration, result.chosen.preRollDuration);
assert.equal(result.diagnostics.exitRatio, result.chosen.exitRatio);
```

Add an AutoMix test where `mixStart: 48.25`, `exit.time: 53`, and timeline lead is `5`; assert `pending.triggerAt === 48.25`, proving runtime does not reconstruct timing.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-automix.test.js
```

Expected: FAIL because the bridge still requests late selection and AutoMix reconstructs `triggerAt`.

- [ ] **Step 3: Route bridge through `chooseTransitionWindow`**

```js
const windowPlan = chooseTransitionWindow(from, to);
const selected = windowPlan.chosen;
const chosen = {
  ...selected.sectionChoice,
  exit: selected.exit,
  entry: selected.entry,
  transitionRecipe: selected.recipeCandidate.recipe,
  timeline: selected.timeline,
  recipeCandidate: selected.recipeCandidate,
  mixStart: selected.mixStart,
  handoffAt: selected.handoffAt,
  audibleOverlap: selected.audibleOverlap,
  preRollDuration: selected.preRollDuration,
  exitRatio: selected.exitRatio,
};
```

Remove `exitBias: 'late'`. Expose selected continuity dimensions and concise rejection reasons without raw lyrics or beatmaps.

- [ ] **Step 4: Prefer explicit `mixStart` in AutoMix**

```js
var plannedMixStart = toNumber(chosen.mixStart, NaN);
var triggerAt = isFinite(plannedMixStart)
  ? Math.max(protectedUntil, plannedMixStart)
  : (isFinite(exitTime) ? Math.max(protectedUntil, exitTime - leadSec) : protectedUntil);
```

Copy `handoffAt`, `audibleOverlap`, and `preRollDuration` into `state.pending`.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-automix.test.js test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add cuefield/mineradio-bridge.js public/cuefield-automix.js test/cuefield-mineradio-bridge.test.js test/cuefield-automix.test.js
git commit -m "Execute validated Cuefield transition windows"
```

### Task 5: Honest Complete-Window Feedback

**Files:**
- Modify: `cuefield/feedback-log.js`
- Modify: `cuefield/feedback-remote.js`
- Modify: `public/index.html`
- Test: `test/cuefield-feedback-log.test.js`
- Test: `test/cuefield-feedback-remote.test.js`
- Test: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Add failing local and remote sanitization tests**

Add this input to both fixtures and assert three-decimal rounding plus privacy:

```js
firstHookStart: 16,
firstHookEnd: 32,
hookConfidence: 0.82,
hookEvidence: { repeatedLineCount: 2, repeatedBlockCount: 2, energyLift: 0.24, sustainedEnergy: 0.76 },
exitRatio: 0.46,
mixStart: 74.2,
handoffAt: 79.8,
landingAt: 32,
audibleOverlap: 4.9,
preRollDuration: 0.7,
energyContinuity: 0.81,
grooveContinuity: 0.74,
tempoCompatibility: 0.69,
windowRejectionReasons: ['late emergency exit'],
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js test/cuefield-feedback-stats-ui.test.js
```

Expected: FAIL because complete-window fields are not normalized or forwarded.

- [ ] **Step 3: Normalize compact window diagnostics**

```js
function compactHookEvidence(value = {}) {
  return {
    repeatedLineCount: Math.max(0, Math.round(Number(value.repeatedLineCount) || 0)),
    repeatedBlockCount: Math.max(0, Math.round(Number(value.repeatedBlockCount) || 0)),
    energyLift: roundNumber(value.energyLift),
    sustainedEnergy: roundNumber(value.sustainedEnergy),
  };
}

function compactStringArray(values, limit, maxLength) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .slice(0, limit)
    .map((value) => compactString(value, maxLength))
    .filter(Boolean);
}

function compactWindow(transition = {}) {
  return {
    firstHookStart: roundNumber(transition.firstHookStart),
    firstHookEnd: roundNumber(transition.firstHookEnd),
    hookConfidence: roundNumber(transition.hookConfidence),
    hookEvidence: compactHookEvidence(transition.hookEvidence),
    exitRatio: roundNumber(transition.exitRatio),
    mixStart: roundNumber(transition.mixStart),
    handoffAt: roundNumber(transition.handoffAt),
    landingAt: roundNumber(transition.landingAt),
    audibleOverlap: roundNumber(transition.audibleOverlap),
    preRollDuration: roundNumber(transition.preRollDuration),
    energyContinuity: roundNumber(transition.energyContinuity),
    grooveContinuity: roundNumber(transition.grooveContinuity),
    tempoCompatibility: roundNumber(transition.tempoCompatibility),
    rejectionReasons: compactStringArray(transition.windowRejectionReasons, 8, 96),
  };
}
```

Store this as `transition.window` locally and forward the same nested object remotely. Keep the additive remote schema backward compatible.

- [ ] **Step 4: Pass planner diagnostics from the existing UI block**

Add direct values from `plannerDiagnostics` to the existing feedback context; do not change layout or unrelated player code:

```js
firstHookStart: plannerDiagnostics.firstHookStart,
firstHookEnd: plannerDiagnostics.firstHookEnd,
hookConfidence: plannerDiagnostics.hookConfidence,
hookEvidence: plannerDiagnostics.hookEvidence,
exitRatio: plannerDiagnostics.exitRatio,
mixStart: plannerDiagnostics.mixStart,
handoffAt: plannerDiagnostics.handoffAt,
landingAt: plannerDiagnostics.landingAt,
audibleOverlap: plannerDiagnostics.audibleOverlap,
preRollDuration: plannerDiagnostics.preRollDuration,
energyContinuity: plannerDiagnostics.energyContinuity,
grooveContinuity: plannerDiagnostics.grooveContinuity,
tempoCompatibility: plannerDiagnostics.tempoCompatibility,
windowRejectionReasons: plannerDiagnostics.windowRejectionReasons,
```

- [ ] **Step 5: Run tests and verify GREEN**

Run the three feedback tests from Step 2.

Expected: all tests PASS and raw LRC/audio privacy assertions remain green.

- [ ] **Step 6: Commit Task 5**

```bash
git add cuefield/feedback-log.js cuefield/feedback-remote.js public/index.html test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "Record Cuefield transition window diagnostics"
```

### Task 6: Full Regression, Real-Data Audit, And Listening Restart

**Files:**
- Modify only files required by regressions caused by Tasks 1-5
- Do not commit: `data/`, `D:\MineradioCache\beatmaps/`, generated audit output, or local `desktop/main.js`

- [ ] **Step 1: Run all Cuefield tests**

```bash
node --test test/cuefield*.test.js test/beatmap-cache-path.test.js
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run syntax and whitespace checks**

```bash
node --check server.js
node --check public/cuefield-automix.js
node --check public/cuefield-lyric-source.js
node --check public/cuefield-timeline-executor.js
node --check cuefield/structure-map.js
node --check cuefield/transition-window-planner.js
node --check cuefield/mineradio-bridge.js
node --check cuefield/section-candidates.js
node --check cuefield/recipe-planner.js
node --check cuefield/feedback-log.js
node --check cuefield/feedback-remote.js
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Replan the three new rated pairs with real local inputs**

Request `Killing Me -> Believe In Me`, `Believe In Me -> Fortress`, and `Fortress -> 春娇与志明` from the local transition endpoint using real LRC and cached Beat Maps. Print only:

```js
{
  pair,
  firstHookEnd,
  mixStart,
  exitTime,
  exitRatio,
  entryType,
  landingAt,
  audibleOverlap,
  preRollDuration,
  rejectionReasons,
}
```

Expected: every `mixStart >= firstHookEnd`; an exit above `0.78` cannot beat a usable earlier window; the third pair does not claim a lyric Hook for B; audible overlap excludes silent pre-roll.

- [ ] **Step 4: Inspect final scope**

```bash
git status --short
git diff --stat 5c827dd..HEAD
git diff --check 5c827dd..HEAD
```

Expected: commits contain only Cuefield code, tests, specs, and plans. `desktop/main.js` may remain locally modified for macOS listening but is not staged.

- [ ] **Step 5: Restart Mineradio from the feature worktree**

Terminate only the running Mineradio Electron instance. Launch Electron through macOS LaunchServices with the absolute feature-worktree path, then run:

```bash
curl -sS -I --max-time 3 http://127.0.0.1:3000
```

Expected: HTTP `200`; renderer and audio helper remain alive after the launching shell exits; GPU helper uses `--use-angle=metal` on macOS.

- [ ] **Step 6: Collect a fresh listening batch**

Rate the same three pairs before adding loops, time stretching, or pitch operations. Compare `exitRatio`, actual `entryType`, and `audibleOverlap` with the previous `1 / 2 / 2` baseline.

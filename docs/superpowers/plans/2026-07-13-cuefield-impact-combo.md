# Cuefield Impact Combo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rare, safely gated `tease-roll-double-drop` transition that previews B, tightens a real A loop, creates a bounded fake-out, and lands B's trusted Hook or Drop on the impact beat.

**Architecture:** Extend the existing recipe planner with one composite candidate and an explicit `bImpactOffset` landing equation, while retaining the current action vocabulary and fallback timelines. Pass a two-transition recipe history through the local API to enforce cooldown, and make the renderer skip only the optional fake-gap action when timer lateness is unsafe.

**Tech Stack:** CommonJS Node.js planner modules, browser UMD timeline executor, Electron renderer in `public/index.html`, Node test runner (`node --test`).

---

## File Map

- Modify `cuefield/recipe-planner.js`: impact landing diagnostics, composite timeline, eligibility, ranking, and fallback metadata.
- Modify `cuefield/transition-window-planner.js`: pass recent recipe history into recipe planning and preserve impact diagnostics.
- Modify `cuefield/mineradio-bridge.js`: accept sanitized recent recipe history and forward it to window planning.
- Modify `server.js`: accept only the last two bounded recipe names from the local transition request.
- Modify `public/cuefield-timeline-executor.js`: preserve optional late-skip action metadata.
- Modify `public/index.html`: keep recent executed recipes, send cooldown context, skip late fake-gap actions, and expose execution diagnostics to feedback.
- Modify `cuefield/feedback-log.js`: retain compact impact execution diagnostics.
- Test with the matching files under `test/`; do not modify `desktop/main.js`.

### Task 1: Separate Impact Landing From Handoff

**Files:**
- Modify: `cuefield/recipe-planner.js:88-115`
- Test: `test/cuefield-recipe-planner.test.js`

- [ ] **Step 1: Write the failing landing-equation test**

Add this helper beside the existing profile helpers, then add a test that supplies a final B play at `t = -1.6`, an impact at `t = 0`, and a handoff at `t = 0.6`:

```js
function trustedImpactPlan(recentRecipes = []) {
  const fromProfile = makeProfile('A', 128, [
    { type: 'release', role: 'exit', time: 112, confidence: 0.9 },
  ]);
  const entry = {
    type: 'hook',
    role: 'entry',
    source: 'lyrics',
    time: 20,
    confidence: 0.9,
    resolvesTo: { time: 24 },
  };
  const toProfile = makeProfile('B', 120, [entry]);
  fromProfile.musicalProfile = reliableMusicalProfile(0);
  toProfile.musicalProfile = reliableMusicalProfile(0);
  fromProfile.bpm = 120;
  toProfile.bpm = 120;
  return planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { type: 'release', time: 112, confidence: 0.9 },
      entry,
      evaluation: { tier: 'magic', risks: [] },
    },
    routePolicy: { route: 'structure-mix' },
    recentRecipes,
  });
}

test('measures an explicit B impact before the later internal handoff', () => {
  const plan = trustedImpactPlan();
  const impact = plan.candidates.find((candidate) => candidate.recipe === 'tease-roll-double-drop');
  const finalPlay = impact.timeline.filter((action) => action.deck === 'B' && action.op === 'play').slice(-1)[0];

  assert.equal(impact.anchors.bImpactOffset, 0);
  assert.equal(impact.window.handoffOffset, 0.6);
  assert.equal(Math.abs(finalPlay.at + (impact.anchors.bImpactOffset - finalPlay.t) - impact.anchors.bAnchor) <= 0.01, true);
  assert.equal(impact.window.landingError, 0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='explicit B impact' test/cuefield-recipe-planner.test.js`

Expected: FAIL because `tease-roll-double-drop` and `bImpactOffset` do not exist.

- [ ] **Step 3: Extend landing diagnostics without changing existing recipes**

Use the explicit impact offset only when it is finite; otherwise retain the current handoff equation:

```js
const landingOffset = Number.isFinite(toNumber(anchors && anchors.bImpactOffset, NaN))
  ? toNumber(anchors.bImpactOffset)
  : toNumber(handoff && handoff.t, NaN);
const actualLanding = play && Number.isFinite(landingOffset)
  ? toNumber(play.at, NaN) + (landingOffset - toNumber(play.t, NaN))
  : NaN;
```

- [ ] **Step 4: Run focused and existing landing tests**

Run: `node --test --test-name-pattern='landing|impact' test/cuefield-recipe-planner.test.js`

Expected: existing landing tests PASS; the new test still fails only because the candidate is not implemented.

- [ ] **Step 5: Commit the landing primitive**

```bash
git add cuefield/recipe-planner.js test/cuefield-recipe-planner.test.js
git commit -m "feat(cuefield): separate impact landing from handoff"
```

### Task 2: Build And Gate The Composite Recipe

**Files:**
- Modify: `cuefield/recipe-planner.js:387-535,736-855`
- Test: `test/cuefield-recipe-planner.test.js`

- [ ] **Step 1: Add failing timeline and eligibility tests**

Build trusted Hook profiles with reliable musical evidence and assert:

```js
const impact = plan.candidates.find((candidate) => candidate.recipe === 'tease-roll-double-drop');
const bPlays = impact.timeline.filter((action) => action.deck === 'B' && action.op === 'play');
const loopBeats = impact.timeline.filter((action) => action.op === 'loop' && action.enabled !== false).map((action) => action.loopBeats);
const gap = impact.timeline.find((action) => action.optionalWhenLate === true);

assert.equal(bPlays.length, 2);
assert.deepEqual(loopBeats, [4, 2, 1, 0.5]);
assert.equal(gap.t >= -0.18 && gap.t <= -0.1, true);
assert.equal(impact.anchors.fakeOutMs >= 100 && impact.anchors.fakeOutMs <= 180, true);
assert.equal(impact.fallbackRecipe, 'bass-eq-handoff');
assert.equal(impact.eligible, true);
```

Add table-driven negative cases for fallback entry source, confidence below `.78`, tempo delta above `.06`, musical compatibility below `.72`, unsafe exit type, severe overlap risk, insufficient source runway, and `recentRecipes` containing the impact recipe.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern='tease roll|impact recipe' test/cuefield-recipe-planner.test.js`

Expected: FAIL because the candidate and gates are absent.

- [ ] **Step 3: Implement `makeTeaseRollDoubleDrop`**

Compute beat-relative loop stages but clamp the fake-out in milliseconds:

```js
function makeTeaseRollDoubleDrop(anchors, scores, assessment) {
  const impactAt = 0;
  const handoffAt = 0.6;
  const finalPlayAt = -1.6;
  const beat = clamp(60 / Math.max(40, assessment.bpmA), 0.25, 1.5);
  const fakeOutMs = 140;
  const finalBStart = Math.max(0, round(anchors.bAnchor - (impactAt - finalPlayAt)));
  const teaserAt = Math.max(0, round(anchors.bAnchor));
  const loopStart = Math.max(0, round(anchors.aExit - beat * 4));
  const fallback = makeBassHandoff(anchors, scores, assessment);

  const candidate = baseCandidate(
    'tease-roll-double-drop',
    0.42 + scores.beatScore * 0.12 + scores.energyScore * 0.1 + assessment.musicalCompatibility * 0.18,
    0.9,
    ['B hook teaser creates recognition', 'A source roll resolves into a full-band B impact'],
    ['high impact recipe'],
    { ...anchors, ...assessment, bStart: finalBStart, bImpactOffset: impactAt, fakeOutMs, teaserUsed: true, lead: 7.2 },
    [
      { t: -7.2, deck: 'B', op: 'play', at: teaserAt, volume: 0 },
      { t: -7.2, deck: 'B', op: 'filter', type: 'highpass', value: 1400, duration: 0 },
      { t: -7, deck: 'B', op: 'volume', value: 0.3, duration: 180 },
      { t: -6.35, deck: 'B', op: 'volume', value: 0, duration: 220 },
      { t: -6.1, deck: 'B', op: 'stop' },
      { t: -4 * beat, deck: 'A', op: 'loop', enabled: true, startAt: loopStart, bpm: assessment.bpmA, loopBeats: 4, slip: true },
      { t: -2 * beat, deck: 'A', op: 'loop', enabled: true, startAt: loopStart, bpm: assessment.bpmA, loopBeats: 2, slip: true },
      { t: finalPlayAt, deck: 'B', op: 'play', at: finalBStart, volume: 0 },
      { t: -beat, deck: 'A', op: 'loop', enabled: true, startAt: loopStart, bpm: assessment.bpmA, loopBeats: 1, slip: true },
      { t: -0.5 * beat, deck: 'A', op: 'loop', enabled: true, startAt: loopStart, bpm: assessment.bpmA, loopBeats: 0.5, slip: true },
      { t: -0.45, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 450 },
      { t: -0.45, deck: 'B', op: 'volume', value: 1, duration: 450, curve: 'equal-power-in' },
      { t: -0.14, deck: 'A', op: 'loop', enabled: false, slip: true },
      { t: -0.14, deck: 'A', op: 'volume', value: 0.06, duration: 80, optionalWhenLate: true, maxLateMs: 60 },
      { t: 0, deck: 'A', op: 'volume', value: 0, duration: 80, curve: 'equal-power-out' },
      { t: 0, deck: 'B', op: 'bass', value: 1, duration: 120 },
      { t: handoffAt, deck: 'B', op: 'handoff' },
    ],
  );
  candidate.fallbackTimeline = fallback.timeline;
  candidate.fallbackRecipe = fallback.recipe;
  return candidate;
}
```

- [ ] **Step 4: Add strict eligibility and cooldown**

In `recipeEligibility`, reject on each hard gate and only then apply a selection preference:

```js
if (candidate.recipe === 'tease-roll-double-drop') {
  if ((context.recentRecipes || []).includes(candidate.recipe)) return { eligible: false, reason: 'impact recipe cooldown', preference: 0 };
  if (route !== 'structure-mix' || !assessment.entryTrusted || !['hook', 'chorus', 'drop'].includes(String(context.entryType))) return { eligible: false, reason: 'landing is not a trusted climax', preference: 0 };
  if (context.entryConfidence < 0.78) return { eligible: false, reason: 'climax confidence is below impact threshold', preference: 0 };
  if (!assessment.exitTrusted || !['release', 'phrase-boundary', 'outro', 'natural-tail'].includes(assessment.exitType)) return { eligible: false, reason: 'exit is not loop safe', preference: 0 };
  if (!assessment.beatGridTrusted || assessment.relativeTempoDelta > 0.06) return { eligible: false, reason: 'beat or tempo evidence is unsafe', preference: 0 };
  if (!assessment.musicalEvidence || assessment.musicalCompatibility < 0.72) return { eligible: false, reason: 'musical evidence is not compatible enough', preference: 0 };
  if (severeOverlapRisk || assessment.sourceRunway < 2) return { eligible: false, reason: 'source roll runway is unsafe', preference: 0 };
  return { eligible: true, reason: '', preference: 0.56 };
}
```

Pass `recentRecipes`, `entryConfidence`, and the new candidate through `planRecipeCandidates`.

- [ ] **Step 5: Run focused and complete recipe tests**

Run: `node --test test/cuefield-recipe-planner.test.js`

Expected: all recipe planner tests PASS.

- [ ] **Step 6: Commit the composite planner**

```bash
git add cuefield/recipe-planner.js test/cuefield-recipe-planner.test.js
git commit -m "feat(cuefield): add gated impact combo recipe"
```

### Task 3: Propagate Two-Transition Cooldown Context

**Files:**
- Modify: `cuefield/transition-window-planner.js:600-680`
- Modify: `cuefield/mineradio-bridge.js:250-310`
- Modify: `server.js:3336-3375`
- Modify: `public/index.html:10500-10575,12035-12070`
- Test: `test/cuefield-transition-window-planner.test.js`
- Test: `test/cuefield-mineradio-bridge.test.js`
- Test: `test/cuefield-musical-integration.test.js`

- [ ] **Step 1: Write failing propagation tests**

Assert that `recentRecipes: ['tease-roll-double-drop']` prevents the impact candidate from being selected, while an empty history leaves it eligible. Add an integration test asserting the POST body contains at most two recipe strings and no song/audio metadata beyond the existing payload.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test test/cuefield-transition-window-planner.test.js test/cuefield-mineradio-bridge.test.js test/cuefield-musical-integration.test.js
```

Expected: FAIL because history is not forwarded.

- [ ] **Step 3: Add bounded history plumbing**

Use one normalization rule at each trust boundary:

```js
const recentRecipes = Array.isArray(opts.recentRecipes)
  ? opts.recentRecipes.slice(-2).map((value) => String(value || '').slice(0, 80)).filter(Boolean)
  : [];
```

Pass it from `server.js` to `planCuefieldTransitionFromCache`, then to `chooseTransitionWindow`, and finally to `planRecipeCandidates`.

In the renderer, maintain only successful executions:

```js
var cuefieldRecentRecipes = [];

function rememberCuefieldRecipe(recipe) {
  recipe = String(recipe || '').slice(0, 80);
  if (!recipe) return;
  cuefieldRecentRecipes = cuefieldRecentRecipes.concat(recipe).slice(-2);
}
```

Include `recentRecipes: cuefieldRecentRecipes.slice()` in the request body and call `rememberCuefieldRecipe(...)` only after `playQueueAt` finishes the handoff.

- [ ] **Step 4: Make pair-plan cache cooldown-aware**

Add a stable cooldown suffix so an old impact plan is not reused during cooldown:

```js
var cooldownKey = cuefieldRecentRecipes.includes('tease-roll-double-drop') ? ':impact-blocked' : ':impact-open';
var cacheKey = fromKey + '->' + toKey + ':' + cacheKind + cooldownKey;
```

- [ ] **Step 5: Run propagation tests**

Expected: all three focused test files PASS.

- [ ] **Step 6: Commit cooldown plumbing**

```bash
git add cuefield/transition-window-planner.js cuefield/mineradio-bridge.js server.js public/index.html test/cuefield-transition-window-planner.test.js test/cuefield-mineradio-bridge.test.js test/cuefield-musical-integration.test.js
git commit -m "feat(cuefield): enforce impact transition cooldown"
```

### Task 4: Skip Unsafe Late Fake-Outs At Runtime

**Files:**
- Modify: `public/cuefield-timeline-executor.js:80-160`
- Modify: `public/index.html:11490-11510,11915-11970`
- Test: `test/cuefield-timeline-executor.test.js`
- Test: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing normalization and scheduler tests**

Assert that the executor clamps and preserves:

```js
assert.equal(action.optionalWhenLate, true);
assert.equal(action.maxLateMs, 60);
```

Extract a pure lateness decision in the renderer test harness and assert an action scheduled `61ms` late is skipped, while the mandatory impact volume action still executes.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/cuefield-timeline-executor.test.js test/cuefield-feedback-stats-ui.test.js`

Expected: FAIL because optional lateness metadata is discarded.

- [ ] **Step 3: Preserve bounded optional-action metadata**

In `normalizeAction`:

```js
normalized.optionalWhenLate = action.optionalWhenLate === true;
normalized.maxLateMs = Math.round(clamp(toNumber(action.maxLateMs, 0), 0, 200));
```

- [ ] **Step 4: Add the runtime late guard**

Capture the intended deadline before scheduling:

```js
var dueAt = performance.now() + action.delayMs;
cuefieldScheduleTimeline(action.delayMs, function() {
  var lateBy = Math.max(0, performance.now() - dueAt);
  if (action.optionalWhenLate && lateBy > action.maxLateMs) {
    pending.runtimeDowngrade = 'late-fake-gap-skipped';
    return;
  }
  applyCuefieldTimelineAction(action, pending, nextMedia);
});
```

The mandatory A-to-zero and B-bass actions remain non-optional, so skipping the gap cannot leave both tracks loud or muted.

- [ ] **Step 5: Run runtime tests**

Expected: focused tests PASS, including cancellation and single-handoff contracts.

- [ ] **Step 6: Commit runtime protection**

```bash
git add public/cuefield-timeline-executor.js public/index.html test/cuefield-timeline-executor.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "fix(cuefield): skip late impact fake-outs"
```

### Task 5: Record Compact Impact Diagnostics

**Files:**
- Modify: `public/index.html:10635-10690`
- Modify: `cuefield/feedback-log.js:170-210`
- Test: `test/cuefield-feedback-log.test.js`
- Test: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing feedback tests**

Create a pending impact transition and assert the sanitized record contains only:

```js
{
  impactEligible: true,
  teaserUsed: true,
  fakeOutMs: 140,
  impactFallbackRecipe: 'bass-eq-handoff',
  runtimeDowngrade: ''
}
```

Also assert `fakeOutMs` is finite and clamped to `0..200`, and legacy feedback remains readable.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js`

Expected: FAIL because impact diagnostics are not collected.

- [ ] **Step 3: Add renderer feedback context fields**

Read from `chosen.recipeCandidate` and pending runtime state:

```js
impactEligible: candidate.recipe === 'tease-roll-double-drop' && candidate.eligible !== false,
teaserUsed: candidate.anchors && candidate.anchors.teaserUsed === true,
fakeOutMs: candidate.anchors && candidate.anchors.fakeOutMs,
impactFallbackRecipe: candidate.fallbackRecipe || '',
runtimeDowngrade: pending.runtimeDowngrade || '',
```

- [ ] **Step 4: Sanitize the compact fields**

Use existing compact helpers; clamp `fakeOutMs` to an integer `0..200` and bound recipe strings to `80` characters. Do not store timeline actions, lyric text, URLs, profiles, or audio data.

- [ ] **Step 5: Run feedback tests and commit**

```bash
node --test test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
git add public/index.html cuefield/feedback-log.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "feat(cuefield): record impact execution diagnostics"
```

### Task 6: Full Verification And Listening Checkpoint

**Files:**
- Modify only if required by a demonstrated regression.
- Do not stage or alter the pre-existing `desktop/main.js` change.

- [ ] **Step 1: Run syntax and whitespace checks**

```bash
node --check cuefield/recipe-planner.js
node --check cuefield/transition-window-planner.js
node --check cuefield/mineradio-bridge.js
node --check cuefield/feedback-log.js
node --check server.js
node --check public/cuefield-timeline-executor.js
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 2: Run the complete automated suite**

Run: `node --test test/*.test.js`

Expected: all tests PASS with `0 fail`; the current baseline before this work is `346/346`.

- [ ] **Step 3: Restart Mineradio and verify the local server**

Stop only the `npm start` process whose command path belongs to this worktree, restart with `npm start`, and verify:

```bash
curl -fsS http://127.0.0.1:3000/ >/dev/null
```

Expected: HTTP request exits `0` and Electron listens on `127.0.0.1:3000`.

- [ ] **Step 4: Perform three listening cases**

1. Strong positively rated pair: verify teaser recognition, accelerating A roll, bounded gap, and B impact.
2. Similar-style qualifying pair: verify the recipe sounds deliberate rather than merely louder.
3. Rejected contrast pair: verify deterministic Bass Handoff or Echo Out fallback with no fake gap.

Record ratings and typed notes through the existing feedback prompt. Do not hand-edit the JSONL file.

- [ ] **Step 5: Inspect execution evidence**

Confirm the feedback record reports `teaserUsed`, `fakeOutMs`, fallback recipe, and any runtime downgrade. Confirm the second transition after a successful impact does not select another impact recipe.

- [ ] **Step 6: Commit only demonstrated fixes, then report**

If verification required a code fix, commit the focused files with a specific message. Otherwise do not create an empty commit. Report the final test count, listening outcomes, current local URL, and any remaining uncommitted file boundaries.

## Scope Guard

- Do not add stems, pitch shifting, time stretching, synthetic bridge audio, or UI controls.
- Do not change queue ordering or public deployment.
- Do not weaken first-Hook protection, minimum listening time, local musical clash rejection, or single-handoff behavior.
- Do not stage `desktop/main.js`.

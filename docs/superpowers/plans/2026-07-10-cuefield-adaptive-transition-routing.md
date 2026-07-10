# Cuefield Adaptive Transition Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every technically playable A -> B pair select and execute a route-appropriate transition, including late contrast handling and terminal rescue.

**Architecture:** Add a pure relationship router before window ranking. The transition-window planner uses the returned policy to constrain exits and rank entries, then generates Terminal Rescue when no structural window survives. The Mineradio bridge, AutoMix, and feedback path propagate the selected route and execute it without treating musical incompatibility as a fallback.

**Tech Stack:** CommonJS Node modules, browser UMD AutoMix runtime, Node `node:test`, Mineradio Web Audio gain/filter/bass timeline executor.

---

## File Map

- Create `cuefield/transition-router.js`: pure relationship metrics and route policy selection.
- Create `test/cuefield-transition-router.test.js`: synthetic relationship classification tests.
- Modify `cuefield/transition-window-planner.js`: route-constrained exits, entry preference, ranking, and Terminal Rescue.
- Modify `cuefield/recipe-planner.js`: route-specific overlap limits for existing executable recipes.
- Modify `test/cuefield-transition-window-planner.test.js`: route/window and universal fallback tests.
- Modify `cuefield/mineradio-bridge.js`: expose compact route diagnostics.
- Modify `public/cuefield-automix.js`: accept Terminal Rescue as an intentional executable route.
- Modify `cuefield/feedback-log.js`: sanitize and persist routing fields.
- Modify `public/index.html`: pass route fields into feedback context and replace musical fallback wording.
- Modify focused tests under `test/` for bridge, AutoMix, feedback, and UI status.
- Preserve the unrelated uncommitted `desktop/main.js` platform ANGLE change.

### Task 1: Relationship Router

**Files:**
- Create: `cuefield/transition-router.js`
- Create: `test/cuefield-transition-router.test.js`

- [ ] **Step 1: Write failing route-classification tests**

Create profile helpers with bars around supplied exits and entries, then assert these policies:

```js
const { classifyTransitionRoute } = require('../cuefield/transition-router');

test('routes a large snap rise into a late controlled build', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.27, energy: 0.72 }]),
    toProfile: profile(220, 88, [{ start: 106, snapDensity: 0.53, energy: 0.58 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'hook', confidence: 0.88 }],
    risks: [],
  });
  assert.equal(policy.route, 'late-contrast-rise');
  assert.deepEqual(policy.preferredExitRange, [0.75, 0.9]);
  assert.equal(policy.overlapClass, 'short');
});

test('does not route late from directionality mismatch alone', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 115, [{ start: 73, snapDensity: 0.38, energy: 0.61 }]),
    toProfile: profile(212, 100, [{ start: 31, snapDensity: 0.28, energy: 0.72 }]),
    exits: [{ time: 73, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 31, landingType: 'hook', confidence: 0.88 }],
    risks: ['directionality mismatch'],
  });
  assert.equal(policy.route, 'structure-mix');
});

test('routes a large snap release into a late energy release', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 128, [{ start: 150, snapDensity: 0.55, energy: 0.82 }]),
    toProfile: profile(230, 96, [{ start: 18, snapDensity: 0.22, energy: 0.48 }]),
    exits: [{ time: 150, type: 'release', confidence: 0.76 }],
    entries: [{ landingAt: 18, landingType: 'intro', confidence: 0.8 }],
    risks: [],
  });
  assert.equal(policy.route, 'late-contrast-release');
  assert.deepEqual(policy.preferredExitRange, [0.72, 0.9]);
});

test('routes missing structural evidence into terminal rescue', () => {
  const policy = classifyTransitionRoute({ fromProfile: profile(180), toProfile: profile(210), exits: [], entries: [] });
  assert.equal(policy.route, 'terminal-rescue');
  assert.deepEqual(policy.preferredExitRange, [0.88, 0.96]);
});
```

- [ ] **Step 2: Run the router test and verify RED**

Run:

```bash
node --test test/cuefield-transition-router.test.js
```

Expected: FAIL because `cuefield/transition-router.js` does not exist.

- [ ] **Step 3: Implement the pure router**

Export `classifyTransitionRoute(opts)`. Sample the nearest bar to the representative release and trusted entry. Compute:

```js
const snapDelta = b.snapDensity - a.snapDensity;
const energyDelta = b.energy - a.energy;
const hasStructure = exits.length > 0 && entries.length > 0;
const urgentRise = b.snapDensity >= 0.42 && snapDelta >= 0.18;
const urgentRelease = a.snapDensity >= 0.42 && snapDelta <= -0.18;
```

Return one of these complete policies:

```js
{
  route: 'structure-mix',
  compatibilityClass: 'compatible',
  contrastDirection: 'balanced',
  preferredExitRange: [protectedRatio, 0.78],
  entryPolicy: 'best-supported',
  overlapClass: 'adaptive',
  recipe: 'structure-window',
  reasons: [],
}
```

Use `[0.75, 0.90]`, `contrast`, `rising`, `filtered-runway`, `short`, and `late-contrast-rise` for urgent rise; `[0.72, 0.90]`, `contrast`, `falling`, `quiet-runway`, `short-or-medium`, and `late-contrast-release` for urgent release; `[0.88, 0.96]`, `uncertain`, `unknown`, `start-or-downbeat`, `short`, and `terminal-rescue` when structural evidence is absent. Include finite compact metrics in `policy.metrics` for tests and feedback. A single risk string must not select a route.

- [ ] **Step 4: Run the router test and verify GREEN**

Run `node --test test/cuefield-transition-router.test.js`.

Expected: all router tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add cuefield/transition-router.js test/cuefield-transition-router.test.js
git commit -m "Classify Cuefield transition routes"
```

### Task 2: Route-Constrained Window Planning And Terminal Rescue

**Files:**
- Modify: `cuefield/transition-window-planner.js`
- Modify: `cuefield/recipe-planner.js`
- Modify: `test/cuefield-transition-window-planner.test.js`
- Modify: `test/cuefield-recipe-planner.test.js`

- [ ] **Step 1: Write failing planner tests**

Add tests that inject profiles/candidates with known bar metrics:

```js
test('late contrast rise cannot choose an early high-scoring exit', () => {
  const result = chooseTransitionWindow(fromAnalysis, urgentToAnalysis);
  assert.equal(result.policy.route, 'late-contrast-rise');
  assert.equal(result.chosen.exitRatio >= 0.75, true);
  assert.equal(result.chosen.exitRatio <= 0.9, true);
  assert.equal(result.chosen.audibleOverlap <= 3.5, true);
});

test('structure mix retains an early usable post-hook exit', () => {
  const result = chooseTransitionWindow(fromAnalysis, compatibleToAnalysis);
  assert.equal(result.policy.route, 'structure-mix');
  assert.equal(result.chosen.exitRatio < 0.75, true);
});

test('terminal rescue always returns an executable late timeline', () => {
  const result = chooseTransitionWindow(noExitAnalysis, noEntryAnalysis);
  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.chosen.exitRatio >= 0.88, true);
  assert.equal(result.chosen.mixStart < result.chosen.handoffAt, true);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'handoff'), true);
});
```

- [ ] **Step 2: Run planner tests and verify RED**

Run `node --test test/cuefield-transition-window-planner.test.js`.

Expected: FAIL because the planner does not return `policy` and still allows early windows.

- [ ] **Step 3: Integrate policy before ranking**

Import `classifyTransitionRoute`. After computing source exits and landing options, classify once. Restrict exits to the policy range when at least one in-range exit exists:

```js
function exitsForPolicy(exits, duration, policy) {
  const [minRatio, maxRatio] = policy.preferredExitRange;
  const inRange = exits.filter((exit) => {
    const ratio = toNumber(exit.time) / Math.max(1, duration);
    return ratio >= minRatio && ratio <= maxRatio;
  });
  return inRange.length ? inRange : exits;
}
```

Pass `policy` into `planRecipeCandidates` as `routePolicy` and into `rankWindow`. In `recipe-planner.js`, force `overlapClass: 'short'` for `late-contrast-rise` and Terminal Rescue, while `late-contrast-release` may use short or medium only. Add a range-distance penalty in window ranking. For `late-contrast-rise`, prefer pre-Hook/intro/runway entries over direct dense Hook entries. Preserve existing credible-Hook checks.

- [ ] **Step 4: Replace start fallback with Terminal Rescue**

Build a real late exit from the latest complete release or phrase inside `[0.88, 0.96]`. If none exists, synthesize a safe boundary at:

```js
const mixStart = Math.max(protectedUntil, Math.min(duration - 3.6, duration * 0.92));
```

Return entry `{ type: 'start', playFrom: 0, landingAt: 3.4, landingType: 'start' }` and this executable timeline:

```js
[
  { t: 0, deck: 'B', op: 'play', at: 0, volume: 0 },
  { t: 0, deck: 'B', op: 'bass', value: 0.2, duration: 0 },
  { t: 0, deck: 'B', op: 'volume', value: 1, duration: 3400, curve: 'equal-power-in' },
  { t: 0, deck: 'A', op: 'volume', value: 0, duration: 3400, curve: 'equal-power-out' },
  { t: 2.4, deck: 'B', op: 'bass', value: 1, duration: 800 },
  { t: 3.4, deck: 'B', op: 'handoff' },
]
```

The result must include `routeFallbackUsed: true` and retain compact rejection reasons from failed structural windows.

- [ ] **Step 5: Run planner and recipe regressions**

Run:

```bash
node --test test/cuefield-transition-window-planner.test.js test/cuefield-recipe-planner.test.js
```

Expected: all tests PASS; false-Hook and landing checks remain green.

- [ ] **Step 6: Commit Task 2**

```bash
git add cuefield/transition-window-planner.js cuefield/recipe-planner.js test/cuefield-transition-window-planner.test.js test/cuefield-recipe-planner.test.js
git commit -m "Route Cuefield transition windows"
```

### Task 3: Bridge, AutoMix, UI Status, And Feedback Diagnostics

**Files:**
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `public/cuefield-automix.js`
- Modify: `cuefield/feedback-log.js`
- Modify: `public/index.html`
- Modify: `test/cuefield-mineradio-bridge.test.js`
- Modify: `test/cuefield-automix.test.js`
- Modify: `test/cuefield-feedback-log.test.js`
- Modify: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing integration tests**

Assert the bridge copies `policy` into chosen and diagnostics using only compact values. Assert AutoMix accepts `terminal-rescue` when `allowSafetyFallback` is enabled even if its evaluation tier is weak and score is below the weak threshold. Assert feedback records:

```js
{
  route: 'late-contrast-rise',
  compatibilityClass: 'contrast',
  contrastDirection: 'rising',
  preferredExitRange: [0.75, 0.9],
  routeReasons: ['snap rise'],
  routeFallbackUsed: false,
}
```

Assert the UI status map no longer contains `这两首暂不适合自动切`; use `正在准备末尾保底过渡` for a musical rescue state while retaining technical error messages.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-automix.test.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
```

Expected: FAIL on missing routing fields and Terminal Rescue execution support.

- [ ] **Step 3: Propagate compact route data**

In the bridge, copy `windowPlan.policy` to `chosen.policy` and add route fields to transition diagnostics. Do not include full profiles or raw lyrics. In feedback sanitization, bound route strings to existing compact limits, retain at most four route reasons, and normalize the two-element exit range to finite `[0, 1]` values.

- [ ] **Step 4: Make Terminal Rescue executable**

In `isExecutablePlan`, treat `terminal-rescue` like the existing honest safety fallback:

```js
if (recipe === 'terminal-rescue') {
  return !!deps.allowSafetyFallback && Array.isArray(chosen.timeline) && chosen.timeline.length > 0;
}
```

Keep technical `missing-audio`, `waiting-beatmap`, and preparation error behavior unchanged. Replace only the musical fallback status copy.

- [ ] **Step 5: Run focused integration tests and verify GREEN**

Run the Step 2 command again.

Expected: all focused tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add cuefield/mineradio-bridge.js public/cuefield-automix.js cuefield/feedback-log.js public/index.html test/cuefield-mineradio-bridge.test.js test/cuefield-automix.test.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "Execute Cuefield adaptive routes"
```

### Task 4: Full Regression, Real-Data Audit, And Listening Restart

**Files:**
- Modify only files required by regressions caused by Tasks 1-3.
- Do not commit `data/`, cache files, generated audit output, or `desktop/main.js`.

- [ ] **Step 1: Run the complete test suite**

```bash
node --test test/cuefield*.test.js test/beatmap-cache-path.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run syntax and scope checks**

```bash
node --check cuefield/transition-router.js
node --check cuefield/transition-window-planner.js
node --check cuefield/mineradio-bridge.js
node --check public/cuefield-automix.js
node --check cuefield/feedback-log.js
git diff --check
git status --short
```

Expected: checks exit `0`; only the existing unrelated `desktop/main.js` remains uncommitted.

- [ ] **Step 3: Replan real rated pairs through the local endpoint**

Print compact route diagnostics for:

- `Believe In Me -> Killing Me`;
- `Killing Me -> Fortress`;
- `Fortress -> 春娇与志明`.

Expected:

- the first pair remains executable and is not forced late solely by `directionality mismatch`;
- `Killing Me -> Fortress` selects `late-contrast-rise`, exits within `0.75-0.90`, and uses short overlap;
- a pair without a valid structural window selects executable `terminal-rescue` instead of musical fallback;
- all `mixStart` values remain after the protected first Hook.

- [ ] **Step 4: Run final whole-change review**

Review the complete range from `89284c6` to HEAD for route correctness, false-Hook regressions, timing safety, feedback privacy, and scope. Fix all blocking or important findings and rerun Steps 1-3.

- [ ] **Step 5: Restart Mineradio from the feature worktree**

Stop only the existing Electron process whose command points to this worktree. Restart via macOS LaunchServices:

```bash
open -na "/Users/sly/Documents/Codex/2026-07-08/Mineradio/node_modules/electron/dist/Electron.app" --args "/Users/sly/Documents/Codex/2026-07-08/Mineradio/.worktrees/cuefield-structure-map-foundation"
```

Verify the process command points to the feature worktree and `http://127.0.0.1:3000/` returns `200`.

- [ ] **Step 6: Report the listening target**

Ask the user to listen specifically for whether route choice is correct before judging advanced transition polish: compatible pair timing, lyrical -> urgent late timing, and Terminal Rescue continuity. Do not push, deploy, or publish.

# Cuefield Recipe Diversity And Echo Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cuefield select distinct transition techniques by musical conditions and add a bounded, failure-safe Echo Out effect for difficult late transitions.

**Architecture:** Keep relationship routing and transition-window timing intact. Replace the recipe planner's blanket safety override with explicit eligibility and route preferences, add an Echo Out candidate, then extend the browser timeline executor and per-deck Web Audio graph with a dry-independent delay branch. Every Echo timeline carries a gain/EQ fallback, and terminal rescue retains its route identity.

**Tech Stack:** CommonJS Node modules, browser UMD runtime, Node `node:test`, Web Audio API, Electron HTML runtime.

---

## File Map

- Modify `cuefield/recipe-planner.js`: recipe eligibility, Echo Out candidate, deterministic selection diagnostics.
- Modify `cuefield/transition-window-planner.js`: allow route-appropriate recipes and add Echo to eligible terminal rescue timelines.
- Modify `public/cuefield-timeline-executor.js`: normalize bounded Echo actions and expose graph requirements.
- Modify `public/index.html`: construct, control, reset, and release each deck's echo branch; apply Echo timeline actions.
- Modify `test/cuefield-recipe-planner.test.js`: recipe-selection and fallback regressions.
- Modify `test/cuefield-transition-window-planner.test.js`: route-filter and terminal Echo regressions.
- Modify `test/cuefield-timeline-executor.test.js`: action normalization and downgrade regressions.
- Modify `test/cuefield-playback-handoff.test.js`: Web Audio graph lifecycle and runtime action contract.
- Modify `CURRENT_STATE.md`: final verified state and next listening step.
- Preserve the unrelated uncommitted `desktop/main.js` Metal change.

### Task 1: Recipe Eligibility And Echo Candidate

**Files:**
- Modify: `test/cuefield-recipe-planner.test.js`
- Modify: `cuefield/recipe-planner.js`

- [ ] **Step 1: Write failing recipe-selection tests**

Add assertions covering these behaviors with existing `makeProfile` fixtures:

```js
test('selects filtered pickup for a controlled late energy rise', () => {
  const plan = planRecipeCandidates(fromProfile, urgentToProfile, {
    sectionChoice: controlledChoice,
    routePolicy: { route: 'late-contrast-rise', contrastDirection: 'rising' },
  });
  assert.equal(plan.chosen.recipe, 'filtered-pickup');
  assert.equal(plan.diagnostics.eligibleRecipes.includes('filtered-pickup'), true);
});

test('selects echo out when sustained overlap is unsafe', () => {
  const plan = planRecipeCandidates(fromProfile, urgentToProfile, {
    sectionChoice: riskyChoice,
    routePolicy: { route: 'late-contrast-rise', compatibilityClass: 'contrast' },
  });
  assert.equal(plan.chosen.recipe, 'echo-out');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'echo'), true);
  assert.equal(Array.isArray(plan.chosen.fallbackTimeline), true);
});

test('uses quick fade when echo and sustained overlap lack runway', () => {
  const plan = planRecipeCandidates(fromProfile, shortRunwayProfile, {
    sectionChoice: shortRunwayChoice,
    routePolicy: { route: 'late-contrast-rise', compatibilityClass: 'contrast' },
  });
  assert.equal(plan.chosen.recipe, 'quick-safe-fade');
});
```

Update old assertions that encoded the blanket safety behavior so they assert an executable conservative recipe and the expected overlap class instead of requiring `safety-long-blend` by name.

- [ ] **Step 2: Run the recipe test and verify RED**

Run:

```bash
node --test test/cuefield-recipe-planner.test.js
```

Expected: FAIL because `echo-out`, `eligibleRecipes`, and eligibility-based selection do not exist.

- [ ] **Step 3: Implement the Echo candidate and eligibility rules**

Add `makeEchoOut(anchors, scores, assessment)` with a `3.4s` B pre-roll, an A Echo action at `-2s`, a bass reduction, equal-power handoff, and `fallbackTimeline` from the short safety execution. Echo parameters are fixed to safe defaults and include A BPM:

```js
{ t: -2, deck: 'A', op: 'echo', enabled: true, bpm: assessment.bpmA, delayBeats: 0.5, feedback: 0.56, wet: 0.34, duration: 180 }
{ t: 0.2, deck: 'A', op: 'echo', enabled: false, bpm: assessment.bpmA, delayBeats: 0.5, feedback: 0.56, wet: 0.34, duration: 160 }
```

Add a pure eligibility function that returns `{ eligible, reason, preference }` for each candidate. Use the approved thresholds: Long Blend `<= 0.08` tempo delta and long overlap; Bass Handoff `<= 0.12` and medium/long; Filtered Pickup for rising contrast with at least `3.4s` landing runway; Echo Out for late contrast/terminal or severe style risk with at least `2.4s`; Quick Fade whenever its landing equation is valid. Safety remains fallback-only.

Choose the highest `score + preference` eligible valid candidate. If none are valid, return safety as degraded output. Add `eligibleRecipes` and compact `rejectedRecipes` diagnostics.

- [ ] **Step 4: Run recipe tests and verify GREEN**

Run `node --test test/cuefield-recipe-planner.test.js`.

Expected: all recipe tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add cuefield/recipe-planner.js test/cuefield-recipe-planner.test.js
git commit -m "Diversify Cuefield transition recipes"
```

### Task 2: Route Filtering And Terminal Echo

**Files:**
- Modify: `test/cuefield-transition-window-planner.test.js`
- Modify: `cuefield/transition-window-planner.js`

- [ ] **Step 1: Write failing route integration tests**

Add tests proving late rise accepts `filtered-pickup`, `echo-out`, and `quick-safe-fade` while rejecting long overlap; compatible structure routing still considers long blend and bass handoff. Extend the terminal rescue test:

```js
assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
assert.equal(result.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'echo'), true);
assert.equal(Array.isArray(result.chosen.recipeCandidate.fallbackTimeline), true);
```

- [ ] **Step 2: Run the transition-window test and verify RED**

Run:

```bash
node --test test/cuefield-transition-window-planner.test.js
```

Expected: FAIL because late rise currently admits only safety and terminal rescue has no Echo action.

- [ ] **Step 3: Implement route filtering and terminal Echo**

Change late-rise filtering to admit `filtered-pickup`, `echo-out`, `quick-safe-fade`, and short safety candidates, still rejecting candidates whose audible overlap exceeds `3.5s`. Keep release overlap capped at `6s`.

For terminal rescue with at least `2.4s` overlap, insert bounded A Echo enable/disable actions around the existing equal-power fade. Preserve `recipe: 'terminal-rescue'`, route diagnostics, and the original no-Echo timeline in `fallbackTimeline`.

- [ ] **Step 4: Run planner integration tests and verify GREEN**

Run:

```bash
node --test test/cuefield-transition-window-planner.test.js test/cuefield-recipe-planner.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add cuefield/transition-window-planner.js test/cuefield-transition-window-planner.test.js
git commit -m "Route Cuefield transition techniques"
```

### Task 3: Timeline And Web Audio Echo Runtime

**Files:**
- Modify: `test/cuefield-timeline-executor.test.js`
- Modify: `test/cuefield-playback-handoff.test.js`
- Modify: `public/cuefield-timeline-executor.js`
- Modify: `public/index.html`

- [ ] **Step 1: Write failing timeline normalization tests**

Add an Echo action with out-of-range inputs and assert normalization:

```js
const echo = execution.actions.find((action) => action.op === 'echo');
assert.equal(echo.delayMs, 600);
assert.equal(echo.delayBeats, 0.5);
assert.equal(echo.feedback, 0.72);
assert.equal(echo.wet, 0.5);
assert.equal(echo.bpm, 120);
assert.equal(execution.requiresAGraph, true);
```

Assert `buildVolumeOnlyCuefieldExecution` contains no Echo actions.

- [ ] **Step 2: Write failing browser graph contract tests**

In `cuefield-playback-handoff.test.js`, assert the Cuefield graph creates `echoSend`, `echoDelay`, `echoFeedback`, and `echoWet`; connects a feedback loop and wet output around dry gain; disconnects all four nodes; applies `action.op === 'echo'`; and resets Echo controls during graph adoption/cancellation.

- [ ] **Step 3: Run focused runtime tests and verify RED**

Run:

```bash
node --test test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js
```

Expected: FAIL because Echo normalization and graph nodes do not exist.

- [ ] **Step 4: Normalize Echo actions**

In `normalizeAction`, copy `enabled`, clamp `bpm` to `40...240` with `120` fallback, `delayBeats` to `0.125...2`, `feedback` to `0...0.72`, and `wet` to `0...0.5`. Add `requiresAGraph` and include Echo in B graph requirements. Runtime downgrade remains gain-only and therefore strips Echo naturally.

- [ ] **Step 5: Build and control the Echo graph**

Extend both ordinary and prepared deck graphs with four Gain/Delay nodes. Connect the echo send from the post-tone, pre-dry-gain signal; connect Delay to wet output and feedback through a bounded feedback gain; connect wet output directly to destination. Initialize and reset send, feedback, and wet to zero.

Add `rampCuefieldGraphEcho(graph, action)` that computes `delaySeconds = clamp(60 / bpm * delayBeats, 0.08, 0.75)`, ramps Delay time and bounded gains, and closes only the input send when disabled so buffered repeats decay. Apply it for A and B actions. If nodes are missing, return without throwing and let volume actions complete the handoff.

- [ ] **Step 6: Run focused runtime tests and verify GREEN**

Run:

```bash
node --test test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add public/cuefield-timeline-executor.js public/index.html test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js
git commit -m "Execute Cuefield echo out transitions"
```

### Task 4: Regression, Distribution, And Handoff

**Files:**
- Modify: `CURRENT_STATE.md`

- [ ] **Step 1: Run focused Cuefield tests**

Run:

```bash
node --test test/cuefield-recipe-planner.test.js test/cuefield-transition-window-planner.test.js test/cuefield-timeline-executor.test.js test/cuefield-playback-handoff.test.js test/cuefield-automix.test.js test/cuefield-mineradio-bridge.test.js test/cuefield-feedback-log.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the complete test suite and static checks**

Run:

```bash
node --test test/*.test.js
git diff --check
```

Expected: all tests PASS and no whitespace errors.

- [ ] **Step 3: Restart Mineradio and verify HTTP health**

Stop only the existing Mineradio process owned by this worktree, start it again with its established command, and verify:

```bash
curl -sS -I --max-time 3 http://127.0.0.1:3000
```

Expected: HTTP `200`. Do not alter unrelated processes.

- [ ] **Step 4: Recalculate current real-song recipe distribution**

Request every unique pair in the local feedback file from the restarted transition endpoint and print route, recipe, exit ratio, overlap, and Echo presence:

```bash
node - <<'NODE'
const fs = require('node:fs');
const rows = fs.readFileSync('data/cuefield-feedback.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const pairs = [...new Map(rows.map((row) => [`${row.pair.fromKey}->${row.pair.toKey}`, row.pair])).values()];
(async () => {
  for (const pair of pairs) {
    const response = await fetch('http://127.0.0.1:3000/api/cuefield/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromKey: pair.fromKey, toKey: pair.toKey }),
    });
    const result = await response.json();
    const chosen = result.chosen || {};
    console.log(JSON.stringify({
      pair: `${pair.fromTitle} -> ${pair.toTitle}`,
      route: chosen.policy && chosen.policy.route || chosen.route,
      recipe: chosen.transitionRecipe || chosen.recipeCandidate && chosen.recipeCandidate.recipe,
      exitRatio: chosen.exitRatio,
      overlap: chosen.audibleOverlap,
      echo: (chosen.timeline || []).some((action) => action.op === 'echo'),
    }));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

Confirm the planner uses multiple techniques when evidence supports them and never violates route timing or Hook protection. Do not force an arbitrary recipe count if the real cached evidence does not support it.

- [ ] **Step 5: Update the checkpoint**

Replace `CURRENT_STATE.md` with at most 30 lines recording implementation, test count, real-song distribution, the listening URL, and the unchanged publication/deployment boundary.

- [ ] **Step 6: Commit the checkpoint**

```bash
git add CURRENT_STATE.md
git commit -m "Checkpoint Cuefield echo out listening"
```

- [ ] **Step 7: Verify final scope**

Run `git status --short` and `git log -5 --oneline`. Confirm the only remaining dirty path is the pre-existing `desktop/main.js`, and do not push or deploy.

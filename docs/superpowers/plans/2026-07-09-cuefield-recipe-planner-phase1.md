# Cuefield Recipe Planner Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Cuefield recipe-planner API that emits cue profiles, multiple recipe candidates, and action timelines while preserving the existing `/api/cuefield/transition` response shape.

**Architecture:** Keep analysis and planning in focused CommonJS modules under `cuefield/`. `cue-profile.js` derives cue points, bars, phrases, and density windows from existing Mineradio beatmaps. `recipe-planner.js` evaluates four MVP recipes and returns `candidates[]` plus a backward-compatible `chosen`.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, existing Cuefield beatmap and section-candidate modules.

---

### Task 1: Cue Profile Module

**Files:**
- Create: `cuefield/cue-profile.js`
- Test: `test/cuefield-recipe-planner.test.js`

- [x] **Step 1: Write failing tests**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCueProfile } = require('../cuefield/cue-profile');

function makeBeatMap(duration = 128, gridStep = 0.5) {
  const beats = [];
  for (let time = 0, index = 0; time < duration; time += gridStep, index++) {
    beats.push({
      time,
      confidence: 0.9,
      phrase: index % 32 === 0,
      downbeat: index % 4 === 0,
      low: time >= duration - 16 ? 0.22 : 0.46,
      body: time >= duration - 16 ? 0.25 : 0.42,
      snap: index % 4 === 0 ? 0.62 : 0.28,
      impact: index % 4 === 0 ? 0.68 : 0.34,
    });
  }
  return { duration, gridStep, beats };
}

test('builds cue profile bars, cue points, and density windows from beatmap data', () => {
  const profile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(),
    candidates: [
      { type: 'outro', role: 'exit', time: 112, confidence: 0.7 },
      { type: 'intro', role: 'entry', time: 8, confidence: 0.6 },
    ],
  });

  assert.equal(profile.duration, 128);
  assert.equal(profile.downbeats.length > 20, true);
  assert.equal(profile.bars.length > 20, true);
  assert.equal(profile.cuePoints.outroStart, 112);
  assert.equal(profile.cuePoints.introStart, 8);
  assert.equal(profile.windows.bass.length > 0, true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/cuefield-recipe-planner.test.js`

Expected: fails because `../cuefield/cue-profile` does not exist.

- [x] **Step 3: Implement `buildCueProfile`**

Create `cuefield/cue-profile.js` with:

```js
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function buildCueProfile(input = {}) {
  // Implementation derives beats, downbeats, bars, phrases, cue points, and windows.
}

module.exports = { buildCueProfile };
```

- [x] **Step 4: Verify test passes**

Run: `node --test test/cuefield-recipe-planner.test.js`

Expected: all tests in this file pass.

### Task 2: Recipe Planner Module

**Files:**
- Create: `cuefield/recipe-planner.js`
- Modify: `test/cuefield-recipe-planner.test.js`

- [x] **Step 1: Write failing tests for recipe candidates**

Add tests that verify:

- planner returns `candidates[]`
- `intro-outro-long-blend`, `filtered-pickup`, `bass-eq-handoff`, and `quick-safe-fade` exist when cue data supports them
- each candidate has a non-empty `timeline`
- chosen candidate is the highest-scoring safe candidate

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/cuefield-recipe-planner.test.js`

Expected: fails because `../cuefield/recipe-planner` does not exist.

- [x] **Step 3: Implement `planRecipeCandidates(fromProfile, toProfile)`**

Create candidates with stable timeline actions:

```js
{
  recipe: 'filtered-pickup',
  score: 0.7,
  confidence: 0.7,
  reason: ['downbeat aligned'],
  risks: [],
  anchors: { aExit, bStart, bAnchor, downbeatOffset },
  timeline: [
    { t: -2.8, deck: 'B', op: 'play', at: bStart, volume: 0 },
    { t: -2.8, deck: 'B', op: 'filter', type: 'highpass', value: 900, duration: 1800 },
    { t: -2.6, deck: 'B', op: 'volume', value: 0.72, duration: 2200 },
    { t: -1.5, deck: 'A', op: 'bass', value: 0.35, duration: 1000 },
    { t: 0, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 900 },
    { t: 1.2, deck: 'A', op: 'volume', value: 0, duration: 900 },
    { t: 2.2, deck: 'B', op: 'handoff' }
  ]
}
```

- [x] **Step 4: Verify tests pass**

Run: `node --test test/cuefield-recipe-planner.test.js`

Expected: all recipe planner tests pass.

### Task 3: Bridge API Compatibility

**Files:**
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `test/cuefield-mineradio-bridge.test.js`

- [x] **Step 1: Write failing bridge test**

Assert `planCuefieldTransitionFromCache()` returns `candidates[]`, `chosen.timeline`, and keeps existing `chosen.exit`, `chosen.entry`, `chosen.recipe`, and `chosen.evaluation`.

- [x] **Step 2: Run bridge test to verify it fails**

Run: `node --test test/cuefield-mineradio-bridge.test.js`

Expected: fails because `candidates` and `timeline` are missing.

- [x] **Step 3: Integrate cue profile and recipe planner**

Use `buildCueProfile()` for `from` and `to`, then `planRecipeCandidates()`. Preserve section-candidate output in `from`, `to`, and old `chosen` properties.

- [x] **Step 4: Verify bridge and Cuefield tests**

Run: `node --test test/cuefield-recipe-planner.test.js test/cuefield-mineradio-bridge.test.js test/cuefield.test.js`

Expected: all tests pass.

### Task 4: Final Verification

**Files:**
- No new code unless tests expose an issue.

- [x] Run `node --check` on new and touched modules.
- [x] Run `git diff --check`.
- [x] Run the Cuefield test set.
- [x] Review `git diff --stat` and ensure `desktop/main.js` is not staged.

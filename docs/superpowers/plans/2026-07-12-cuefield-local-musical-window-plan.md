# Cuefield Local Musical Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank Cuefield transition windows using Basic Pitch evidence from the actual A exit and B entry while keeping analysis capped at sixteen seconds per track.

**Architecture:** The browser sampler will choose four structure-aware audio windows and the existing worker will cache one compact musical profile per window. Pure helpers in `cuefield/musical-profile.js` will locate and compare reliable nearby windows; `transition-window-planner.js` will use that local evidence as a bounded ranking signal and a long-overlap safety gate. Existing whole-song evidence remains the fallback.

**Tech Stack:** Electron, browser JavaScript, Node.js worker threads, `@spotify/basic-pitch`, Node test runner.

---

## File Map

- Modify `public/cuefield-musical-sampler.js`: choose transition-aware starts and sample those windows.
- Modify `public/index.html`: pass the structure map into musical sampling.
- Modify `desktop/cuefield-musical-worker.js`: preserve complete compact local profiles.
- Modify `cuefield/musical-profile.js`: select reliable nearby windows and compare them.
- Modify `cuefield/transition-window-planner.js`: rank each exit-entry pair with local evidence and suppress unsafe long overlap.
- Modify `cuefield/mineradio-bridge.js`: expose selected local diagnostics.
- Modify `cuefield/feedback-log.js`: sanitize local diagnostics in feedback records.
- Modify focused tests under `test/`: prove each boundary before implementation.
- Modify `CURRENT_STATE.md`: record the verified implementation and remaining listening work.

### Task 1: Structure-Aware Sampling Starts

**Files:**
- Modify: `public/cuefield-musical-sampler.js`
- Test: `test/cuefield-musical-sampler.test.js`

- [ ] **Step 1: Write failing sampler tests**

Append tests that ask the sampler to place windows at an opening, Hook, middle release, and late outro, while preserving the old deterministic fallback:

```js
test('selects transition-aware windows from entries and exits', () => {
  const structure = {
    entryCandidates: [
      { type: 'intro', role: 'entry', time: 2, landingAt: 2, confidence: 0.7 },
      { type: 'hook', role: 'entry', time: 44, landingAt: 44, confidence: 0.9 },
    ],
    exitCandidates: [
      { type: 'release', role: 'exit', time: 118, confidence: 0.82 },
      { type: 'outro', role: 'exit', time: 188, confidence: 0.88 },
    ],
  };

  assert.deepEqual(selectTransitionWindowStarts(structure, 200, 4), [2, 44, 114, 184]);
});

test('deduplicates structural windows and fills deterministic fallback positions', () => {
  const structure = {
    entryCandidates: [{ type: 'intro', role: 'entry', time: 0, confidence: 0.9 }],
    exitCandidates: [{ type: 'release', role: 'exit', time: 3, confidence: 0.9 }],
  };

  const starts = selectTransitionWindowStarts(structure, 100, 4);
  assert.equal(starts.length, 4);
  assert.equal(new Set(starts).size, 4);
  assert.deepEqual(starts, [0, 28, 56, 78]);
});
```

Update the test import to include `selectTransitionWindowStarts`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test test/cuefield-musical-sampler.test.js
```

Expected: FAIL because `selectTransitionWindowStarts` is not exported.

- [ ] **Step 3: Implement deterministic structural selection**

Add a pure selector and allow `sampleRepresentativeAudio` to consume explicit starts:

```js
function candidateTime(candidate, exitWindow, windowSeconds) {
  var landing = finite(candidate && (candidate.playFrom != null
    ? candidate.playFrom
    : (candidate.landingAt != null ? candidate.landingAt : candidate.time)), NaN);
  if (!isFinite(landing)) return NaN;
  return exitWindow ? landing - windowSeconds : landing;
}

function selectTransitionWindowStarts(structure, duration, windowSeconds) {
  duration = Math.max(0, finite(duration, 0));
  windowSeconds = Math.max(0.25, finite(windowSeconds, 4));
  var maximumStart = Math.max(0, duration - windowSeconds);
  var entries = Array.isArray(structure && structure.entryCandidates) ? structure.entryCandidates : [];
  var exits = Array.isArray(structure && structure.exitCandidates) ? structure.exitCandidates : [];
  var natural = entries.filter(function(item) { return /^(start|intro|drop)$/.test(String(item.type || '')); });
  var hooks = entries.filter(function(item) { return /^(pre-hook|hook|chorus)$/.test(String(item.type || '')); });
  var releases = exits.filter(function(item) { return /^(release|outro|natural-tail)$/.test(String(item.type || '')); });
  function strongest(items, predicate) {
    return items.filter(predicate || function() { return true; }).slice().sort(function(a, b) {
      return finite(b.confidence, 0) - finite(a.confidence, 0);
    })[0];
  }
  var chosen = [
    [strongest(natural), false],
    [strongest(hooks), false],
    [strongest(releases, function(item) { var r = finite(item.time, 0) / Math.max(1, duration); return r >= 0.45 && r < 0.8; }), true],
    [strongest(releases, function(item) { return finite(item.time, 0) / Math.max(1, duration) >= 0.72; }), true],
  ];
  var starts = [];
  function add(value) {
    if (!isFinite(value)) return;
    var bounded = Math.round(Math.max(0, Math.min(maximumStart, value)) * 1000) / 1000;
    if (!starts.some(function(existing) { return Math.abs(existing - bounded) < windowSeconds * 0.5; })) starts.push(bounded);
  }
  chosen.forEach(function(item) { add(candidateTime(item[0], item[1], windowSeconds)); });
  [0, duration * 0.28, duration * 0.56, duration * 0.78].forEach(add);
  return starts.slice(0, 4).sort(function(a, b) { return a - b; });
}
```

Use `options.windowStarts` when supplied, otherwise call the selector with `options.structureMap`. Export both functions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test test/cuefield-musical-sampler.test.js
```

Expected: all sampler tests PASS and the default payload remains at 352,800 samples.

- [ ] **Step 5: Commit the sampler boundary**

```bash
git add public/cuefield-musical-sampler.js test/cuefield-musical-sampler.test.js
git commit -m "Select musical windows from transition structure"
```

### Task 2: Cache Complete Local Window Profiles

**Files:**
- Modify: `desktop/cuefield-musical-worker.js`
- Modify: `public/index.html`
- Test: `test/cuefield-musical-integration.test.js`
- Test: `test/cuefield-musical-sampler.test.js`

- [ ] **Step 1: Write failing integration assertions**

Require the renderer to pass the structure map and the worker to preserve density and range:

```js
test('musical analysis receives transition structure and caches local profile fields', () => {
  const html = read('public/index.html');
  const worker = read('desktop/cuefield-musical-worker.js');

  assert.match(html, /analyzeCuefieldMusicalBuffer\(buffer, map\)/);
  assert.match(html, /sampleRepresentativeAudio\(buffer, \{ structureMap: map\.structureMap \|\| null \}\)/);
  assert.match(worker, /noteDensity: profile\.noteDensity/);
  assert.match(worker, /pitchRange: profile\.pitchRange/);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test test/cuefield-musical-integration.test.js
```

Expected: FAIL because the renderer currently samples without a structure map and worker windows omit the two fields.

- [ ] **Step 3: Pass structure and complete the compact profile**

Change the renderer calls to:

```js
async function analyzeCuefieldMusicalBuffer(buffer, map) {
  if (!buffer || !window.CuefieldMusicalSampler || !window.desktopWindow
      || typeof window.desktopWindow.analyzeCuefieldMusicalWindow !== 'function') return null;
  var sampled = window.CuefieldMusicalSampler.sampleRepresentativeAudio(buffer, {
    structureMap: map && map.structureMap || null,
  });
  var result = await window.desktopWindow.analyzeCuefieldMusicalWindow(sampled);
  return result && result.ok ? result.profile : null;
}
```

Call it as `analyzeCuefieldMusicalBuffer(buffer, map)`. Add these fields to each worker window:

```js
noteDensity: profile.noteDensity,
pitchRange: profile.pitchRange,
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test test/cuefield-musical-integration.test.js test/cuefield-musical-sampler.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit cached local profiles**

```bash
git add desktop/cuefield-musical-worker.js public/index.html test/cuefield-musical-integration.test.js test/cuefield-musical-sampler.test.js
git commit -m "Cache transition-aware musical profiles"
```

### Task 3: Match and Compare Nearby Local Windows

**Files:**
- Modify: `cuefield/musical-profile.js`
- Test: `test/cuefield-musical-profile.test.js`

- [ ] **Step 1: Write failing local comparison tests**

```js
test('compares reliable musical windows nearest to candidate times', () => {
  const first = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64]));
  const second = buildMusicalProfile(notes([65, 67, 69, 72, 70, 69]));
  first.windows = [{ ...first, start: 96, duration: 4, confidence: 0.9, noteCount: 30 }];
  second.windows = [{ ...second, start: 8, duration: 4, confidence: 0.9, noteCount: 30 }];

  const local = compareLocalMusicalWindows(first, second, 100, 8);
  assert.equal(local.score > 0.8, true);
  assert.equal(local.aWindowStart, 96);
  assert.equal(local.bWindowStart, 8);
  assert.equal(local.aDistance, 0);
  assert.equal(local.bDistance, 0);
});

test('returns no local evidence for weak or distant windows', () => {
  const profile = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64]));
  profile.windows = [{ ...profile, start: 0, duration: 4, confidence: 0.2, noteCount: 4 }];
  assert.equal(compareLocalMusicalWindows(profile, profile, 90, 90), null);
});
```

Update the import to include `compareLocalMusicalWindows`.

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test test/cuefield-musical-profile.test.js
```

Expected: FAIL because `compareLocalMusicalWindows` is not exported.

- [ ] **Step 3: Implement reliable nearest-window comparison**

```js
function distanceToWindow(time, window) {
  const start = toNumber(window && window.start, NaN);
  const end = start + Math.max(0, toNumber(window && window.duration));
  if (!Number.isFinite(start) || !Number.isFinite(time)) return Infinity;
  if (time < start) return start - time;
  if (time > end) return time - end;
  return 0;
}

function nearestReliableWindow(profile, time) {
  return (Array.isArray(profile && profile.windows) ? profile.windows : [])
    .filter((window) => toNumber(window.confidence) >= 0.55 && toNumber(window.noteCount) >= 12)
    .map((window) => ({ window, distance: distanceToWindow(time, window) }))
    .filter((match) => match.distance <= Math.max(2, toNumber(match.window.duration) * 1.5))
    .sort((a, b) => a.distance - b.distance || toNumber(b.window.confidence) - toNumber(a.window.confidence))[0] || null;
}

function compareLocalMusicalWindows(first, second, firstTime, secondTime) {
  const a = nearestReliableWindow(first, firstTime);
  const b = nearestReliableWindow(second, secondTime);
  if (!a || !b) return null;
  const comparison = compareMusicalProfiles(a.window, b.window);
  return {
    ...comparison,
    confidence: round(Math.min(toNumber(a.window.confidence), toNumber(b.window.confidence))),
    aWindowStart: round(toNumber(a.window.start)),
    bWindowStart: round(toNumber(b.window.start)),
    aDistance: round(a.distance),
    bDistance: round(b.distance),
  };
}
```

Export `nearestReliableWindow` and `compareLocalMusicalWindows`.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test test/cuefield-musical-profile.test.js
```

Expected: all musical profile tests PASS.

- [ ] **Step 5: Commit local comparison helpers**

```bash
git add cuefield/musical-profile.js test/cuefield-musical-profile.test.js
git commit -m "Compare local transition music windows"
```

### Task 4: Rank Candidate Pairs and Bound Overlap

**Files:**
- Modify: `cuefield/transition-window-planner.js`
- Test: `test/cuefield-transition-window-planner.test.js`

- [ ] **Step 1: Write failing planner tests**

Add this fixture helper beside the existing `musicalProfile` helper, then add three tests:

```js
function musicalWindow(start, root) {
  return {
    ...musicalProfile(root),
    start,
    duration: 4,
  };
}

test('prefers the exit-entry pair with compatible local musical windows', () => {
  const from = profile({
    exits: [exit(100, 0.9, { exitRatio: 0.781 })],
  });
  const to = profile({
    entries: [
      entry('intro', 8, { playFrom: 8, landingAt: 8, landingType: 'intro' }),
      entry('intro', 40, { playFrom: 40, landingAt: 40, landingType: 'intro' }),
    ],
  });
  from.musicalProfile = { ...musicalProfile(0), windows: [musicalWindow(96, 0)] };
  to.musicalProfile = { ...musicalProfile(0), windows: [musicalWindow(8, 6), musicalWindow(40, 0)] };

  const result = chooseTransitionWindow(from, to);
  assert.equal(result.chosen.entry.landingAt, 40);
  assert.equal(result.chosen.localMusicalEvidence.score > 0.8, true);
});

test('local harmonic clash suppresses long overlap but keeps an executable transition', () => {
  const from = profile({ exits: [exit(100, 0.9, { exitRatio: 0.781 })] });
  const to = profile({ entries: [entry('intro', 16, { playFrom: 16, landingAt: 16, landingType: 'intro' })] });
  from.musicalProfile = { ...musicalProfile(0), windows: [musicalWindow(96, 0)] };
  to.musicalProfile = { ...musicalProfile(0), windows: [musicalWindow(16, 6)] };

  const result = chooseTransitionWindow(from, to);
  assert.equal(result.chosen.audibleOverlap <= 3.5, true);
  assert.notEqual(result.chosen.recipeCandidate.recipe, 'technical-failure');
  assert.equal(result.rejected.some((item) => item.rejectionReasons.includes('local musical clash needs short overlap')), true);
});

test('missing local windows remain neutral', () => {
  const from = profile({ exits: [exit(100, 0.9, { exitRatio: 0.781 })] });
  const to = profile({ entries: [entry('intro', 16, { playFrom: 16, landingAt: 16, landingType: 'intro' })] });
  from.musicalProfile = musicalProfile(0);
  to.musicalProfile = musicalProfile(0);

  const result = chooseTransitionWindow(from, to);
  assert.equal(result.chosen.localMusicalEvidence, null);
  assert.notEqual(result.chosen.recipeCandidate.recipe, 'technical-failure');
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node --test test/cuefield-transition-window-planner.test.js
```

Expected: FAIL because candidate windows do not contain local evidence and local compatibility cannot reorder pairs.

- [ ] **Step 3: Compute evidence per exit-entry pair**

Import `compareLocalMusicalWindows`. Inside the nested candidate loop compute:

```js
const localMusicalEvidence = compareLocalMusicalWindows(
  fromAnalysis.musicalProfile,
  toAnalysis.musicalProfile,
  toNumber(exit.time),
  toNumber(entry.playFrom, toNumber(entry.landingAt)),
);
```

Pass it to `rejectionReasons` and `rankWindow`. Add the long-overlap gate:

```js
if (localMusicalEvidence
    && toNumber(localMusicalEvidence.confidence) >= 0.55
    && (toNumber(localMusicalEvidence.score, 0.5) < 0.42
      || toNumber(localMusicalEvidence.harmonicSimilarity, 0.5) < 0.4)
    && toNumber(window.audibleOverlap) > 3.5) {
  reasons.push('local musical clash needs short overlap');
}
```

Use a bounded local adjustment in `rankWindow`:

```js
const localMusicalAdjustment = localMusicalEvidence
  ? Math.max(-0.08, Math.min(0.08, (toNumber(localMusicalEvidence.score, 0.5) - 0.5) * 0.16))
  : 0;
```

Add it to the score and return `localMusicalEvidence` on each candidate. Include compact local fields in `compactWindow` so rejected candidates remain explainable.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test test/cuefield-transition-window-planner.test.js test/cuefield-musical-profile.test.js
```

Expected: all tests PASS; clashing pairs still produce a short executable transition.

- [ ] **Step 5: Commit planner integration**

```bash
git add cuefield/transition-window-planner.js test/cuefield-transition-window-planner.test.js
git commit -m "Rank transitions with local musical evidence"
```

### Task 5: Persist Sanitized Local Diagnostics

**Files:**
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `public/index.html`
- Modify: `cuefield/feedback-log.js`
- Test: `test/cuefield-mineradio-bridge.test.js`
- Test: `test/cuefield-feedback-log.test.js`
- Test: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing diagnostic tests**

Assert the chosen local evidence reaches the bridge and feedback record, while raw profile arrays remain absent:

```js
assert.equal(result.diagnostics.localMusicalCompatibility > 0.8, true);
assert.equal(result.diagnostics.localAWindowStart, 96);
assert.equal(result.diagnostics.localBWindowStart, 8);
assert.equal(JSON.stringify(result).includes('pitchClassProfile'), false);
```

In the feedback test provide local diagnostic values and assert their rounded compact form:

```js
assert.deepEqual(record.transition.localMusical, {
  evidence: true,
  compatibility: 0.823,
  harmonicSimilarity: 0.812,
  keyCompatibility: 0.94,
  melodySimilarity: 0.731,
  confidence: 0.88,
  aWindowStart: 96,
  bWindowStart: 8,
  aDistance: 0,
  bDistance: 0,
  risks: ['harmonic-clash'],
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
```

Expected: FAIL because local diagnostics are not exposed or compacted.

- [ ] **Step 3: Expose and sanitize diagnostics**

In `mineradio-bridge.js`, add these fields to `transitionDiagnostics`:

```js
const localMusical = chosen.localMusicalEvidence || {};
```

```js
localMusicalEvidence: !!chosen.localMusicalEvidence,
localMusicalCompatibility: finiteOrNull(localMusical.score),
localHarmonicSimilarity: finiteOrNull(localMusical.harmonicSimilarity),
localKeyCompatibility: finiteOrNull(localMusical.keyCompatibility),
localMelodySimilarity: finiteOrNull(localMusical.melodySimilarity),
localMusicalConfidence: finiteOrNull(localMusical.confidence),
localAWindowStart: finiteOrNull(localMusical.aWindowStart),
localBWindowStart: finiteOrNull(localMusical.bWindowStart),
localAWindowDistance: finiteOrNull(localMusical.aDistance),
localBWindowDistance: finiteOrNull(localMusical.bDistance),
localMusicalRisks: Array.isArray(localMusical.risks) ? localMusical.risks.slice(0, 3) : [],
```

In `cuefieldFeedbackContextFromPending`, add the exact scalar mapping:

```js
localMusicalEvidence: plannerDiagnostics.localMusicalEvidence === true,
localMusicalCompatibility: plannerDiagnostics.localMusicalCompatibility,
localHarmonicSimilarity: plannerDiagnostics.localHarmonicSimilarity,
localKeyCompatibility: plannerDiagnostics.localKeyCompatibility,
localMelodySimilarity: plannerDiagnostics.localMelodySimilarity,
localMusicalConfidence: plannerDiagnostics.localMusicalConfidence,
localAWindowStart: plannerDiagnostics.localAWindowStart,
localBWindowStart: plannerDiagnostics.localBWindowStart,
localAWindowDistance: plannerDiagnostics.localAWindowDistance,
localBWindowDistance: plannerDiagnostics.localBWindowDistance,
localMusicalRisks: plannerDiagnostics.localMusicalRisks || [],
```

Add a feedback compactor:

```js
function compactLocalMusical(transition = {}) {
  return {
    evidence: transition.localMusicalEvidence === true,
    compatibility: roundNumber(transition.localMusicalCompatibility),
    harmonicSimilarity: roundNumber(transition.localHarmonicSimilarity),
    keyCompatibility: roundNumber(transition.localKeyCompatibility),
    melodySimilarity: roundNumber(transition.localMelodySimilarity),
    confidence: roundNumber(transition.localMusicalConfidence),
    aWindowStart: roundNumber(transition.localAWindowStart),
    bWindowStart: roundNumber(transition.localBWindowStart),
    aDistance: roundNumber(transition.localAWindowDistance),
    bDistance: roundNumber(transition.localBWindowDistance),
    risks: compactList(transition.localMusicalRisks, 3),
  };
}
```

Store it as `localMusical` beside the existing whole-song `musical` object. Old records remain readable because stats code does not require this field.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
```

Expected: all tests PASS and serialized results contain no raw local arrays.

- [ ] **Step 5: Commit diagnostics**

```bash
git add cuefield/mineradio-bridge.js public/index.html cuefield/feedback-log.js test/cuefield-mineradio-bridge.test.js test/cuefield-feedback-log.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "Record local musical transition evidence"
```

### Task 6: Full Regression and Checkpoint

**Files:**
- Modify: `CURRENT_STATE.md`

- [ ] **Step 1: Run the complete suite**

```bash
node --test test/*.test.js
```

Expected: every test passes with zero failures, cancellations, or skips.

- [ ] **Step 2: Run syntax and patch checks**

```bash
node --check server.js
node --check cuefield/musical-profile.js
node --check cuefield/transition-window-planner.js
node --check desktop/cuefield-musical-worker.js
git diff --check
```

Expected: all commands exit zero with no output from `git diff --check`.

- [ ] **Step 3: Verify the sixteen-second ceiling**

```bash
node --test test/cuefield-musical-sampler.test.js
```

Expected: the payload-bound test confirms no more than `22050 * 16` samples.

- [ ] **Step 4: Update the project checkpoint**

Replace `CURRENT_STATE.md` with this checkpoint, updating the test count after the full suite:

```markdown
# CURRENT_STATE - Cuefield local musical windows
> 更新时间: 2026-07-12 | 线程: 局部旋律与和声参与切歌选择

## 目标
- 比较真实 A 出口与 B 入口附近的音乐，而不是只比较整首歌。

## 已做
- Basic Pitch 保持每首最多 4 x 4 秒分析预算，采样点由结构候选决定。
- 每个窗口缓存紧凑和声、调性、旋律轮廓、密度和置信度，不保存原始音符。
- planner 为每组 exit-entry 匹配最近可靠窗口，并用局部兼容度微调排序。
- 高置信局部冲突禁止长重叠，但保留短 echo/filter/terminal 过渡。
- 旧缓存或低置信窗口保持中立，回退整首兼容度。
- 局部诊断已进入反馈记录，不包含音频、URL、歌词或 profile 数组。
- 全量测试通过，`git diff --check` 通过。

## 未做 / 下一步
- 用真实歌曲试听局部排序是否改善旋律冲突，并记录误判。

## 关键约束 / 红线
- 分析预算不超过每首 16 秒；局部证据不能覆盖结构、人声和时间安全规则。
- `desktop/main.js` 原有 macOS Metal 修改继续保留为本地未提交改动。

## 关键路径 / 文件
- `public/cuefield-musical-sampler.js`, `desktop/cuefield-musical-worker.js`
- `cuefield/musical-profile.js`, `cuefield/transition-window-planner.js`
```

- [ ] **Step 5: Commit the verified checkpoint**

```bash
git add CURRENT_STATE.md
git commit -m "Checkpoint local musical transition matching"
```

- [ ] **Step 6: Confirm only the pre-existing local edit remains**

```bash
git status --short
```

Expected:

```text
 M desktop/main.js
```

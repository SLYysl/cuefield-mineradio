# Cuefield Structure Map Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect track A through its first complete signature section, then choose an executable A exit and B entry from lyric-and-beat Structure Maps instead of synthetic `duration - 16` and 12-to-16-second anchors.

**Architecture:** Add a focused `cuefield/structure-map.js` module that converts an existing cue profile plus parsed LRC into sections, `protectedUntil`, exits, and entries. Feed both provider lyrics into the existing transition endpoint, make `chooseTransitionCandidates` consume the Structure Maps as a paired search, and append structural provenance to existing feedback without changing the playback graph or visual systems.

**Tech Stack:** Node.js CommonJS, browser UMD modules, Electron/HTMLAudioElement, `node:test`, existing Cuefield beatmap/LRC/planner modules.

---

## File Map

- Create `cuefield/structure-map.js`: pure lyric-and-beat structure analysis.
- Create `public/cuefield-lyric-source.js`: pure provider lyric endpoint and payload helpers for browser/runtime reuse.
- Create `test/cuefield-structure-map.test.js`: protected section and candidate behavior.
- Create `test/cuefield-lyric-source.test.js`: provider endpoint and raw LRC behavior.
- Modify `cuefield/mineradio-bridge.js`: parse LRC once, attach Structure Maps, remove synthetic fallback entry, expose structural diagnostics.
- Modify `cuefield/section-candidates.js`: pair Structure Map exits and entries behind the hard protection boundary.
- Modify `cuefield/recipe-planner.js`: trust `lyric+beat` entries and retain structure diagnostics.
- Modify `public/index.html`: load the lyric helper, fetch A/B lyrics during Cuefield preparation, and send them to the transition endpoint.
- Modify `public/cuefield-automix.js`: retain lyric preparation provenance in pending state without changing trigger ownership.
- Modify `cuefield/feedback-log.js` and `cuefield/feedback-remote.js`: sanitize structural diagnostics.
- Modify focused existing tests for bridge, AutoMix, feedback, and source integration.

### Task 1: Pure Structure Map

**Files:**
- Create: `cuefield/structure-map.js`
- Create: `test/cuefield-structure-map.test.js`

- [ ] **Step 1: Write failing tests for first-hook protection**

Create synthetic eight-bar phrases and repeated timed lyrics. Assert that the first repeated high-energy phrase becomes a hook and that protection ends at the phrase end, not the first peak:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildStructureMap } = require('../cuefield/structure-map');

function profile(energies, duration = 128) {
  return {
    duration,
    gridStep: 0.5,
    phrases: energies.map((energy, index) => ({
      index,
      start: index * 16,
      end: (index + 1) * 16,
      energy,
    })),
    bars: energies.flatMap((energy, phrase) => Array.from({ length: 8 }, (_, bar) => ({
      start: phrase * 16 + bar * 2,
      end: phrase * 16 + (bar + 1) * 2,
      energy,
      lowDensity: energy * 0.6,
      beatStability: 0.9,
    }))),
  };
}

test('protects through the end of the first repeated high-energy hook', () => {
  const map = buildStructureMap({
    profile: profile([0.32, 0.76, 0.44, 0.71, 0.38]),
    lrcLines: [
      { time: 18, text: 'we own the night', normalized: 'we own the night' },
      { time: 22, text: 'nothing feels the same', normalized: 'nothing feels the same' },
      { time: 50, text: 'we own the night', normalized: 'we own the night' },
      { time: 54, text: 'nothing feels the same', normalized: 'nothing feels the same' },
    ],
  });

  assert.equal(map.structureSource, 'lyric+beat');
  assert.equal(map.sections[0].type, 'hook');
  assert.equal(map.sections[0].start, 16);
  assert.equal(map.protectedUntil, 32);
  assert.equal(map.exitCandidates.every((item) => item.time >= 32), true);
});

test('does not end protection on a transient early peak', () => {
  const map = buildStructureMap({ profile: profile([0.9, 0.35, 0.72, 0.69, 0.4]), lrcLines: [] });
  assert.equal(map.protectedUntil >= 48, true);
  assert.equal(map.structureSource, 'beat-only');
});
```

- [ ] **Step 2: Run the Structure Map tests and verify RED**

Run:

```bash
node --test test/cuefield-structure-map.test.js
```

Expected: FAIL with `Cannot find module '../cuefield/structure-map'`.

- [ ] **Step 3: Implement the minimal Structure Map**

Create `cuefield/structure-map.js` with these public and internal boundaries:

```js
const { round, toNumber } = require('./cue-profile');

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function repeatedTimes(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const key = String(line.normalized || '').trim();
    if (key.length < 4) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(toNumber(line.time));
  }
  return Array.from(groups.values()).filter((times) => times.length >= 2).flat();
}

function phraseForTime(phrases, time) {
  return phrases.find((phrase) => time >= phrase.start && time < phrase.end) || null;
}

function signaturePhrase(profile, lrcLines) {
  const phrases = profile.phrases || [];
  const mean = average(phrases.map((phrase) => toNumber(phrase.energy, NaN)));
  const repeated = repeatedTimes(lrcLines).sort((a, b) => a - b);
  const lyricPhrase = repeated.map((time) => phraseForTime(phrases, time))
    .find((phrase) => phrase && phrase.energy >= mean * 0.95);
  if (lyricPhrase) return { phrase: lyricPhrase, source: 'lyric+beat', confidence: 0.82 };
  const sustained = phrases.find((phrase, index) => index > 0
    && phrase.energy >= mean * 1.05
    && phrases[index + 1]
    && phrases[index + 1].energy >= mean * 0.95);
  const fallback = sustained || phrases.slice(1).sort((a, b) => b.energy - a.energy)[0] || phrases[0];
  return { phrase: fallback, source: 'beat-only', confidence: sustained ? 0.62 : 0.42 };
}

function buildStructureMap(opts = {}) {
  const profile = opts.profile || {};
  const phrases = profile.phrases || [];
  const signature = signaturePhrase(profile, opts.lrcLines || []);
  const protectedUntil = round(signature.phrase ? signature.phrase.end : Math.min(profile.duration || 0, 32));
  const searchStart = Math.max(protectedUntil, toNumber(profile.duration) * 0.35);
  const searchEnd = Math.max(searchStart, toNumber(profile.duration) - 8);
  const exitCandidates = phrases.filter((phrase) => phrase.end >= searchStart && phrase.end <= searchEnd)
    .map((phrase, index, list) => {
      const next = list[index + 1];
      const delta = next ? next.energy - phrase.energy : 0;
      return {
        type: delta <= -0.08 ? 'release' : 'phrase-boundary',
        role: 'exit',
        source: 'structure',
        time: round(phrase.end),
        confidence: round(Math.max(0.35, Math.min(0.9, 0.58 - delta * 0.5))),
        energyBefore: round(phrase.energy),
        energyAfter: round(next ? next.energy : phrase.energy),
      };
    });
  const start = { type: 'start', role: 'entry', source: 'fallback', time: 0, confidence: 0.35 };
  const signatureEntry = signature.phrase ? {
    type: signature.source === 'lyric+beat' ? 'hook' : 'drop',
    role: 'entry',
    source: signature.source,
    time: round(signature.phrase.start),
    confidence: signature.confidence,
  } : null;
  const signatureIndex = signature.phrase ? phrases.indexOf(signature.phrase) : -1;
  const priorPhrase = signatureIndex > 0 ? phrases[signatureIndex - 1] : null;
  const preHookEntry = signatureEntry && priorPhrase ? {
    type: 'pre-hook',
    role: 'entry',
    source: signature.source,
    time: round(priorPhrase.start),
    confidence: round(Math.max(0.35, signature.confidence - 0.08)),
    resolvesTo: { type: signatureEntry.type, time: signatureEntry.time },
  } : null;
  const entryCandidates = [start, preHookEntry, signatureEntry].filter(Boolean);
  const sections = [];
  if (priorPhrase) sections.push({ ...priorPhrase, type: 'pre-hook', confidence: preHookEntry.confidence, source: signature.source });
  if (signature.phrase) sections.push({ ...signature.phrase, type: signatureEntry.type, confidence: signature.confidence, source: signature.source });
  return {
    duration: round(profile.duration),
    structureSource: signature.source,
    structureConfidence: signature.confidence,
    protectedUntil,
    sections,
    exitCandidates,
    entryCandidates,
  };
}

module.exports = { buildStructureMap };
```

- [ ] **Step 4: Add failing candidate tests**

Add tests that assert:

```js
test('uses a real zero-second fallback instead of a synthetic intro', () => {
  const map = buildStructureMap({ profile: profile([0.4, 0.42, 0.39, 0.41]), lrcLines: [] });
  const fallback = map.entryCandidates.find((item) => item.source === 'fallback');
  assert.equal(fallback.time, 0);
  assert.equal(map.entryCandidates.some((item) => item.time >= 12 && item.time <= 16 && item.source === 'fallback'), false);
});

test('labels a falling post-hook phrase as a release', () => {
  const map = buildStructureMap({ profile: profile([0.3, 0.8, 0.68, 0.42, 0.3]), lrcLines: [] });
  assert.equal(map.exitCandidates.some((item) => item.type === 'release'), true);
});

test('exposes a pre-hook and hook as separate B entry choices', () => {
  const map = buildStructureMap({
    profile: profile([0.32, 0.76, 0.44, 0.71]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 50, normalized: 'we own the night' },
    ],
  });
  assert.equal(map.entryCandidates.some((item) => item.type === 'pre-hook'), true);
  assert.equal(map.entryCandidates.some((item) => item.type === 'hook'), true);
});
```

Run the test, verify any assertion failure is about candidate behavior, then adjust only `buildStructureMap` until all Structure Map tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add cuefield/structure-map.js test/cuefield-structure-map.test.js
git commit -m "Build Cuefield lyric beat structure maps"
```

### Task 2: Bridge Integration And Hard Protection Boundary

**Files:**
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `cuefield/section-candidates.js`
- Modify: `cuefield/recipe-planner.js`
- Modify: `test/cuefield-mineradio-bridge.test.js`
- Modify: `test/cuefield-recipe-planner.test.js`

- [ ] **Step 1: Write failing bridge tests**

Extend the bridge fixture with timed LRC and assert the public result:

```js
const result = planCuefieldTransitionFromCache({
  fromKey: 'song:a',
  toKey: 'song:b',
  fromLrc: '[00:18.00]we own the night\n[00:50.00]we own the night',
  toLrc: '[00:20.00]take me higher\n[00:52.00]take me higher',
  readBeatMapCache: (key) => cache[key] || null,
});

assert.equal(result.from.structureMap.protectedUntil > 0, true);
assert.equal(result.chosen.exit.time >= result.from.structureMap.protectedUntil, true);
assert.equal(result.chosen.entry.time === 0 || result.chosen.entry.source !== 'fallback', true);
assert.equal(result.diagnostics.structureSource, 'lyric+beat');
assert.equal(result.diagnostics.exitCandidateCount > 0, true);
```

Add a no-LRC case asserting `structureSource === 'beat-only'` and fallback entry time `0`.

- [ ] **Step 2: Run bridge tests and verify RED**

```bash
node --test test/cuefield-mineradio-bridge.test.js test/cuefield-recipe-planner.test.js
```

Expected: FAIL because `structureMap` and structural diagnostics are absent and the current fallback is synthetic.

- [ ] **Step 3: Integrate Structure Maps in the bridge**

Replace `addFallbackEntry` with a parse-once flow:

```js
const { buildStructureMap } = require('./structure-map');

function analyzeCacheEntry(entry, key, lrcText) {
  const fixture = normalizedFixture(entry, key);
  const lrcLines = parseMaybeLrc(lrcText);
  const analysis = analyzeSectionCandidates({ fixture, lrcLines });
  const baseProfile = buildCueProfile({ track: analysis.track, map: fixture.map, candidates: analysis.candidates });
  const structureMap = buildStructureMap({ profile: baseProfile, lrcLines });
  const candidates = [...analysis.candidates, ...structureMap.exitCandidates, ...structureMap.entryCandidates];
  return {
    ...analysis,
    candidates,
    structureMap,
    cueProfile: buildCueProfile({ track: analysis.track, map: fixture.map, candidates }),
  };
}
```

Do not retain the old 12-percent fallback helper.

- [ ] **Step 4: Make pair selection consume structure candidates**

In `chooseTransitionCandidates`, select candidate sources and enforce protection before scoring:

```js
const fromStructure = fromAnalysis.structureMap || {};
const toStructure = toAnalysis.structureMap || {};
const protectedUntil = toNumber(fromStructure.protectedUntil, 0);
const sourceExits = fromStructure.exitCandidates && fromStructure.exitCandidates.length
  ? fromStructure.exitCandidates
  : (fromAnalysis.candidates || []).filter((candidate) => candidate.role === 'exit');
const sourceEntries = toStructure.entryCandidates && toStructure.entryCandidates.length
  ? toStructure.entryCandidates
  : (toAnalysis.candidates || []).filter((candidate) => candidate.role === 'entry');
const exits = sourceExits.filter((candidate) => toNumber(candidate.time) >= protectedUntil)
  .sort((a, b) => exitScore(b) - exitScore(a));
const entries = sourceEntries.slice().sort((a, b) => scoreEntry(b) - scoreEntry(a));
```

Return `protectedUntil`, `exitCandidateCount`, and `entryCandidateCount` with the chosen pair.

- [ ] **Step 5: Trust real Structure Map entries only**

In `safetyAssessment`, treat `source: "lyric+beat"` as potentially trusted and keep `source: "fallback"` untrusted:

```js
const entryTrusted = entrySource !== 'fallback'
  && entryConfidence >= 0.65
  && Number.isFinite(toNumber(entry.time, NaN));
```

Add a planner test for a `lyric+beat` hook and retain the existing fallback-short test.

- [ ] **Step 6: Expose structural diagnostics from the selected pair**

Merge these fields into the bridge result diagnostics:

```js
diagnostics: {
  ...recipePlan.diagnostics,
  structureSource: from.structureMap.structureSource === 'lyric+beat' && to.structureMap.structureSource === 'lyric+beat'
    ? 'lyric+beat' : 'beat-only',
  structureConfidence: Math.min(from.structureMap.structureConfidence, to.structureMap.structureConfidence),
  protectedUntil: from.structureMap.protectedUntil,
  exitType: chosen.exit && chosen.exit.type || '',
  exitConfidence: chosen.exit && chosen.exit.confidence,
  entryType: chosen.entry && chosen.entry.type || '',
  exitCandidateCount: from.structureMap.exitCandidates.length,
  entryCandidateCount: to.structureMap.entryCandidates.length,
}
```

Run the two focused test files until green.

- [ ] **Step 7: Commit Task 2**

```bash
git add cuefield/mineradio-bridge.js cuefield/section-candidates.js cuefield/recipe-planner.js test/cuefield-mineradio-bridge.test.js test/cuefield-recipe-planner.test.js
git commit -m "Plan Cuefield transitions from protected sections"
```

### Task 3: Fetch Both Provider Lyrics During AutoMix Preparation

**Files:**
- Create: `public/cuefield-lyric-source.js`
- Create: `test/cuefield-lyric-source.test.js`
- Modify: `public/index.html`
- Modify: `public/cuefield-automix.js`
- Modify: `test/cuefield-automix.test.js`
- Modify: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing pure lyric-source tests**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { lyricEndpointForSong, rawLrcFromPayload } = require('../public/cuefield-lyric-source');

test('builds provider lyric endpoints without touching playback state', () => {
  assert.equal(lyricEndpointForSong({ id: 123 }, 'netease'), '/api/lyric?id=123');
  assert.equal(lyricEndpointForSong({ mid: 'abc', qqId: 456 }, 'qq'), '/api/qq/lyric?mid=abc&id=456');
});

test('returns only raw timed LRC for planning', () => {
  assert.equal(rawLrcFromPayload({ lyric: '[00:01.00]line', yrc: 'ignored' }), '[00:01.00]line');
  assert.equal(rawLrcFromPayload({}), '');
});
```

Run `node --test test/cuefield-lyric-source.test.js` and expect a module-not-found failure.

- [ ] **Step 2: Implement the UMD lyric helper**

Create a UMD module exporting `lyricEndpointForSong`, `rawLrcFromPayload`, and `fetchRawLrc(song, provider, fetchJson)`; `fetchRawLrc` catches provider failures and returns `""`.

```js
function fetchRawLrc(song, provider, fetchJson) {
  var endpoint = lyricEndpointForSong(song, provider);
  if (!endpoint || typeof fetchJson !== 'function') return Promise.resolve('');
  return Promise.resolve(fetchJson(endpoint)).then(rawLrcFromPayload).catch(function() { return ''; });
}
```

Run the pure tests until green.

- [ ] **Step 3: Write the failing AutoMix request test**

Extend `test/cuefield-automix.test.js` so `planTransition` receives the original preparation context and assert both queue songs remain available:

```js
planTransition: async (fromKey, toKey, ctx) => {
  assert.equal(ctx.currentSong.key, 'a');
  assert.equal(ctx.nextSong.key, 'b');
  return executablePlan;
}
```

Add source integration assertions that `public/index.html` loads `cuefield-lyric-source.js`, calls `fetchRawLrc` for both songs, and sends `fromLrc`/`toLrc` in the existing transition request body.

- [ ] **Step 4: Connect lyrics in `public/index.html`**

Load the helper beside the other Cuefield scripts. Change the dependency callback to:

```js
planTransition: async function(fromKey, toKey, ctx) {
  ctx = ctx || {};
  var lyricSource = window.CuefieldLyricSource;
  var fromSong = ctx.currentSong || {};
  var toSong = ctx.nextSong || {};
  var lyrics = lyricSource ? await Promise.all([
    lyricSource.fetchRawLrc(fromSong, songProviderKey(fromSong), apiJson),
    lyricSource.fetchRawLrc(toSong, songProviderKey(toSong), apiJson),
  ]) : ['', ''];
  return apiJson('/api/cuefield/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromKey, toKey, fromLrc: lyrics[0], toLrc: lyrics[1], exitBias: 'late' }),
  });
}
```

Do not call `fetchLyric`, `setOriginalLyricsState`, or `applyPreferredLyricsForCurrent`; Cuefield lyric prefetch must not mutate displayed lyrics.

- [ ] **Step 5: Verify and commit Task 3**

```bash
node --test test/cuefield-lyric-source.test.js test/cuefield-automix.test.js test/cuefield-feedback-stats-ui.test.js
node --check public/cuefield-lyric-source.js
git add public/cuefield-lyric-source.js public/index.html public/cuefield-automix.js test/cuefield-lyric-source.test.js test/cuefield-automix.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "Feed paired lyrics into Cuefield planning"
```

### Task 4: Structural Feedback Diagnostics

**Files:**
- Modify: `public/index.html`
- Modify: `cuefield/feedback-log.js`
- Modify: `cuefield/feedback-remote.js`
- Modify: `test/cuefield-feedback-log.test.js`
- Modify: `test/cuefield-feedback-remote.test.js`
- Modify: `test/cuefield-feedback-stats-ui.test.js`

- [ ] **Step 1: Write failing normalization tests**

Add a transition containing all structural fields and assert the local and remote records preserve bounded values while dropping unknown/raw lyric fields:

```js
assert.deepEqual(record.transition.structure, {
  source: 'lyric+beat',
  confidence: 0.78,
  protectedUntil: 64,
  exitType: 'release',
  exitConfidence: 0.81,
  entryType: 'hook',
  entryConfidence: 0.84,
  exitCandidateCount: 4,
  entryCandidateCount: 3,
});
assert.equal(JSON.stringify(record).includes('raw lyric'), false);
```

Run the three feedback test files and verify RED on the missing `structure` object.

- [ ] **Step 2: Add compact structural normalization**

In `cuefield/feedback-log.js`, add:

```js
function compactStructure(transition = {}) {
  return {
    source: compactString(transition.structureSource, 24),
    confidence: roundNumber(transition.structureConfidence),
    protectedUntil: roundNumber(transition.protectedUntil),
    exitType: compactString(transition.exitType, 32),
    exitConfidence: roundNumber(transition.exitConfidence),
    entryType: compactString(transition.entryType, 32),
    entryConfidence: roundNumber(transition.entryConfidence),
    exitCandidateCount: Math.max(0, Math.min(12, Number(transition.exitCandidateCount) || 0)),
    entryCandidateCount: Math.max(0, Math.min(12, Number(transition.entryCandidateCount) || 0)),
  };
}
```

Attach it as `transition.structure`. Mirror only those fields in the remote payload.

- [ ] **Step 3: Feed planner diagnostics into feedback context**

In the existing Cuefield feedback block in `public/index.html`, map planner diagnostics directly:

```js
structureSource: plannerDiagnostics.structureSource || '',
structureConfidence: plannerDiagnostics.structureConfidence,
protectedUntil: plannerDiagnostics.protectedUntil,
exitType: plannerDiagnostics.exitType || '',
exitConfidence: plannerDiagnostics.exitConfidence,
entryType: plannerDiagnostics.entryType || '',
exitCandidateCount: plannerDiagnostics.exitCandidateCount,
entryCandidateCount: plannerDiagnostics.entryCandidateCount,
```

Do not include raw lyrics, sections, beatmaps, candidate arrays, or audio URLs.

- [ ] **Step 4: Verify and commit Task 4**

```bash
node --test test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js test/cuefield-feedback-stats-ui.test.js
git add public/index.html cuefield/feedback-log.js cuefield/feedback-remote.js test/cuefield-feedback-log.test.js test/cuefield-feedback-remote.test.js test/cuefield-feedback-stats-ui.test.js
git commit -m "Record Cuefield structural decisions"
```

### Task 5: Regression Audit And Checkpoint

**Files:**
- Modify: `CURRENT_STATE.md` in the main checkout after integration; it remains gitignored.
- No generated audit report is committed.

- [ ] **Step 1: Run the complete Cuefield suite**

```bash
node --test test/cuefield*.test.js test/beatmap-cache-path.test.js
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run syntax and whitespace checks**

```bash
node --check server.js
node --check public/cuefield-automix.js
node --check public/cuefield-lyric-source.js
node --check public/cuefield-timeline-executor.js
node --check cuefield/structure-map.js
node --check cuefield/mineradio-bridge.js
node --check cuefield/section-candidates.js
node --check cuefield/recipe-planner.js
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Replan the five newest rated pairs**

Use the local ignored feedback JSONL and beatmap cache. Print, but do not save or commit, these fields for rows after the original 61-row baseline:

```js
{
  pair,
  rating,
  protectedUntil,
  exitTime,
  exitType,
  entryTime,
  entryType,
  structureSource,
  structureConfidence,
}
```

Required invariants:

- every exit is at or after `protectedUntil`;
- no fallback entry is between 12 and 16 seconds;
- a beat-only fallback entry is exactly zero seconds;
- `Unique` and `Heat Waves` do not reuse their previous flat/rising synthetic outro points.

- [ ] **Step 4: Review diff and request independent code review**

Review `git diff <base>...HEAD`, then request a read-only review focused on protection invariants, lyric privacy, stale-token handling, and compatibility with the existing handoff lifecycle. Resolve all Critical and Important findings with TDD before integration.

- [ ] **Step 5: Complete the branch**

Use `superpowers:finishing-a-development-branch`. If local merge is selected, fast-forward `main`, rerun the complete suite on `main`, update `CURRENT_STATE.md` to record implementation and listening still pending, then remove the worktree and branch. Do not push, deploy, publish, or commit `desktop/main.js` without explicit confirmation.

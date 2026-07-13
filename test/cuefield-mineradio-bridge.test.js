const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeMineradioBeatMap } = require('../cuefield/adapter-mineradio');
const { planCuefieldTransitionFromCache } = require('../cuefield/mineradio-bridge');

function makeCompressedMap(duration = 96) {
  const gridStep = 0.5;
  const cameraBeats = [];
  for (let i = 0, time = 0; time < duration; i++, time += gridStep) {
    const phrase = i % 16 === 0;
    cameraBeats.push([
      Number(time.toFixed(3)),
      phrase ? 0.74 : 0.36,
      0.9,
      phrase ? 0.66 : 0.32,
      time > duration - 16 ? 0.28 : 0.42,
      phrase ? 0.64 : 0.38,
      phrase ? 0.52 : 0.25,
      i % 4,
      phrase ? 7 : 0,
      time > duration - 16 ? 0.3 : 0.44,
      phrase ? 0.5 : 0.22,
      0,
    ]);
  }
  return { v: 1, duration, gridStep, cameraBeats, visualBeatCount: cameraBeats.length };
}

test('normalizes compressed Mineradio beat arrays for Cuefield analysis', () => {
  const analysis = normalizeMineradioBeatMap(
    { id: 'a', title: 'Fortress', artist: 'Rogue', duration: 96 },
    makeCompressedMap(),
  );

  assert.equal(analysis.track.title, 'Fortress');
  assert.equal(analysis.analysis.beats.length > 100, true);
  assert.equal(analysis.analysis.beats[1].time, 0.5);
  assert.equal(analysis.analysis.beats[0].low > 0, true);
  assert.equal(analysis.analysis.downbeats.length > 2, true);
});

test('carries a cached musical profile into Cuefield analysis', () => {
  const map = makeCompressedMap();
  map.musicalProfile = { source: 'basic-pitch', confidence: 0.8, noteCount: 40 };
  const result = normalizeMineradioBeatMap({ id: 'a', duration: 96 }, map);

  assert.deepEqual(result.analysis.musicalProfile, map.musicalProfile);
});

test('exposes compact compatibility only when both musical profiles are reliable', () => {
  const reliableProfile = (shift) => ({
    source: 'basic-pitch',
    confidence: 0.9,
    noteCount: 48,
    pitchClassProfile: Array.from({ length: 12 }, (_, index) => index === shift ? 1 : 0),
    intervalProfile: Array.from({ length: 25 }, (_, index) => index === 14 ? 1 : 0),
    key: { root: shift, mode: 'major' },
  });
  const cache = {
    a: { key: 'a', map: { ...makeCompressedMap(128), musicalProfile: reliableProfile(0) } },
    b: { key: 'b', map: { ...makeCompressedMap(96), musicalProfile: reliableProfile(0) } },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'a',
    toKey: 'b',
    readBeatMapCache: (key) => cache[key],
  });

  assert.equal(result.diagnostics.musicalEvidence, true);
  assert.equal(result.diagnostics.musicalCompatibility, 1);
  assert.equal(result.diagnostics.harmonicSimilarity, 1);
  ['pitchClassProfile', 'intervalProfile', 'melodyContour', 'notes', 'audioUrl', 'lyrics'].forEach((sentinel) => {
    assert.equal(JSON.stringify(result).includes(sentinel), false, sentinel);
  });

  cache.b.map.musicalProfile = { ...reliableProfile(0), confidence: 0.2 };
  const neutral = planCuefieldTransitionFromCache({
    fromKey: 'a',
    toKey: 'b',
    readBeatMapCache: (key) => cache[key],
  });
  assert.equal(neutral.diagnostics.musicalEvidence, false);
  assert.equal(neutral.diagnostics.musicalCompatibility, null);
});

test('maps selected local musical evidence into scalar bridge diagnostics', () => {
  const profile = (windowStart) => ({
    source: 'basic-pitch',
    confidence: 0.9,
    noteCount: 48,
    pitchClassProfile: Array.from({ length: 12 }, (_, index) => index === 0 ? 1 : 0),
    intervalProfile: Array.from({ length: 25 }, (_, index) => index === 14 ? 1 : 0),
    key: { root: 0, mode: 'major' },
    windows: [{
      start: windowStart,
      duration: 200,
      confidence: 0.87654,
      noteCount: 24,
      pitchClassProfile: Array.from({ length: 12 }, (_, index) => index === 0 ? 1 : 0),
      intervalProfile: Array.from({ length: 25 }, (_, index) => index === 14 ? 1 : 0),
      key: { root: 0, mode: 'major' },
    }],
  });
  const cache = {
    a: { key: 'a', map: { ...makeCompressedMap(128), musicalProfile: profile(10) } },
    b: { key: 'b', map: { ...makeCompressedMap(96), musicalProfile: profile(20) } },
  };

  const result = planCuefieldTransitionFromCache({
    fromKey: 'a',
    toKey: 'b',
    fromLrc: '[00:18.00]we own the night\n[00:34.00]nothing feels the same\n[01:06.00]we own the night\n[01:22.00]nothing feels the same',
    toLrc: '[00:18.00]take me higher\n[00:34.00]feel it rising\n[01:06.00]take me higher\n[01:22.00]feel it rising',
    readBeatMapCache: (key) => cache[key],
  });
  const local = result.chosen.localMusicalEvidence;

  assert.equal(local && local.score > 0, true);
  assert.equal(result.diagnostics.localMusicalEvidence, true);
  assert.equal(result.diagnostics.localMusicalCompatibility, local.score);
  assert.equal(result.diagnostics.localHarmonicSimilarity, local.harmonicSimilarity);
  assert.equal(result.diagnostics.localKeyCompatibility, local.keyCompatibility);
  assert.equal(result.diagnostics.localMelodySimilarity, local.melodySimilarity);
  assert.equal(result.diagnostics.localMusicalConfidence, local.confidence);
  assert.equal(result.diagnostics.localAWindowStart, local.aWindowStart);
  assert.equal(result.diagnostics.localBWindowStart, local.bWindowStart);
  assert.equal(result.diagnostics.localAWindowDistance, local.aDistance);
  assert.equal(result.diagnostics.localBWindowDistance, local.bDistance);
  assert.deepEqual(result.diagnostics.localMusicalRisks, local.risks.slice(0, 3));
});

test('plans a Cuefield transition directly from Mineradio beatmap cache keys', () => {
  const cache = {
    'song:a': {
      key: 'song:a',
      meta: { provider: 'netease', title: 'Fortress', artist: 'Rogue' },
      map: makeCompressedMap(128),
    },
    'song:b': {
      key: 'song:b',
      meta: { provider: 'netease', title: 'TAKE ME', artist: 'D A N N Y' },
      map: makeCompressedMap(96),
    },
  };

  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.from.track.title, 'Fortress');
  assert.equal(result.to.track.title, 'TAKE ME');
  assert.equal(result.chosen.exit.role, 'exit');
  assert.equal(result.chosen.entry.role, 'entry');
  assert.equal(result.chosen.entry.source, 'fallback');
  assert.equal(result.chosen.entry.time, 0);
  assert.equal(typeof result.chosen.recipe, 'string');
  assert.equal(typeof result.chosen.evaluation.tier, 'string');
  assert.equal(Array.isArray(result.candidates), true);
  assert.equal(result.diagnostics.route, 'terminal-rescue');
  assert.deepEqual(result.diagnostics.routeReasons, ['missing-structure']);
  assert.equal(result.candidates.length, 0);
  assert.equal(Array.isArray(result.chosen.timeline), true);
  assert.equal(result.chosen.timeline.length > 0, true);
  assert.equal(typeof result.chosen.transitionRecipe, 'string');
});

test('plans only after the protected first hook when paired lyrics are available', () => {
  const cache = {
    'song:a': {
      key: 'song:a',
      meta: { provider: 'netease', title: 'A', artist: 'Artist A' },
      map: makeCompressedMap(128),
    },
    'song:b': {
      key: 'song:b',
      meta: { provider: 'netease', title: 'B', artist: 'Artist B' },
      map: makeCompressedMap(96),
    },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:18.00]we own the night\n[00:34.00]nothing feels the same\n[01:06.00]we own the night\n[01:22.00]nothing feels the same',
    toLrc: '[00:18.00]take me higher\n[00:34.00]feel it rising\n[01:06.00]take me higher\n[01:22.00]feel it rising',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.from.structureMap.structureSource, 'lyric+beat');
  assert.equal(result.to.structureMap.structureSource, 'lyric+beat');
  assert.equal(result.chosen.exit.time >= result.from.structureMap.protectedUntil, true);
  assert.equal(result.chosen.entry.time === 0 || result.chosen.entry.source !== 'fallback', true);
  assert.equal(result.diagnostics.structureSource, 'lyric+beat');
  assert.equal(result.diagnostics.exitCandidateCount > 0, true);
});

test('exposes the validated transition window and sanitized diagnostics', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:18.00]we own the night\n[00:34.00]nothing feels the same\n[01:06.00]we own the night\n[01:22.00]nothing feels the same',
    toLrc: '[00:18.00]take me higher\n[00:34.00]feel it rising\n[01:06.00]take me higher\n[01:22.00]feel it rising',
    readBeatMapCache: (key) => cache[key] || null,
  });

  const { chosen, diagnostics } = result;
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'windowPlan'), false);
  assert.equal(chosen.mixStart >= chosen.protectedUntil, true);
  assert.equal(chosen.audibleOverlap >= 3, true);
  assert.equal(chosen.exitRatio < 0.78, true);
  assert.equal(chosen.transitionRecipe, chosen.recipeCandidate.recipe);
  assert.equal(diagnostics.protectedUntil, chosen.protectedUntil);
  assert.equal(diagnostics.mixStart, chosen.mixStart);
  assert.equal(diagnostics.handoffAt, chosen.handoffAt);
  assert.equal(diagnostics.audibleOverlap, chosen.audibleOverlap);
  assert.equal(diagnostics.preRollDuration, chosen.preRollDuration);
  assert.equal(diagnostics.exitRatio, chosen.exitRatio);
  assert.equal(diagnostics.energyContinuity, chosen.energyContinuity);
  assert.equal(diagnostics.grooveContinuity, chosen.grooveContinuity);
  assert.equal(diagnostics.tempoCompatibility, chosen.tempoCompatibility);
  assert.equal(diagnostics.firstHookStart, 16);
  assert.equal(diagnostics.firstHookEnd, 40);
  assert.equal(diagnostics.hookConfidence, 0.88);
  assert.equal(diagnostics.hookEvidence.repeatedLineCount, 2);
  assert.equal(diagnostics.hookEvidence.repeatedBlockCount, 2);
  assert.equal(JSON.stringify({ diagnostics, candidates: result.candidates, rejected: result.rejected }).includes('we own the night'), false);
});

test('returns only compact summaries without profiles or raw lyrics', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:18.00]private lyric a sentinel\n[00:34.00]private lyric a second\n[01:06.00]private lyric a sentinel\n[01:22.00]private lyric a second',
    toLrc: '[00:18.00]private lyric b sentinel\n[00:34.00]private lyric b second\n[01:06.00]private lyric b sentinel\n[01:22.00]private lyric b second',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(typeof result.chosen.policy, 'object');
  assert.equal(result.chosen.policy.route, result.diagnostics.route);
  assert.equal(result.chosen.policy.compatibilityClass, result.diagnostics.compatibilityClass);
  assert.equal(result.chosen.policy.contrastDirection, result.diagnostics.contrastDirection);
  assert.deepEqual(result.chosen.policy.preferredExitRange, result.diagnostics.preferredExitRange);
  assert.deepEqual(result.chosen.policy.reasons, result.diagnostics.routeReasons);
  assert.equal(typeof result.chosen.routeFallbackUsed, 'boolean');
  assert.equal(result.chosen.routeFallbackUsed, result.diagnostics.routeFallbackUsed);
  assert.deepEqual(Object.keys(result.from).sort(), ['structureMap', 'track']);
  assert.deepEqual(Object.keys(result.to).sort(), ['structureMap', 'track']);
  const structureKeys = [
    'entryCandidateCount', 'entryCandidates', 'exitCandidateCount', 'exitCandidates', 'protectedUntil',
    'structureConfidence', 'structureSource',
  ];
  assert.deepEqual(Object.keys(result.from.structureMap).sort(), structureKeys.slice().sort());
  assert.deepEqual(Object.keys(result.to.structureMap).sort(), structureKeys.slice().sort());
  [result.from.structureMap, result.to.structureMap].forEach((structureMap) => {
    assert.equal(structureMap.entryCandidates.length <= 6, true);
    assert.equal(structureMap.exitCandidates.length <= 8, true);
  });
  const returnedCandidates = [result.from.structureMap, result.to.structureMap].flatMap((structureMap) => (
    structureMap.entryCandidates.concat(structureMap.exitCandidates)
  ));
  returnedCandidates.forEach((candidate) => {
    assert.deepEqual(Object.keys(candidate).sort(), [
      'confidence', 'landingAt', 'landingType', 'playFrom', 'role', 'source', 'time', 'type',
    ]);
  });
  const forbiddenCandidateFields = [
    'text', 'lyric', 'evidence', 'pitchclassprofile', 'intervalprofile',
    'melodycontour', 'audio', 'url',
  ];
  const assertCandidatePrivacy = (value, path = 'candidates') => {
    if (Array.isArray(value)) return value.forEach((item, index) => assertCandidatePrivacy(item, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    Object.entries(value).forEach(([key, nested]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
      assert.equal(forbiddenCandidateFields.some((field) => normalizedKey.includes(field)), false, `${path}.${key}`);
      assertCandidatePrivacy(nested, `${path}.${key}`);
    });
  };
  assertCandidatePrivacy({
    from: {
      entryCandidates: result.from.structureMap.entryCandidates,
      exitCandidates: result.from.structureMap.exitCandidates,
    },
    to: {
      entryCandidates: result.to.structureMap.entryCandidates,
      exitCandidates: result.to.structureMap.exitCandidates,
    },
  });
  const serialized = JSON.stringify(result);
  ['private lyric', 'cueProfile', 'sections', 'rawLrc', 'pitchClassProfile', 'intervalProfile', 'melodyContour', 'audioUrl', '"url"', '"text"', '"bars"', '"phrases"']
    .forEach((sentinel) => assert.equal(serialized.toLowerCase().includes(sentinel.toLowerCase()), false, sentinel));
});

test('runtime wrapper exposes compact BPM diagnostics and beat-only fallback never claims hook entry', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.diagnostics.bpmA, 120);
  assert.equal(result.diagnostics.bpmB, 120);
  assert.equal(['start', 'intro', 'drop'].includes(result.diagnostics.entryType), true);
  assert.equal(Number.isFinite(result.chosen.energyContinuity), true);
  assert.equal(Number.isFinite(result.chosen.grooveContinuity), true);
  assert.equal(Number.isFinite(result.chosen.tempoCompatibility), true);
});

test('uses a real zero-second fallback when paired lyrics are unavailable', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    readBeatMapCache: (key) => cache[key] || null,
  });
  assert.equal(result.diagnostics.structureSource, 'beat-only');
  assert.equal(result.chosen.entry.source, 'fallback');
  assert.equal(result.chosen.entry.time, 0);
});

test('normalizes empty bridge diagnostic metadata to finite values or null', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: {}, map: makeCompressedMap(0) },
    'song:b': { key: 'song:b', meta: {}, map: makeCompressedMap(0) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    readBeatMapCache: (key) => cache[key] || null,
  });
  const diagnostics = result.diagnostics;
  const numericKeys = [
    'structureConfidence', 'protectedUntil', 'firstHookStart', 'firstHookEnd',
    'hookConfidence', 'exitConfidence', 'exitRatio', 'entryConfidence', 'landingAt',
    'mixStart', 'handoffAt', 'audibleOverlap', 'preRollDuration',
    'energyContinuity', 'grooveContinuity', 'tempoCompatibility',
  ];
  numericKeys.forEach((key) => {
    assert.equal(Number.isNaN(diagnostics[key]), false, key);
    assert.equal(diagnostics[key] === null || Number.isFinite(diagnostics[key]), true, key);
  });
  assert.equal(diagnostics.exitConfidence, null);
  assert.equal(diagnostics.hookConfidence, null);
  assert.equal(diagnostics.localMusicalEvidence, false);
  [
    'localMusicalCompatibility', 'localHarmonicSimilarity', 'localKeyCompatibility',
    'localMelodySimilarity', 'localMusicalConfidence', 'localAWindowStart',
    'localBWindowStart', 'localAWindowDistance', 'localBWindowDistance',
  ].forEach((key) => assert.equal(diagnostics[key], null, key));
  assert.deepEqual(diagnostics.localMusicalRisks, []);
  assert.equal(diagnostics.entrySource, 'fallback');
  assert.deepEqual(diagnostics.windowRejectionReasons, ['no valid complete transition window']);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TERMINAL_RESCUE_INVALID_DURATION');
  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INVALID_DURATION');
  assert.equal(diagnostics.technicalFailure, true);
  assert.equal(diagnostics.errorCode, 'TERMINAL_RESCUE_INVALID_DURATION');
  assert.deepEqual(Object.keys(result.from).sort(), ['structureMap', 'track']);
});

test('reports an invalid target duration as an explicit technical failure', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(0) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'TERMINAL_RESCUE_INVALID_TARGET_DURATION');
  assert.equal(result.chosen.technicalFailure, true);
  assert.deepEqual(result.chosen.timeline, []);
});

test('preserves a lyric-backed B hook when A is beat-only', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    toLrc: '[00:18.00]take me higher\n[00:34.00]feel it rising\n[01:06.00]take me higher\n[01:22.00]feel it rising',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.from.structureMap.structureSource, 'beat-only');
  assert.equal(result.to.structureMap.structureSource, 'lyric+beat');
  assert.equal(result.chosen.entry.landingType, 'hook');
  assert.equal(result.diagnostics.entryType, 'hook');
});

test('does not expose a Hook landing from one repeated B lyric line', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    toLrc: '[00:18.00]one repeated line\n[01:06.00]one repeated line',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.notEqual(result.diagnostics.entryType, 'hook');
  assert.equal(result.candidates.some((candidate) => candidate.entry.landingType === 'hook'), false);
  assert.equal(result.rejected.some((candidate) => candidate.entry.landingType === 'hook'), false);
});

test('selects a compact synthetic bridge for a strongly linked trusted Hook', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(112) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:18.00]we keep moving\n[00:34.00]I see you tonight\n[01:06.00]we keep moving\n[01:22.00]I see you tonight',
    toLrc: '[00:18.00]You see me tonight\n[00:34.00]we keep moving\n[01:06.00]You see me tonight\n[01:22.00]we keep moving',
    syntheticBridgeEnabled: true,
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.equal(result.chosen.transitionRecipe, 'synthetic-bridge');
  assert.equal(result.chosen.bridgePlan.climax.type, 'hook');
  assert.equal(result.chosen.bridgePlan.climax.confidence >= 0.72, true);
  assert.equal([4, 8, 16].includes(result.chosen.bridgePlan.bars), true);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'bridge'), true);
  assert.equal(result.diagnostics.bridgeSelected, true);
  assert.equal(result.diagnostics.lyricLinkScore >= 0.65, true);
  assert.equal(JSON.stringify(result).includes('I see you tonight'), false);
  assert.equal(JSON.stringify(result).includes('You see me tonight'), false);
});

test('keeps synthetic bridge disabled for normal transition requests', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(112) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:18.00]we keep moving\n[00:34.00]I see you tonight\n[01:06.00]we keep moving\n[01:22.00]I see you tonight',
    toLrc: '[00:18.00]You see me tonight\n[00:34.00]we keep moving\n[01:06.00]You see me tonight\n[01:22.00]we keep moving',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.notEqual(result.chosen.transitionRecipe, 'synthetic-bridge');
  assert.equal(result.diagnostics.bridgeSelected, false);
  assert.equal(result.diagnostics.syntheticBridgeEnabled, false);
});

test('keeps the direct transition when B has no trusted climax', () => {
  const cache = {
    'song:a': { key: 'song:a', meta: { title: 'A' }, map: makeCompressedMap(128) },
    'song:b': { key: 'song:b', meta: { title: 'B' }, map: makeCompressedMap(96) },
  };
  const result = planCuefieldTransitionFromCache({
    fromKey: 'song:a',
    toKey: 'song:b',
    fromLrc: '[00:20.00]I call you',
    toLrc: '[00:30.00]you call me',
    readBeatMapCache: (key) => cache[key] || null,
  });

  assert.notEqual(result.chosen.transitionRecipe, 'synthetic-bridge');
  assert.equal(result.chosen.bridgePlan, undefined);
  assert.equal(result.diagnostics.bridgeSelected, false);
});

test('bounds recent recipe history before passing it into window planning', () => {
  const plannerPath = require.resolve('../cuefield/transition-window-planner');
  const bridgePath = require.resolve('../cuefield/mineradio-bridge');
  const plannerModule = require.cache[plannerPath];
  const originalChoose = plannerModule.exports.chooseTransitionWindow;
  const received = [];
  plannerModule.exports.chooseTransitionWindow = (from, to, opts) => {
    received.push(opts.recentRecipes);
    const blocked = opts.recentRecipes.includes('tease-roll-double-drop');
    const recipe = blocked ? 'quick-safe-fade' : 'tease-roll-double-drop';
    return {
      chosen: {
        exit: { type: 'release', role: 'exit', time: 80 },
        entry: { type: 'hook', role: 'entry', time: 16, landingAt: 16 },
        sectionChoice: { evaluation: { score: 0.8, tier: 'usable', risks: [] } },
        recipeCandidate: { recipe, timeline: [{ op: 'handoff', t: 0 }] },
        timeline: [{ op: 'handoff', t: 0 }],
      },
      candidates: [],
      rejected: [],
      diagnostics: {},
      policy: { route: 'structure-mix' },
    };
  };
  delete require.cache[bridgePath];

  try {
    const { planCuefieldTransitionFromCache: planWithCapture } = require('../cuefield/mineradio-bridge');
    const cache = {
      a: { key: 'a', map: makeCompressedMap(96) },
      b: { key: 'b', map: makeCompressedMap(96) },
    };
    const malformed = [null, {}, '', ' old ', 'x'.repeat(120), ' tease-roll-double-drop '];
    const blocked = planWithCapture({
      fromKey: 'a',
      toKey: 'b',
      recentRecipes: malformed,
      readBeatMapCache: (key) => cache[key],
    });
    const open = planWithCapture({
      fromKey: 'a',
      toKey: 'b',
      recentRecipes: ['quick-safe-fade'],
      readBeatMapCache: (key) => cache[key],
    });

    assert.deepEqual(received[0], ['x'.repeat(80), 'tease-roll-double-drop']);
    assert.deepEqual(received[1], ['quick-safe-fade']);
    assert.equal(blocked.chosen.transitionRecipe, 'quick-safe-fade');
    assert.equal(open.chosen.transitionRecipe, 'tease-roll-double-drop');
    assert.equal(JSON.stringify(blocked).includes('x'.repeat(81)), false);
  } finally {
    plannerModule.exports.chooseTransitionWindow = originalChoose;
    delete require.cache[bridgePath];
    require('../cuefield/mineradio-bridge');
  }
});

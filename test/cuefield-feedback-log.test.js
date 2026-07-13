const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendCuefieldFeedback,
  buildCuefieldFeedbackRecord,
  compactLocalMusical,
  readCuefieldFeedbackStats,
} = require('../cuefield/feedback-log');

test('keeps compact musical evidence and listening-floor diagnostics', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      minimumListenUntil: 100.8,
      musicalEvidence: true,
      musicalCompatibility: 0.82,
      harmonicSimilarity: 0.9,
      keyCompatibility: 0.78,
      melodySimilarity: 0.66,
      musicalRisks: ['harmonic-clash'],
    },
  });

  assert.equal(record.transition.minimumListenUntil, 100.8);
  assert.deepEqual(record.transition.musical, {
    evidence: true,
    compatibility: 0.82,
    harmonicSimilarity: 0.9,
    keyCompatibility: 0.78,
    melodySimilarity: 0.66,
    risks: ['harmonic-clash'],
  });
});

test('sanitizes compact impact execution diagnostics without retaining bulk transition data', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      impactEligible: true,
      teaserUsed: true,
      fakeOutMs: 139.6,
      impactFallbackRecipe: 'bass-eq-handoff' + 'x'.repeat(100),
      runtimeDowngrade: 'late-fake-gap-skipped',
      timeline: [{ at: 1, op: 'mix' }],
      actions: [{ op: 'drop' }],
      audioUrl: 'https://example.com/private.mp3',
      lyrics: 'private lyric sentinel',
      profile: [1, 2, 3],
      pitchClassProfile: [4, 5, 6],
    },
  });

  assert.equal(record.transition.impactEligible, true);
  assert.equal(record.transition.teaserUsed, true);
  assert.equal(record.transition.fakeOutMs, 140);
  assert.equal(record.transition.impactFallbackRecipe.length, 80);
  assert.equal(record.transition.runtimeDowngrade, 'late-fake-gap-skipped');
  const serialized = JSON.stringify(record);
  ['timeline', 'actions', 'audioUrl', 'private.mp3', 'lyrics', 'private lyric sentinel', 'profile', 'pitchClassProfile'].forEach((sentinel) => {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  });

  const malformed = [-10, 250, 27.4, NaN, undefined].map((fakeOutMs) => buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      impactEligible: 'true',
      teaserUsed: 1,
      fakeOutMs,
    },
  }).transition);
  assert.deepEqual(malformed.map((transition) => transition.fakeOutMs), [0, 200, 27, null, null]);
  malformed.forEach((transition) => {
    assert.equal(transition.impactEligible, false);
    assert.equal(transition.teaserUsed, false);
    assert.equal(transition.impactFallbackRecipe, '');
  });
});

test('keeps sanitized local musical diagnostics with rounded window metadata', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      localMusicalEvidence: true,
      localMusicalCompatibility: 0.81234,
      localHarmonicSimilarity: 0.90123,
      localKeyCompatibility: 0.78456,
      localMelodySimilarity: 0.66789,
      localMusicalConfidence: 0.87654,
      localAWindowStart: 12.34567,
      localBWindowStart: 23.45678,
      localAWindowDistance: 0.00456,
      localBWindowDistance: 1.23456,
      localMusicalRisks: ['harmonic-clash', 'melody-contour-contrast', 'late', 'privacy sentinel'],
      pitchClassProfile: [1, 2, 3],
      intervalProfile: [4, 5],
      melodyContour: [60, 62],
      notes: [{ pitch: 60 }],
      audioUrl: 'https://example.com/private.mp3',
      lyrics: 'private lyric sentinel',
    },
  });

  assert.deepEqual(record.transition.localMusical, {
    evidence: true,
    compatibility: 0.812,
    harmonicSimilarity: 0.901,
    keyCompatibility: 0.785,
    melodySimilarity: 0.668,
    confidence: 0.877,
    aWindowStart: 12.346,
    bWindowStart: 23.457,
    aDistance: 0.005,
    bDistance: 1.235,
    risks: ['harmonic-clash', 'melody-contour-contrast', 'late'],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(record.transition.localMusical, 'aWindowDistance'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record.transition.localMusical, 'bWindowDistance'), false);
  assert.deepEqual(compactLocalMusical({}), {
    evidence: false,
    compatibility: null,
    harmonicSimilarity: null,
    keyCompatibility: null,
    melodySimilarity: null,
    confidence: null,
    aWindowStart: null,
    bWindowStart: null,
    aDistance: null,
    bDistance: null,
    risks: [],
  });
  const nested = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      localMusical: {
        evidence: true,
        compatibility: 0.71234,
        harmonicSimilarity: 0.62345,
        keyCompatibility: 0.73456,
        melodySimilarity: 0.64567,
        confidence: 0.85678,
        aWindowStart: 4.56789,
        bWindowStart: 8.67891,
        aDistance: 0.01234,
        bDistance: 0.05678,
        risks: ['nested-risk'],
      },
    },
  });
  assert.deepEqual(nested.transition.localMusical, {
    evidence: true,
    compatibility: 0.712,
    harmonicSimilarity: 0.623,
    keyCompatibility: 0.735,
    melodySimilarity: 0.646,
    confidence: 0.857,
    aWindowStart: 4.568,
    bWindowStart: 8.679,
    aDistance: 0.012,
    bDistance: 0.057,
    risks: ['nested-risk'],
  });
  const serialized = JSON.stringify(record);
  ['pitchClassProfile', 'intervalProfile', 'melodyContour', 'notes', 'audioUrl', 'private.mp3', 'lyrics', 'private lyric sentinel'].forEach((sentinel) => {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  });
});

test('normalizes canonical, interim, and flat local musical diagnostic shapes', () => {
  const canonical = compactLocalMusical({
    localMusicalEvidence: '',
    localMusicalRisks: [],
    localAWindowDistance: '',
    localBWindowDistance: null,
    localMusical: {
      evidence: false,
      aDistance: 0,
      bDistance: 0,
      aWindowDistance: 1.234,
      bWindowDistance: 2.345,
      risks: ['nested-risk'],
    },
  });
  assert.deepEqual(canonical, {
    evidence: false,
    compatibility: null,
    harmonicSimilarity: null,
    keyCompatibility: null,
    melodySimilarity: null,
    confidence: null,
    aWindowStart: null,
    bWindowStart: null,
    aDistance: 0,
    bDistance: 0,
    risks: ['nested-risk'],
  });

  const interim = compactLocalMusical({
    localAWindowDistance: 9.876,
    localBWindowDistance: 8.765,
    localMusical: {
      aWindowDistance: 1.2345,
      bWindowDistance: 2.3456,
      risks: ['interim-risk'],
    },
  });
  assert.equal(interim.aDistance, 1.235);
  assert.equal(interim.bDistance, 2.346);
  assert.deepEqual(interim.risks, ['interim-risk']);

  const flat = compactLocalMusical({
    localAWindowDistance: 3.4567,
    localBWindowDistance: 4.5678,
    localMusicalRisks: ['flat-risk'],
  });
  assert.equal(flat.aDistance, 3.457);
  assert.equal(flat.bDistance, 4.568);
  assert.deepEqual(flat.risks, ['flat-risk']);
});

test('builds a compact Cuefield feedback record without audio urls', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    note: 'smooth enough',
    pair: {
      fromKey: 'song:a',
      toKey: 'song:b',
      fromTitle: 'A Song',
      fromArtist: 'A Artist',
      toTitle: 'B Song',
      toArtist: 'B Artist',
    },
    transition: {
      recipe: 'section-jump',
      transitionRecipe: 'safety-long-blend',
      score: 0.81234,
      tier: 'reject',
      evalScore: 0.49321,
      risks: ['directionality mismatch'],
      exitTime: 120.456,
      entryTime: 0,
      executionMode: 'safety-long-blend',
      overlapClass: 'short',
      overlapDuration: 3.1234,
      entrySource: 'fallback',
      entryConfidence: 0.5234,
      bpmA: 81.081,
      bpmB: 127.659,
      relativeTempoDelta: 0.36491,
      beatGridTrusted: true,
      runtimeDowngrade: 'volume-only',
      setMode: 'smart',
      bridgeSelected: true,
      bridgeTemplate: 'drum-build',
      bridgeBars: 8,
      bridgeClimaxType: 'hook',
      bridgeClimaxTime: 64.1234,
      bridgeClimaxConfidence: 0.8765,
      lyricLinkScore: 0.7123,
      lyricLinkReasons: ['call-response', 'token-overlap'],
      structureSource: 'lyric+beat',
      structureConfidence: 0.7842,
      protectedUntil: 64,
      exitType: 'release',
      exitConfidence: 0.8123,
      entryType: 'hook',
      exitCandidateCount: 4,
      entryCandidateCount: 3,
      rawLrc: '[00:01.00]must not persist',
      diagnostics: {
        outroCompleteness: 0.7234,
        bIntroAggression: 0.5294,
        styleTextureDistance: 0.1654,
      },
      audioUrl: 'https://example.com/audio.mp3',
      firstHookStart: 12.34567,
      firstHookEnd: 40.98765,
      hookConfidence: 0.87654,
      hookEvidence: {
        repeatedLineCount: 2.8,
        repeatedBlockCount: 1.2,
        energyLift: 0.65432,
        sustainedEnergy: true,
      },
      exitRatio: 0.71234,
      mixStart: 48.25678,
      handoffAt: 51.25999,
      landingAt: 32.12345,
      audibleOverlap: 3.87654,
      preRollDuration: 1.23456,
      energyContinuity: 0.76543,
      grooveContinuity: 0.65432,
      tempoCompatibility: 0.54321,
      windowRejectionReasons: ['too late', 'too late', 'x'.repeat(120)],
      route: 'late-contrast-rise',
      compatibilityClass: 'contrast',
      contrastDirection: 'rising',
      preferredExitRange: [0.75, 0.9],
      routeReasons: ['snap rise'],
      routeFallbackUsed: false,
    },
  }, new Date('2026-07-09T02:00:00.000Z'));

  assert.equal(record.rating, 1);
  assert.equal(record.createdAt, '2026-07-09T02:00:00.000Z');
  assert.equal(record.pair.fromKey, 'song:a');
  assert.equal(record.transition.transitionRecipe, 'safety-long-blend');
  assert.equal(record.transition.score, 0.812);
  assert.equal(record.transition.evalScore, 0.493);
  assert.equal(record.transition.exitTime, 120.456);
  assert.equal(record.transition.overlapClass, 'short');
  assert.equal(record.transition.overlapDuration, 3.123);
  assert.equal(record.transition.entrySource, 'fallback');
  assert.equal(record.transition.entryConfidence, 0.523);
  assert.equal(record.transition.bpmA, 81.081);
  assert.equal(record.transition.bpmB, 127.659);
  assert.equal(record.transition.relativeTempoDelta, 0.365);
  assert.equal(record.transition.beatGridTrusted, true);
  assert.equal(record.transition.runtimeDowngrade, 'volume-only');
  assert.equal(record.transition.setMode, 'smart');
  assert.deepEqual(record.transition.bridge, {
    selected: true,
    template: 'drum-build',
    bars: 8,
    climaxType: 'hook',
    climaxTime: 64.123,
    climaxConfidence: 0.877,
    lyricLinkScore: 0.712,
    lyricLinkReasons: ['call-response', 'token-overlap'],
  });
  assert.deepEqual(record.transition.diagnostics, {
    outroCompleteness: 0.723,
    bIntroAggression: 0.529,
    styleTextureDistance: 0.165,
  });
  assert.deepEqual(record.transition.structure, {
    source: 'lyric+beat',
    confidence: 0.784,
    protectedUntil: 64,
    exitType: 'release',
    exitConfidence: 0.812,
    entryType: 'hook',
    entryConfidence: 0.523,
    exitCandidateCount: 4,
    entryCandidateCount: 3,
  });
  assert.deepEqual(record.transition.risks, ['directionality mismatch']);
  assert.equal(record.transition.route, 'late-contrast-rise');
  assert.equal(record.transition.compatibilityClass, 'contrast');
  assert.equal(record.transition.contrastDirection, 'rising');
  assert.deepEqual(record.transition.preferredExitRange, [0.75, 0.9]);
  assert.deepEqual(record.transition.routeReasons, ['snap rise']);
  assert.equal(record.transition.routeFallbackUsed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(record.transition, 'audioUrl'), false);
  assert.equal(JSON.stringify(record).includes('must not persist'), false);
  assert.deepEqual(record.transition.window, {
    firstHookStart: 12.346,
    firstHookEnd: 40.988,
    hookConfidence: 0.877,
    hookEvidence: {
      repeatedLineCount: 3,
      repeatedBlockCount: 1,
      energyLift: 0.654,
      sustainedEnergy: true,
    },
    exitRatio: 0.712,
    mixStart: 48.257,
    handoffAt: 51.26,
    landingAt: 32.123,
    audibleOverlap: 3.877,
    preRollDuration: 1.235,
    energyContinuity: 0.765,
    grooveContinuity: 0.654,
    tempoCompatibility: 0.543,
    rejectionReasons: ['too late', 'x'.repeat(96)],
  });
});

test('normalizes malformed transition window values and keeps reasons bounded', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 2,
    transition: {
      firstHookStart: Infinity,
      firstHookEnd: NaN,
      hookConfidence: 'bad',
      hookEvidence: {
        repeatedLineCount: -4,
        repeatedBlockCount: Infinity,
        energyLift: NaN,
        sustainedEnergy: 0.12345,
      },
      exitRatio: Infinity,
      mixStart: NaN,
      handoffAt: undefined,
      landingAt: 1.23456,
      audibleOverlap: 2.34567,
      preRollDuration: 3.45678,
      energyContinuity: 4.56789,
      grooveContinuity: -Infinity,
      tempoCompatibility: 5.6789,
      windowRejectionReasons: ['same', 'same', '', null, ...Array.from({ length: 10 }, (_, i) => 'reason ' + i)],
    },
  });

  assert.deepEqual(record.transition.window, {
    firstHookStart: null,
    firstHookEnd: null,
    hookConfidence: null,
    hookEvidence: {
      repeatedLineCount: 0,
      repeatedBlockCount: null,
      energyLift: null,
      sustainedEnergy: 0.123,
    },
    exitRatio: null,
    mixStart: null,
    handoffAt: null,
    landingAt: 1.235,
    audibleOverlap: 2.346,
    preRollDuration: 3.457,
    energyContinuity: 4.568,
    grooveContinuity: null,
    tempoCompatibility: 5.679,
    rejectionReasons: ['same', 'reason 0', 'reason 1', 'reason 2', 'reason 3', 'reason 4', 'reason 5', 'reason 6'],
  });
  assert.equal(JSON.stringify(record).includes('Infinity'), false);
  assert.equal(JSON.stringify(record).includes('NaN'), false);
});

test('accepts rejection reasons from an already-sanitized nested transition window', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: {
      window: {
        rejectionReasons: ['nested reason', 'nested reason'],
      },
    },
  });

  assert.deepEqual(record.transition.window.rejectionReasons, ['nested reason']);
});

test('sanitizes route diagnostics to compact bounded values', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 2,
    transition: {
      route: 'r'.repeat(120),
      compatibilityClass: 'c'.repeat(120),
      contrastDirection: 'd'.repeat(120),
      preferredExitRange: [1.4, -0.2],
      routeReasons: ['same', 'same', 'x'.repeat(120), 'reason 2', 'reason 3', 'reason 4'],
      routeFallbackUsed: true,
    },
  });

  assert.equal(typeof record.transition.route, 'string');
  assert.equal(record.transition.route.length <= 40, true);
  assert.equal(record.transition.compatibilityClass.length <= 40, true);
  assert.equal(record.transition.contrastDirection.length <= 40, true);
  assert.deepEqual(record.transition.preferredExitRange, [0, 1]);
  assert.deepEqual(record.transition.routeReasons, ['same', 'x'.repeat(96), 'reason 2', 'reason 3']);
  assert.equal(record.transition.routeFallbackUsed, true);

  const malformed = buildCuefieldFeedbackRecord({
    rating: 3,
    transition: {
      preferredExitRange: [0.75, Infinity],
      routeFallbackUsed: 'true',
    },
  });
  assert.deepEqual(malformed.transition.preferredExitRange, []);
  assert.equal(malformed.transition.routeFallbackUsed, false);
});

test('rejects ratings outside the 1 to 3 scoring scale', () => {
  assert.throws(() => buildCuefieldFeedbackRecord({ rating: 4 }), /RATING_MUST_BE_1_2_OR_3/);
  assert.throws(() => buildCuefieldFeedbackRecord({ rating: 'bad' }), /RATING_MUST_BE_1_2_OR_3/);
});

test('appends one feedback record per JSONL line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-feedback-'));
  const file = path.join(dir, 'feedback.jsonl');

  const record = appendCuefieldFeedback(file, {
    rating: 3,
    pair: { fromKey: 'song:a', toKey: 'song:b' },
    transition: { transitionRecipe: 'safety-long-blend', tier: 'weak' },
  }, new Date('2026-07-09T03:00:00.000Z'));

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), record);
  assert.equal(record.rating, 3);
});

test('keeps older feedback records readable without adaptive diagnostics', () => {
  const record = buildCuefieldFeedbackRecord({
    rating: 1,
    transition: { transitionRecipe: 'safety-long-blend' },
  });

  assert.equal(record.transition.transitionRecipe, 'safety-long-blend');
  assert.equal(record.transition.overlapClass, '');
  assert.equal(record.transition.overlapDuration, null);
  assert.equal(record.transition.beatGridTrusted, false);
  assert.equal(record.transition.impactEligible, false);
  assert.equal(record.transition.teaserUsed, false);
  assert.equal(record.transition.fakeOutMs, null);
  assert.equal(record.transition.impactFallbackRecipe, '');
  assert.deepEqual(record.transition.window, {
    firstHookStart: null,
    firstHookEnd: null,
    hookConfidence: null,
    hookEvidence: {
      repeatedLineCount: null,
      repeatedBlockCount: null,
      energyLift: null,
      sustainedEnergy: null,
    },
    exitRatio: null,
    mixStart: null,
    handoffAt: null,
    landingAt: null,
    audibleOverlap: null,
    preRollDuration: null,
    energyContinuity: null,
    grooveContinuity: null,
    tempoCompatibility: null,
    rejectionReasons: [],
  });
  assert.deepEqual(record.transition.localMusical, {
    evidence: false,
    compatibility: null,
    harmonicSimilarity: null,
    keyCompatibility: null,
    melodySimilarity: null,
    confidence: null,
    aWindowStart: null,
    bWindowStart: null,
    aDistance: null,
    bDistance: null,
    risks: [],
  });
});

test('reads legacy feedback JSONL stats without local musical diagnostics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-feedback-'));
  const file = path.join(dir, 'feedback.jsonl');
  fs.writeFileSync(file, JSON.stringify({
    createdAt: '2026-07-08T03:00:00.000Z',
    rating: 2,
    pair: { fromKey: 'legacy:a', toKey: 'legacy:b' },
    transition: { transitionRecipe: 'legacy-blend', risks: ['old risk'] },
  }) + '\n');

  const stats = readCuefieldFeedbackStats(file);

  assert.equal(stats.total, 1);
  assert.equal(stats.byRecipe[0].key, 'legacy-blend');
  assert.equal(stats.failedSamples[0].transition.transitionRecipe, 'legacy-blend');
  assert.deepEqual(stats.failedSamples[0].transition.localMusical, {
    evidence: false,
    compatibility: null,
    harmonicSimilarity: null,
    keyCompatibility: null,
    melodySimilarity: null,
    confidence: null,
    aWindowStart: null,
    bWindowStart: null,
    aDistance: null,
    bDistance: null,
    risks: [],
  });
});

test('summarizes Cuefield feedback by recipe, tier, risk, and failed samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-feedback-'));
  const file = path.join(dir, 'feedback.jsonl');
  const rows = [
    {
      rating: 1,
      pair: { fromKey: 'a', toKey: 'b', fromTitle: 'A', toTitle: 'B' },
      transition: { transitionRecipe: 'safety-long-blend', tier: 'reject', overlapClass: 'long', risks: ['directionality mismatch'] },
    },
    {
      rating: 2,
      note: 'B too loud',
      pair: { fromKey: 'c', toKey: 'd', fromTitle: 'C', toTitle: 'D' },
      transition: { transitionRecipe: 'safety-long-blend', tier: 'reject', overlapClass: 'short', risks: ['style bridge mismatch'] },
    },
    {
      rating: 3,
      pair: { fromKey: 'e', toKey: 'f', fromTitle: 'E', toTitle: 'F' },
      transition: { transitionRecipe: 'filtered-pickup', tier: 'weak', overlapClass: 'short', risks: ['noticeable energy change'] },
    },
  ];
  rows.forEach((row, index) => appendCuefieldFeedback(file, row, new Date(Date.UTC(2026, 6, 9, 3, index))));

  const stats = readCuefieldFeedbackStats(file);

  assert.equal(stats.total, 3);
  assert.deepEqual(stats.ratingCounts, { 1: 1, 2: 1, 3: 1 });
  assert.equal(stats.passRate, 0.333);
  assert.deepEqual(stats.byRecipe[0], {
    key: 'safety-long-blend',
    total: 2,
    passed: 1,
    failed: 1,
    pending: 0,
    passRate: 0.5,
  });
  assert.equal(stats.byTier.find((item) => item.key === 'reject').passRate, 0.5);
  assert.equal(stats.byOverlapClass.find((item) => item.key === 'short').failed, 1);
  assert.equal(stats.byOverlapClass.find((item) => item.key === 'long').passed, 1);
  assert.equal(stats.byRisk.find((item) => item.key === 'style bridge mismatch').failed, 1);
  assert.equal(stats.failedSamples.length, 2);
  assert.equal(stats.failedSamples[0].rating, 2);
  assert.equal(stats.failedSamples[0].transition.transitionRecipe, 'safety-long-blend');
});

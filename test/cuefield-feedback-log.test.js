const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendCuefieldFeedback,
  buildCuefieldFeedbackRecord,
  readCuefieldFeedbackStats,
} = require('../cuefield/feedback-log');

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
      rejectionReasons: ['too late', 'too late', 'x'.repeat(120)],
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
      rejectionReasons: ['same', 'same', '', null, ...Array.from({ length: 10 }, (_, i) => 'reason ' + i)],
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

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
      audioUrl: 'https://example.com/audio.mp3',
    },
  }, new Date('2026-07-09T02:00:00.000Z'));

  assert.equal(record.rating, 1);
  assert.equal(record.createdAt, '2026-07-09T02:00:00.000Z');
  assert.equal(record.pair.fromKey, 'song:a');
  assert.equal(record.transition.transitionRecipe, 'safety-long-blend');
  assert.equal(record.transition.score, 0.812);
  assert.equal(record.transition.evalScore, 0.493);
  assert.equal(record.transition.exitTime, 120.456);
  assert.deepEqual(record.transition.risks, ['directionality mismatch']);
  assert.equal(Object.prototype.hasOwnProperty.call(record.transition, 'audioUrl'), false);
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

test('summarizes Cuefield feedback by recipe, tier, risk, and failed samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-feedback-'));
  const file = path.join(dir, 'feedback.jsonl');
  const rows = [
    {
      rating: 1,
      pair: { fromKey: 'a', toKey: 'b', fromTitle: 'A', toTitle: 'B' },
      transition: { transitionRecipe: 'safety-long-blend', tier: 'reject', risks: ['directionality mismatch'] },
    },
    {
      rating: 2,
      note: 'B too loud',
      pair: { fromKey: 'c', toKey: 'd', fromTitle: 'C', toTitle: 'D' },
      transition: { transitionRecipe: 'safety-long-blend', tier: 'reject', risks: ['style bridge mismatch'] },
    },
    {
      rating: 3,
      pair: { fromKey: 'e', toKey: 'f', fromTitle: 'E', toTitle: 'F' },
      transition: { transitionRecipe: 'filtered-pickup', tier: 'weak', risks: ['noticeable energy change'] },
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
  assert.equal(stats.byRisk.find((item) => item.key === 'style bridge mismatch').failed, 1);
  assert.equal(stats.failedSamples.length, 2);
  assert.equal(stats.failedSamples[0].rating, 2);
  assert.equal(stats.failedSamples[0].transition.transitionRecipe, 'safety-long-blend');
});

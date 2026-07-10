const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRemoteFeedbackPayload,
  forwardCuefieldFeedback,
  remoteFeedbackConfig,
} = require('../cuefield/feedback-remote');

test('keeps remote Cuefield feedback disabled unless an http endpoint is configured', () => {
  assert.equal(remoteFeedbackConfig({}), null);
  assert.equal(remoteFeedbackConfig({ CUEFIELD_FEEDBACK_REMOTE_URL: 'file:///tmp/feedback' }), null);
});

test('builds a compact remote feedback payload without audio URLs', () => {
  const payload = buildRemoteFeedbackPayload({
    createdAt: '2026-07-09T06:00:00.000Z',
    rating: 1,
    note: 'smooth',
    pair: { fromKey: 'song:a', toKey: 'song:b' },
    transition: {
      transitionRecipe: 'safety-long-blend',
      overlapClass: 'short',
      overlapDuration: 3.1,
      entrySource: 'fallback',
      entryConfidence: 0.52,
      bpmA: 81.08,
      bpmB: 127.66,
      relativeTempoDelta: 0.365,
      beatGridTrusted: true,
      runtimeDowngrade: 'volume-only',
      structure: {
        source: 'lyric+beat',
        confidence: 0.78,
        protectedUntil: 64,
        exitType: 'release',
        exitConfidence: 0.81,
        entryType: 'hook',
        entryConfidence: 0.84,
        exitCandidateCount: 4,
        entryCandidateCount: 3,
      },
      diagnostics: {
        outroCompleteness: 0.72,
        bIntroAggression: 0.53,
        styleTextureDistance: 0.17,
      },
      audioUrl: 'https://example.com/song.mp3',
      firstHookStart: 12.3456,
      firstHookEnd: 40.9876,
      hookConfidence: 0.8765,
      hookEvidence: { repeatedLineCount: 2, repeatedBlockCount: 1, energyLift: 0.6543, sustainedEnergy: true },
      exitRatio: 0.7123,
      mixStart: 48.2567,
      handoffAt: 51.2599,
      landingAt: 32.1234,
      audibleOverlap: 3.8765,
      preRollDuration: 1.2345,
      energyContinuity: 0.7654,
      grooveContinuity: 0.6543,
      tempoCompatibility: 0.5432,
      windowRejectionReasons: ['late', 'late'],
    },
  }, { source: 'tester-a' });

  assert.equal(payload.source, 'tester-a');
  assert.equal(payload.schema, 'cuefield-feedback-v1');
  assert.equal(payload.record.rating, 1);
  assert.equal(payload.record.transition.transitionRecipe, 'safety-long-blend');
  assert.equal(payload.record.transition.overlapClass, 'short');
  assert.equal(payload.record.transition.relativeTempoDelta, 0.365);
  assert.equal(payload.record.transition.beatGridTrusted, true);
  assert.equal(payload.record.transition.runtimeDowngrade, 'volume-only');
  assert.deepEqual(payload.record.transition.diagnostics, {
    outroCompleteness: 0.72,
    bIntroAggression: 0.53,
    styleTextureDistance: 0.17,
  });
  assert.deepEqual(payload.record.transition.structure, {
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
  assert.equal(Object.prototype.hasOwnProperty.call(payload.record.transition, 'audioUrl'), false);
  assert.deepEqual(payload.record.transition.window, {
    firstHookStart: 12.346,
    firstHookEnd: 40.988,
    hookConfidence: 0.877,
    hookEvidence: { repeatedLineCount: 2, repeatedBlockCount: 1, energyLift: 0.654, sustainedEnergy: true },
    exitRatio: 0.712,
    mixStart: 48.257,
    handoffAt: 51.26,
    landingAt: 32.123,
    audibleOverlap: 3.877,
    preRollDuration: 1.235,
    energyContinuity: 0.765,
    grooveContinuity: 0.654,
    tempoCompatibility: 0.543,
    rejectionReasons: ['late'],
  });
});

test('remote transition window uses the same sanitized semantics as local feedback', () => {
  const payload = buildRemoteFeedbackPayload({
    transition: {
      firstHookStart: Infinity,
      hookEvidence: { repeatedLineCount: NaN, sustainedEnergy: 0.12345 },
      mixStart: 10.98765,
      windowRejectionReasons: ['x'.repeat(120), 'x'.repeat(120)],
    },
  });
  assert.deepEqual(payload.record.transition.window, {
    firstHookStart: null,
    firstHookEnd: null,
    hookConfidence: null,
    hookEvidence: { repeatedLineCount: null, repeatedBlockCount: null, energyLift: null, sustainedEnergy: 0.123 },
    exitRatio: null,
    mixStart: 10.988,
    handoffAt: null,
    landingAt: null,
    audibleOverlap: null,
    preRollDuration: null,
    energyContinuity: null,
    grooveContinuity: null,
    tempoCompatibility: null,
    rejectionReasons: ['x'.repeat(96)],
  });
  assert.equal(JSON.stringify(payload).includes('Infinity'), false);
});

test('remote preserves rejection reasons from an already-sanitized nested window', () => {
  const payload = buildRemoteFeedbackPayload({
    transition: {
      window: {
        rejectionReasons: ['nested remote reason', 'nested remote reason'],
      },
    },
  });

  assert.deepEqual(payload.record.transition.window.rejectionReasons, ['nested remote reason']);
});

test('forwards Cuefield feedback with bearer auth when configured', async () => {
  const calls = [];
  const result = await forwardCuefieldFeedback({ rating: 2 }, {
    config: {
      url: 'https://collector.example.test/cuefield',
      token: 'test-token',
      source: 'tester-a',
      timeoutMs: 100,
    },
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 202 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://collector.example.test/cuefield');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(calls[0].opts.body).source, 'tester-a');
});

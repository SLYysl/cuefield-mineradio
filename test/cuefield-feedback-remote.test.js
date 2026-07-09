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
      audioUrl: 'https://example.com/song.mp3',
    },
  }, { source: 'tester-a' });

  assert.equal(payload.source, 'tester-a');
  assert.equal(payload.schema, 'cuefield-feedback-v1');
  assert.equal(payload.record.rating, 1);
  assert.equal(payload.record.transition.transitionRecipe, 'safety-long-blend');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.record.transition, 'audioUrl'), false);
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

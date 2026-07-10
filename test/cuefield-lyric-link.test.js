const assert = require('node:assert/strict');
const test = require('node:test');

const { scoreLyricLink } = require('../cuefield/lyric-link');

test('scores Chinese character overlap without exposing lyric text', () => {
  const result = scoreLyricLink({
    fromLines: [{ time: 40, text: '我还在等你回来' }],
    toLines: [{ time: 60, text: '等你回来 我就在这里' }],
    exitTime: 42,
    climaxTime: 60,
  });

  assert.equal(result.score > 0.45, true);
  assert.equal(result.reasons.includes('token-overlap'), true);
  assert.equal(JSON.stringify(result).includes('等你'), false);
  assert.deepEqual(Object.keys(result).sort(), ['reasons', 'score']);
});

test('detects English and Chinese call-response pronouns', () => {
  const english = scoreLyricLink({
    fromLines: [{ time: 20, text: 'I keep calling' }],
    toLines: [{ time: 30, text: 'You know my name' }],
    exitTime: 22,
    climaxTime: 30,
  });
  const chinese = scoreLyricLink({
    fromLines: [{ time: 20, text: '你是否听见' }],
    toLines: [{ time: 30, text: '我一直都听见' }],
    exitTime: 22,
    climaxTime: 30,
  });

  assert.equal(english.reasons.includes('call-response'), true);
  assert.equal(chinese.reasons.includes('call-response'), true);
});

test('adds bounded suffix similarity for a rhyme-like handoff', () => {
  const linked = scoreLyricLink({
    fromLines: [{ time: 20, text: 'falling through the night' }],
    toLines: [{ time: 30, text: 'calling in the light' }],
    exitTime: 22,
    climaxTime: 30,
  });
  const unrelated = scoreLyricLink({
    fromLines: [{ time: 20, text: 'falling through the night' }],
    toLines: [{ time: 30, text: 'break the concrete wall' }],
    exitTime: 22,
    climaxTime: 30,
  });

  assert.equal(linked.reasons.includes('suffix-link'), true);
  assert.equal(linked.score > unrelated.score, true);
  assert.equal(linked.score <= 1, true);
});

test('penalizes uncontrolled lead-vocal overlap and handles missing lines', () => {
  const clean = scoreLyricLink({
    fromLines: [{ time: 20, text: 'I see you' }],
    toLines: [{ time: 30, text: 'You see me' }],
    exitTime: 22,
    climaxTime: 30,
    vocalOverlapSec: 0.5,
  });
  const collision = scoreLyricLink({
    fromLines: [{ time: 20, text: 'I see you' }],
    toLines: [{ time: 30, text: 'You see me' }],
    exitTime: 22,
    climaxTime: 30,
    vocalOverlapSec: 3,
  });

  assert.equal(collision.reasons.includes('vocal-collision'), true);
  assert.equal(collision.score < clean.score, true);
  assert.deepEqual(scoreLyricLink({ fromLines: [], toLines: [] }), { score: 0, reasons: ['missing-lines'] });
});

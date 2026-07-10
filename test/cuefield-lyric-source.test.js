const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fetchRawLrc,
  lyricEndpointForSong,
  rawLrcFromPayload,
} = require('../public/cuefield-lyric-source');

test('builds provider lyric endpoints without touching playback state', () => {
  assert.equal(lyricEndpointForSong({ id: 123 }, 'netease'), '/api/lyric?id=123');
  assert.equal(lyricEndpointForSong({ mid: 'abc', qqId: 456 }, 'qq'), '/api/qq/lyric?mid=abc&id=456');
});

test('returns only raw timed LRC for planning', () => {
  assert.equal(rawLrcFromPayload({ lyric: '[00:01.00]line', yrc: 'ignored' }), '[00:01.00]line');
  assert.equal(rawLrcFromPayload({}), '');
});

test('degrades a provider lyric failure to an empty string', async () => {
  const result = await fetchRawLrc({ id: 123 }, 'netease', async () => {
    throw new Error('offline');
  });

  assert.equal(result, '');
});

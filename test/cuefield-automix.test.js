const assert = require('node:assert/strict');
const test = require('node:test');

const { createCuefieldAutoMix } = require('../public/cuefield-automix');

test('prepares a transition for the current and next queue items before playback reaches the exit', async () => {
  const calls = [];
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async (song, key) => {
      calls.push(['beatmap', key]);
      return true;
    },
    planTransition: async (fromKey, toKey) => {
      calls.push(['plan', fromKey, toKey]);
      return {
        ok: true,
        chosen: {
          recipe: 'section-jump',
          score: 0.86,
          exit: { time: 42 },
          entry: { time: 12 },
          evaluation: { tier: 'usable', risks: [] },
        },
      };
    },
    prepareAudioUrl: async (song) => {
      calls.push(['audio', song.key]);
      return '/api/audio?url=b';
    },
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 7,
    currentIndex: 1,
    nextIndex: 2,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(calls, [
    ['beatmap', 'a'],
    ['beatmap', 'b'],
    ['plan', 'a', 'b'],
    ['audio', 'b'],
  ]);
  assert.equal(automix.shouldTrigger({ token: 7, currentIndex: 1, currentTime: 40.9 }), false);
  assert.equal(automix.shouldTrigger({ token: 7, currentIndex: 1, currentTime: 41 }), true);
});

test('keeps weak or rejected transition plans as fallback instead of auto executing', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.63,
        exit: { time: 28 },
        entry: { time: 4 },
        evaluation: { tier: 'weak', risks: ['directionality mismatch'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 2,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 2, currentIndex: 0, currentTime: 29 }), false);
});

test('does not reuse a prepared transition after queue token or index changes', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.88,
        exit: { time: 16 },
        entry: { time: 8 },
        evaluation: { tier: 'usable', risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  await automix.prepare({
    token: 4,
    currentIndex: 2,
    nextIndex: 3,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(automix.shouldTrigger({ token: 5, currentIndex: 2, currentTime: 20 }), false);
  assert.equal(automix.shouldTrigger({ token: 4, currentIndex: 1, currentTime: 20 }), false);
  assert.equal(automix.shouldTrigger({ token: 4, currentIndex: 2, currentTime: 20 }), true);
});

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

test('can execute weak transition plans in soft automix mode when no hard risk is present', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.58,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.64,
        exit: { time: 28 },
        entry: { time: 4 },
        evaluation: { score: 0.63, tier: 'weak', risks: ['directionality mismatch'] },
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

  assert.equal(result.status, 'ready');
  assert.equal(automix.shouldTrigger({ token: 2, currentIndex: 0, currentTime: 27 }), true);
});

test('assigns filtered pickup to usable plans and intro bed to weak plans', async () => {
  const makeAutomix = (tier, score) => createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.82,
        exit: { time: 40 },
        entry: { time: 10 },
        evaluation: { score, tier, risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  const usable = makeAutomix('usable', 0.86);
  usable.setEnabled(true);
  const usableResult = await usable.prepare({
    token: 8,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  const weak = makeAutomix('weak', 0.57);
  weak.setEnabled(true);
  const weakResult = await weak.prepare({
    token: 9,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 2.8,
    introBedLeadSec: 5.2,
  });

  assert.equal(usableResult.pending.executionMode, 'filtered-pickup');
  assert.equal(weakResult.pending.executionMode, 'intro-bed');
  assert.equal(weakResult.pending.triggerAt, 34.8);
});

test('uses recipe planner timeline for execution mode, trigger lead, and B start', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'outro-to-chorus',
        transitionRecipe: 'intro-outro-long-blend',
        score: 0.9,
        exit: { time: 40 },
        entry: { time: 24 },
        evaluation: { score: 0.86, tier: 'usable', risks: [] },
        timeline: [
          { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
          { t: 0, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 10,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 2.8,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.pending.executionMode, 'intro-outro-long-blend');
  assert.equal(result.pending.entryTime, 8);
  assert.equal(result.pending.triggerAt, 32);
  assert.equal(result.pending.timeline.length, 2);
});

test('does not execute weak transition plans with hard outgoing phrase risk', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.58,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.66,
        exit: { time: 30 },
        entry: { time: 5 },
        evaluation: { score: 0.64, tier: 'weak', risks: ['closed outgoing phrase'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 3,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 3, currentIndex: 0, currentTime: 29 }), false);
});

test('does not execute rejected plans even when soft automix mode allows weak plans', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.5,
        exit: { time: 30 },
        entry: { time: 6 },
        evaluation: { score: 0.42, tier: 'reject', risks: ['directionality mismatch'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 6,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 6, currentIndex: 0, currentTime: 29 }), false);
});

test('executes safety long blend even when the section evaluation is rejected', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    allowSafetyFallback: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        transitionRecipe: 'safety-long-blend',
        score: 0.5,
        exit: { time: 48 },
        entry: { time: 32 },
        evaluation: { score: 0.42, tier: 'reject', risks: ['directionality mismatch'] },
        timeline: [
          { t: -12, deck: 'B', op: 'play', at: 0, volume: 0 },
          { t: -12, deck: 'B', op: 'volume', value: 0.24, duration: 2600 },
          { t: 4.8, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 12,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.pending.executionMode, 'safety-long-blend');
  assert.equal(result.pending.entryTime, 0);
  assert.equal(result.pending.triggerAt, 36);
  assert.equal(automix.shouldTrigger({ token: 12, currentIndex: 0, currentTime: 36 }), true);
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

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
  assert.equal(result.to.candidates.find((candidate) => candidate.role === 'entry').source, 'fallback');
  assert.equal(result.chosen.entry.source, 'fallback');
  assert.equal(typeof result.chosen.recipe, 'string');
  assert.equal(typeof result.chosen.evaluation.tier, 'string');
  assert.equal(Array.isArray(result.candidates), true);
  assert.equal(result.candidates.length >= 4, true);
  assert.equal(Array.isArray(result.chosen.timeline), true);
  assert.equal(result.chosen.timeline.length > 0, true);
  assert.equal(typeof result.chosen.transitionRecipe, 'string');
});

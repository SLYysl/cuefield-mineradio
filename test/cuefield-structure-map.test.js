const assert = require('node:assert/strict');
const test = require('node:test');

const { buildStructureMap } = require('../cuefield/structure-map');

function makeProfile(energies, duration = energies.length * 16) {
  return {
    duration,
    gridStep: 0.5,
    phrases: energies.map((energy, index) => ({
      index,
      start: index * 16,
      end: (index + 1) * 16,
      energy,
    })),
    bars: energies.flatMap((energy, phrase) => Array.from({ length: 8 }, (_, bar) => ({
      start: phrase * 16 + bar * 2,
      end: phrase * 16 + (bar + 1) * 2,
      energy,
      lowDensity: energy * 0.6,
      beatStability: 0.9,
    }))),
  };
}

test('protects through the end of the first repeated high-energy hook', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.76, 0.44, 0.71, 0.38]),
    lrcLines: [
      { time: 18, text: 'we own the night', normalized: 'we own the night' },
      { time: 22, text: 'nothing feels the same', normalized: 'nothing feels the same' },
      { time: 50, text: 'we own the night', normalized: 'we own the night' },
      { time: 54, text: 'nothing feels the same', normalized: 'nothing feels the same' },
    ],
  });

  assert.equal(map.structureSource, 'lyric+beat');
  assert.equal(map.sections.some((section) => section.type === 'hook' && section.start === 16), true);
  assert.equal(map.protectedUntil, 32);
  assert.equal(map.exitCandidates.every((item) => item.time >= 32), true);
});

test('does not end protection on a transient early peak', () => {
  const map = buildStructureMap({ profile: makeProfile([0.9, 0.35, 0.72, 0.69, 0.4]), lrcLines: [] });

  assert.equal(map.protectedUntil >= 48, true);
  assert.equal(map.structureSource, 'beat-only');
});

test('uses a real zero-second fallback instead of a synthetic intro', () => {
  const map = buildStructureMap({ profile: makeProfile([0.4, 0.42, 0.39, 0.41]), lrcLines: [] });
  const fallback = map.entryCandidates.find((item) => item.source === 'fallback');

  assert.equal(fallback.time, 0);
  assert.equal(map.entryCandidates.some((item) => item.time >= 12 && item.time <= 16 && item.source === 'fallback'), false);
});

test('labels a falling post-hook phrase as a release', () => {
  const map = buildStructureMap({ profile: makeProfile([0.3, 0.8, 0.68, 0.42, 0.3]), lrcLines: [] });

  assert.equal(map.exitCandidates.some((item) => item.type === 'release'), true);
});

test('exposes pre-hook and hook as separate B entry choices', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.76, 0.44, 0.71]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 50, normalized: 'we own the night' },
    ],
  });

  assert.equal(map.entryCandidates.some((item) => item.type === 'pre-hook'), true);
  assert.equal(map.entryCandidates.some((item) => item.type === 'hook'), true);
});

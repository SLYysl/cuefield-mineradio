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

test('repeated contiguous lyric blocks become one evidence-backed hook', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.74, 0.44, 0.72, 0.7]),
    lrcLines: [
      { time: 18, text: 'we own the night', normalized: 'we own the night' },
      { time: 34, text: 'nothing feels the same', normalized: 'nothing feels the same' },
      { time: 66, text: 'we own the night', normalized: 'we own the night' },
      { time: 82, text: 'nothing feels the same', normalized: 'nothing feels the same' },
    ],
  });

  assert.equal(map.structureSource, 'lyric+beat');
  const hook = map.sections.find((section) => section.type === 'hook');
  assert.equal(hook.start, 16);
  assert.equal(hook.end, 48);
  assert.equal(hook.evidence.repeatedLineCount, 2);
  assert.equal(hook.evidence.repeatedBlockCount, 2);
  assert.equal(hook.evidence.energyLift > 0, true);
  assert.equal(hook.evidence.sustainedEnergy, true);
  assert.equal(map.protectedUntil, 48);
  assert.equal(map.exitCandidates.every((item) => item.time >= 48), true);
});

test('one repeated lyric line is only a hook candidate', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.74, 0.44, 0.72, 0.7]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 66, normalized: 'we own the night' },
    ],
  });

  assert.equal(map.sections.some((section) => section.type === 'hook'), false);
  assert.equal(map.sections.some((section) => section.type === 'hook-candidate'), true);
  assert.equal(map.entryCandidates.some((candidate) => candidate.type === 'hook'), false);
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
  assert.equal(map.entryCandidates.length, 1);
  assert.equal(map.entryCandidates.some((item) => item.time >= 12 && item.time <= 16 && item.source === 'fallback'), false);
});

test('starts exits at the protected boundary and scores timing penalties', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.74, 0.44, 0.72, 0.7], 96),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 34, normalized: 'nothing feels the same' },
      { time: 66, normalized: 'we own the night' },
      { time: 82, normalized: 'nothing feels the same' },
    ],
  });

  assert.equal(map.exitCandidates[0].time, 48);
  assert.equal(map.exitCandidates[0].type, 'post-hook-boundary');
  assert.equal(map.exitCandidates[0].exitRatio, 0.5);
  assert.equal(map.exitCandidates[0].latePenalty, 0);
  assert.equal(map.exitCandidates.every((candidate) => 'exitRatio' in candidate && 'latePenalty' in candidate), true);
  assert.equal(map.exitCandidates.some((candidate) => candidate.exitRatio > 0.78 && candidate.latePenalty >= 0.45), true);
});

test('labels a falling post-hook phrase as a release', () => {
  const map = buildStructureMap({ profile: makeProfile([0.3, 0.8, 0.68, 0.42, 0.3]), lrcLines: [] });

  assert.equal(map.exitCandidates.some((item) => item.type === 'release'), true);
});

test('exposes pre-hook and hook as separate B entry choices', () => {
  const map = buildStructureMap({
    profile: makeProfile([0.32, 0.78, 0.74, 0.44, 0.72, 0.7]),
    lrcLines: [
      { time: 18, normalized: 'we own the night' },
      { time: 34, normalized: 'nothing feels the same' },
      { time: 66, normalized: 'we own the night' },
      { time: 82, normalized: 'nothing feels the same' },
    ],
  });

  const entries = map.entryCandidates.filter((item) => item.type === 'pre-hook' || item.type === 'hook');
  assert.equal(entries.some((item) => item.type === 'pre-hook'), true);
  assert.equal(entries.some((item) => item.type === 'hook'), true);
  for (const entry of entries) {
    assert.equal(typeof entry.playFrom, 'number');
    assert.equal(typeof entry.landingAt, 'number');
    assert.equal(typeof entry.landingType, 'string');
    assert.equal(typeof entry.time, 'number');
  }
});

test('beat-only evidence is a drop and never a vocal hook', () => {
  const map = buildStructureMap({ profile: makeProfile([0.3, 0.8, 0.74, 0.44, 0.72, 0.7]), lrcLines: [] });

  assert.equal(map.structureSource, 'beat-only');
  assert.equal(map.entryCandidates.some((candidate) => candidate.type === 'hook'), false);
  assert.equal(map.entryCandidates.some((candidate) => candidate.type === 'drop' || candidate.type === 'drop-candidate'), true);
  assert.equal(map.sections.every((section) => section.type !== 'hook'), true);
});

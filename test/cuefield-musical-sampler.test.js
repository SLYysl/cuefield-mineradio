const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveTransitionSamplingStructure,
  sampleRepresentativeAudio,
  selectTransitionWindowStarts,
} = require('../public/cuefield-musical-sampler');

function fakeBuffer(channels, sampleRate) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    length: channels[0].length,
    getChannelData(index) { return channels[index]; },
  };
}

test('selects transition-aware windows from entries and exits', () => {
  const structure = {
    entryCandidates: [
      { type: 'intro', role: 'entry', time: 2, landingAt: 2, confidence: 0.7 },
      { type: 'hook', role: 'entry', time: 44, landingAt: 44, confidence: 0.9 },
    ],
    exitCandidates: [
      { type: 'release', role: 'exit', time: 118, confidence: 0.82 },
      { type: 'outro', role: 'exit', time: 188, confidence: 0.88 },
    ],
  };

  assert.deepEqual(selectTransitionWindowStarts(structure, 200, 4), [2, 44, 114, 184]);
});

test('deduplicates structural windows and fills deterministic fallback positions', () => {
  const structure = {
    entryCandidates: [{ type: 'intro', role: 'entry', time: 0, confidence: 0.9 }],
    exitCandidates: [{ type: 'release', role: 'exit', time: 3, confidence: 0.9 }],
  };

  const starts = selectTransitionWindowStarts(structure, 100, 4);
  assert.equal(starts.length, 4);
  assert.equal(new Set(starts).size, 4);
  assert.deepEqual(starts, [0, 28, 56, 78]);
});

test('samples supplied transition starts without exceeding the payload cap', () => {
  const channel = new Float32Array(44100 * 240);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 44100), {
    targetSampleRate: 22050,
    windowSeconds: 4,
    windowStarts: [2, 44, 114, 184, 220],
  });

  assert.deepEqual(sampled.windowStarts, [2, 44, 114, 184]);
  assert.equal(sampled.samples.length <= 22050 * 16, true);
});

test('filters and deduplicates malformed explicit starts before filling fallback windows', () => {
  const channel = new Float32Array(1000);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 1,
    windowStarts: [0, 0.25, 'bad', NaN, Infinity, 0],
  });

  assert.deepEqual(sampled.windowStarts, [0, 28, 56, 78]);
});

test('accepts only finite number values for explicit starts', () => {
  const channel = new Float32Array(1000);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 1,
    windowStarts: [0, null, true, '12'],
  });

  assert.deepEqual(sampled.windowStarts, [0, 28, 56, 78]);
});

test('keeps one clamped window when an explicit short track cannot provide four starts', () => {
  const channel = new Float32Array(30);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 4,
    windowStarts: [0, 1, 'bad', Infinity],
  });

  assert.deepEqual(sampled.windowStarts, [0]);
  assert.equal(sampled.samples.length, 30);
});

test('includes the opening before later representative windows', () => {
  const channel = Float32Array.from({ length: 1000 }, (_, index) => index);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 1,
  });

  assert.deepEqual(sampled.windowStarts, [0, 28, 56, 78]);
  assert.equal(sampled.samples.length, 40);
  assert.deepEqual(Array.from(sampled.samples.slice(0, 10)), Array.from(channel.slice(0, 10)));
});

test('mixes channels to mono and resamples to the target rate', () => {
  const left = Float32Array.from({ length: 80 }, () => 1);
  const right = Float32Array.from({ length: 80 }, () => -0.5);
  const sampled = sampleRepresentativeAudio(fakeBuffer([left, right], 20), {
    targetSampleRate: 10,
    windowSeconds: 1,
  });

  assert.equal(sampled.sampleRate, 10);
  assert.equal(sampled.samples.length <= 40, true);
  assert.equal(Array.from(sampled.samples).every((value) => Math.abs(value - 0.25) < 0.0001), true);
});

test('bounds the default payload to sixteen seconds at 22.05 kHz', () => {
  const channel = new Float32Array(44100 * 240);
  const sampled = sampleRepresentativeAudio(fakeBuffer([channel], 44100));

  assert.equal(sampled.sampleRate, 22050);
  assert.equal(sampled.windowStarts.length, 4);
  assert.equal(sampled.samples.length, 22050 * 16);
});

test('derives compact beat-only entry and release candidates from energy bins', () => {
  const beats = [
    { time: 0, strength: 0.1 },
    { time: 32, strength: 0.95 },
    { time: 48, impact: 0.95 },
    { time: 52, strength: 0.1 },
    { time: 76, strength: 0.92 },
    { time: 80, strength: 0.1 },
  ];
  const structure = deriveTransitionSamplingStructure({ beats }, 100, 4);

  assert.equal(structure.entryCandidates[0].time, 0);
  assert.equal(structure.entryCandidates.some((candidate) => candidate.time === 32), true);
  assert.equal(structure.exitCandidates.some((candidate) => candidate.time === 52), true);
  assert.equal(structure.exitCandidates.some((candidate) => candidate.time === 80), true);
  assert.equal(structure.entryCandidates.every((candidate) => !('lyrics' in candidate)), true);
});

test('uses beat-only structure for sampling and fixed fallback without beat evidence', () => {
  const channel = new Float32Array(1000);
  const beatMap = {
    cameraBeats: [
      { time: 32, impact: 0.95 },
      { time: 48, impact: 0.95 },
      { time: 52, impact: 0.1 },
      { time: 76, impact: 0.92 },
      { time: 80, impact: 0.1 },
    ],
  };
  const structured = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 4,
    beatMap,
  });
  const fallback = sampleRepresentativeAudio(fakeBuffer([channel], 10), {
    targetSampleRate: 10,
    windowSeconds: 4,
    beatMap: {},
  });

  assert.notDeepEqual(structured.windowStarts, [0, 28, 56, 78]);
  assert.deepEqual(fallback.windowStarts, [0, 28, 56, 78]);
  assert.deepEqual(deriveTransitionSamplingStructure({}, 100, 4), {
    entryCandidates: [],
    exitCandidates: [],
  });
});

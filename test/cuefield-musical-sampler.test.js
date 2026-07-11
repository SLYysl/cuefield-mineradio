const assert = require('node:assert/strict');
const test = require('node:test');

const { sampleRepresentativeAudio } = require('../public/cuefield-musical-sampler');

function fakeBuffer(channels, sampleRate) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    length: channels[0].length,
    getChannelData(index) { return channels[index]; },
  };
}

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
  assert.equal(sampled.samples.length, 22050 * 16);
});

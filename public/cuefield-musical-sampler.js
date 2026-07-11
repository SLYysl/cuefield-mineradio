(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldMusicalSampler = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function sampleRepresentativeAudio(buffer, options) {
    options = options || {};
    if (!buffer || typeof buffer.getChannelData !== 'function') throw new Error('AUDIO_BUFFER_REQUIRED');
    var sourceRate = finite(buffer.sampleRate, 0);
    var targetRate = Math.max(1, Math.round(finite(options.targetSampleRate, 22050)));
    var windowSeconds = Math.max(0.25, Math.min(4, finite(options.windowSeconds, 4)));
    var duration = Math.max(0, finite(buffer.duration, finite(buffer.length, 0) / sourceRate));
    var offsets = [0, 0.28, 0.56, 0.78];
    var starts = offsets.map(function(ratio) {
      return Math.max(0, Math.min(Math.max(0, duration - windowSeconds), duration * ratio));
    });
    var outputLength = Math.max(0, Math.floor(Math.min(duration, windowSeconds) * targetRate));
    var samples = new Float32Array(outputLength * starts.length);
    var channelCount = Math.max(1, Math.round(finite(buffer.numberOfChannels, 1)));

    starts.forEach(function(start, windowIndex) {
      for (var targetIndex = 0; targetIndex < outputLength; targetIndex += 1) {
        var sourcePosition = (start + targetIndex / targetRate) * sourceRate;
        var lower = Math.max(0, Math.min(buffer.length - 1, Math.floor(sourcePosition)));
        var upper = Math.max(0, Math.min(buffer.length - 1, lower + 1));
        var fraction = sourcePosition - lower;
        var mono = 0;
        for (var channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
          var channel = buffer.getChannelData(channelIndex);
          mono += channel[lower] + (channel[upper] - channel[lower]) * fraction;
        }
        samples[windowIndex * outputLength + targetIndex] = mono / channelCount;
      }
    });

    return {
      samples: samples,
      sampleRate: targetRate,
      windowSeconds: outputLength / targetRate,
      windowStarts: starts.map(function(start) { return Math.round(start * 1000) / 1000; }),
    };
  }

  return { sampleRepresentativeAudio: sampleRepresentativeAudio };
});

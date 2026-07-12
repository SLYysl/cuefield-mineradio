(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldMusicalSampler = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function candidateStart(candidate, isExit, windowSeconds) {
    if (!candidate) return NaN;
    if (isExit) return finite(candidate.time, NaN) - windowSeconds;
    return finite(candidate.playFrom,
      finite(candidate.landingAt, finite(candidate.time, NaN)));
  }

  function addWindowStart(starts, value, maximumStart, windowSeconds) {
    if (!isFinite(value)) return;
    var bounded = Math.round(Math.max(0, Math.min(maximumStart, value)) * 1000) / 1000;
    if (!starts.some(function(existing) {
      return Math.abs(existing - bounded) < windowSeconds * 0.5;
    })) starts.push(bounded);
  }

  function normalizeExplicitWindowStarts(values, duration, windowSeconds) {
    var maximumStart = Math.max(0, duration - windowSeconds);
    var starts = [];
    values.forEach(function(value) {
      addWindowStart(starts, finite(value, NaN), maximumStart, windowSeconds);
    });
    [0, duration * 0.28, duration * 0.56, duration * 0.78].forEach(function(value) {
      addWindowStart(starts, value, maximumStart, windowSeconds);
    });
    return starts.slice(0, 4).sort(function(a, b) { return a - b; });
  }

  function selectTransitionWindowStarts(structure, duration, windowSeconds) {
    duration = Math.max(0, finite(duration, 0));
    windowSeconds = Math.max(0.25, Math.min(4, finite(windowSeconds, 4)));
    var maximumStart = Math.max(0, duration - windowSeconds);
    var entries = Array.isArray(structure && structure.entryCandidates)
      ? structure.entryCandidates : [];
    var exits = Array.isArray(structure && structure.exitCandidates)
      ? structure.exitCandidates : [];
    var naturalTypes = /^(start|intro|drop)$/;
    var hookTypes = /^(pre-hook|hook|chorus)$/;
    var exitTypes = /^(release|outro|natural-tail)$/;

    function strongest(items, predicate) {
      return items.filter(predicate).slice().sort(function(a, b) {
        return finite(b.confidence, 0) - finite(a.confidence, 0)
          || finite(a.time, 0) - finite(b.time, 0);
      })[0];
    }

    var chosen = [
      [strongest(entries, function(item) { return naturalTypes.test(String(item.type || '').toLowerCase()); }), false],
      [strongest(entries, function(item) { return hookTypes.test(String(item.type || '').toLowerCase()); }), false],
      [strongest(exits, function(item) {
        var ratio = finite(item.time, NaN) / Math.max(1, duration);
        return exitTypes.test(String(item.type || '').toLowerCase()) && ratio >= 0.45 && ratio < 0.8;
      }), true],
      [strongest(exits, function(item) {
        var ratio = finite(item.time, NaN) / Math.max(1, duration);
        return exitTypes.test(String(item.type || '').toLowerCase()) && ratio >= 0.72;
      }), true],
    ];
    var starts = [];

    chosen.forEach(function(item) {
      addWindowStart(starts, candidateStart(item[0], item[1], windowSeconds), maximumStart, windowSeconds);
    });
    [0, duration * 0.28, duration * 0.56, duration * 0.78].forEach(function(value) {
      addWindowStart(starts, value, maximumStart, windowSeconds);
    });
    return starts.slice(0, 4).sort(function(a, b) { return a - b; });
  }

  function sampleRepresentativeAudio(buffer, options) {
    options = options || {};
    if (!buffer || typeof buffer.getChannelData !== 'function') throw new Error('AUDIO_BUFFER_REQUIRED');
    var sourceRate = finite(buffer.sampleRate, 0);
    var targetRate = Math.max(1, Math.round(finite(options.targetSampleRate, 22050)));
    var windowSeconds = Math.max(0.25, Math.min(4, finite(options.windowSeconds, 4)));
    var duration = Math.max(0, finite(buffer.duration, finite(buffer.length, 0) / sourceRate));
    var starts = Array.isArray(options.windowStarts)
      ? normalizeExplicitWindowStarts(options.windowStarts, duration, windowSeconds)
      : selectTransitionWindowStarts(options.structureMap, duration, windowSeconds);
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

  return {
    sampleRepresentativeAudio: sampleRepresentativeAudio,
    selectTransitionWindowStarts: selectTransitionWindowStarts,
  };
});

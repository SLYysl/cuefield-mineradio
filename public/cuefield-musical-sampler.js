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
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      addWindowStart(starts, value, maximumStart, windowSeconds);
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

  function deriveTransitionSamplingStructure(beatMap, duration, windowSeconds) {
    duration = Math.max(0, finite(duration, 0));
    windowSeconds = Math.max(0.25, Math.min(4, finite(windowSeconds, 4)));
    var source = Array.isArray(beatMap && beatMap.cameraBeats) && beatMap.cameraBeats.length
      ? beatMap.cameraBeats
      : (Array.isArray(beatMap && beatMap.beats) && beatMap.beats.length
        ? beatMap.beats
        : (Array.isArray(beatMap && beatMap.kicks) ? beatMap.kicks : []));
    var bins = Math.max(1, Math.ceil(duration / windowSeconds));
    var totals = Array(bins).fill(0);
    var counts = Array(bins).fill(0);
    var events = source.map(function(event) {
      var time = typeof event === 'number' ? event : event && event.time;
      var energy = typeof event === 'number' ? 0.5 : event && (event.impact || event.strength);
      time = finite(time, NaN);
      energy = finite(energy, NaN);
      if (!isFinite(time) || !isFinite(energy) || time < 0 || time >= duration) return null;
      return { time: time, energy: Math.max(0, Math.min(1, energy)) };
    }).filter(Boolean);
    if (events.length < 3 || duration <= windowSeconds) {
      return { entryCandidates: [], exitCandidates: [] };
    }
    events.forEach(function(event) {
      var index = Math.min(bins - 1, Math.floor(event.time / windowSeconds));
      totals[index] += event.energy;
      counts[index] += 1;
    });
    var means = totals.map(function(total, index) {
      return counts[index] ? total / counts[index] : 0;
    });
    var populated = means.filter(function(mean, index) { return counts[index] > 0 && isFinite(mean); });
    if (populated.length < 3 || Math.max.apply(null, populated) - Math.min.apply(null, populated) < 0.15) {
      return { entryCandidates: [], exitCandidates: [] };
    }

    function strongestInRange(minRatio, maxRatio) {
      var winner = -1;
      for (var index = 0; index < means.length; index++) {
        var ratio = index / bins;
        if (counts[index] && ratio >= minRatio && ratio <= maxRatio
            && (winner < 0 || means[index] > means[winner])) winner = index;
      }
      return winner;
    }

    function strongestDropInRange(minRatio, maxRatio) {
      var winner = -1;
      var winnerDrop = 0;
      for (var index = 1; index < means.length; index++) {
        var ratio = index / bins;
        var drop = means[index - 1] - means[index];
        if (counts[index - 1] && counts[index] && ratio >= minRatio && ratio <= maxRatio
            && drop > winnerDrop) {
          winner = index;
          winnerDrop = drop;
        }
      }
      return winner;
    }

    var entryIndex = strongestInRange(0.15, 0.65);
    var earlyExitIndex = strongestDropInRange(0.45, 0.80);
    var lateExitIndex = strongestDropInRange(0.72, 0.96);
    var entryCandidates = [{ type: 'intro', role: 'entry', time: 0, confidence: 0.5 }];
    if (entryIndex >= 0) entryCandidates.push({
      type: 'drop',
      role: 'entry',
      time: entryIndex * windowSeconds,
      confidence: Math.max(0.5, Math.min(1, means[entryIndex]))
    });
    var exitCandidates = [];
    [earlyExitIndex, lateExitIndex].forEach(function(index) {
      if (index < 0 || exitCandidates.some(function(candidate) { return candidate.time === index * windowSeconds; })) return;
      exitCandidates.push({
        type: 'release',
        role: 'exit',
        time: index * windowSeconds,
        confidence: 0.5
      });
    });
    return { entryCandidates: entryCandidates, exitCandidates: exitCandidates };
  }

  function sampleRepresentativeAudio(buffer, options) {
    options = options || {};
    if (!buffer || typeof buffer.getChannelData !== 'function') throw new Error('AUDIO_BUFFER_REQUIRED');
    var sourceRate = finite(buffer.sampleRate, 0);
    var targetRate = Math.max(1, Math.round(finite(options.targetSampleRate, 22050)));
    var windowSeconds = Math.max(0.25, Math.min(4, finite(options.windowSeconds, 4)));
    var duration = Math.max(0, finite(buffer.duration, finite(buffer.length, 0) / sourceRate));
    var structure = options.structureMap;
    var hasCandidates = function(value) {
      return value && ((Array.isArray(value.entryCandidates) && value.entryCandidates.length)
        || (Array.isArray(value.exitCandidates) && value.exitCandidates.length));
    };
    if (!hasCandidates(structure)) structure = deriveTransitionSamplingStructure(options.beatMap, duration, windowSeconds);
    if (!hasCandidates(structure)) structure = null;
    var starts = Array.isArray(options.windowStarts)
      ? normalizeExplicitWindowStarts(options.windowStarts, duration, windowSeconds)
      : selectTransitionWindowStarts(structure, duration, windowSeconds);
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
    deriveTransitionSamplingStructure: deriveTransitionSamplingStructure,
    sampleRepresentativeAudio: sampleRepresentativeAudio,
    selectTransitionWindowStarts: selectTransitionWindowStarts,
  };
});

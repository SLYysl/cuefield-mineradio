(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldSetPlanner = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function number(value, fallback) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, number(value, min)));
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  function collectCandidates(queue, currentIndex, opts) {
    opts = opts || {};
    queue = Array.isArray(queue) ? queue : [];
    var getKey = typeof opts.getKey === 'function' ? opts.getKey : function(item) { return item && item.key || ''; };
    var target = Math.round(clamp(opts.target == null ? 16 : opts.target, 10, 20));
    var recent = new Set(Array.isArray(opts.recentKeys) ? opts.recentKeys.filter(Boolean) : []);
    var seen = new Set();
    var result = [];
    for (var index = Math.max(-1, Number(currentIndex) || 0) + 1; index < queue.length && result.length < target; index++) {
      var song = queue[index];
      var key = String(getKey(song) || '');
      if (!key || recent.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push({ song: song, key: key, index: index });
    }
    return result;
  }

  function scoreCandidate(candidate) {
    candidate = candidate || {};
    var score = clamp(candidate.immediate, 0, 1) * 0.55
      + clamp(candidate.onward, 0, 1) * 0.20
      + clamp(candidate.surprise, 0, 1) * 0.15
      + clamp(candidate.energyShape, 0, 1) * 0.10;
    if (candidate.repeatedArtist) score -= 0.06;
    if (candidate.repeatedStyle) score -= 0.05;
    if (candidate.bpmMonotony) score -= 0.04;
    return round(clamp(score, 0, 1));
  }

  function isSafe(candidate) {
    return !!candidate && candidate.safe !== false && candidate.executable !== false && candidate.technicalFallback !== true;
  }

  function chooseTopCandidate(candidates, opts) {
    opts = opts || {};
    var ranked = (Array.isArray(candidates) ? candidates : []).slice().sort(function(a, b) {
      return number(b && b.score, 0) - number(a && a.score, 0);
    });
    if (!ranked.length) return null;
    if (!isSafe(ranked[0])) return ranked.find(isSafe) || null;
    var top = ranked.slice(0, 3);
    if (top.length === 1) return top[0];
    if (number(top[0].score, 0) - number(top[1].score, 0) > 0.12) return top[0];
    if (top.some(function(candidate) { return !isSafe(candidate); })) return top[0];
    var random = typeof opts.random === 'function' ? opts.random : Math.random;
    var roll = clamp(random(), 0, 0.999999);
    if (roll < 0.60 || top.length < 2) return top[0];
    if (roll < 0.87 || top.length < 3) return top[1];
    return top[2];
  }

  function resolveManualNext(queue, currentIndex, manualKey, getKey) {
    queue = Array.isArray(queue) ? queue : [];
    if (!manualKey || currentIndex < 0 || currentIndex + 1 >= queue.length) return null;
    getKey = typeof getKey === 'function' ? getKey : function(item) { return item && item.key || ''; };
    var key = String(getKey(queue[currentIndex + 1]) || '');
    if (key !== String(manualKey)) return null;
    return { index: currentIndex + 1, key: key, manual: true };
  }

  function promoteCandidate(queue, currentIndex, candidateKey, getKey) {
    var nextQueue = Array.isArray(queue) ? queue.slice() : [];
    getKey = typeof getKey === 'function' ? getKey : function(item) { return item && item.key || ''; };
    var nextIndex = currentIndex + 1;
    var found = -1;
    for (var index = nextIndex; index < nextQueue.length; index++) {
      if (String(getKey(nextQueue[index]) || '') === String(candidateKey || '')) {
        found = index;
        break;
      }
    }
    if (found < 0) return { queue: nextQueue, nextIndex: -1, moved: false };
    if (found === nextIndex) return { queue: nextQueue, nextIndex: nextIndex, moved: false };
    var winner = nextQueue.splice(found, 1)[0];
    nextQueue.splice(nextIndex, 0, winner);
    return { queue: nextQueue, nextIndex: nextIndex, moved: true };
  }

  return {
    collectCandidates: collectCandidates,
    scoreCandidate: scoreCandidate,
    chooseTopCandidate: chooseTopCandidate,
    resolveManualNext: resolveManualNext,
    promoteCandidate: promoteCandidate,
  };
});

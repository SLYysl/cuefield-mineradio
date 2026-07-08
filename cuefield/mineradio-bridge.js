const { analyzeSectionCandidates, chooseTransitionCandidates } = require('./section-candidates');
const { normalizeMineradioBeatMap } = require('./adapter-mineradio');
const { parseLrc } = require('./lrc-anchors');

function toTrack(entry, fallbackKey) {
  const meta = entry && entry.meta || {};
  return {
    id: entry && entry.key || fallbackKey || '',
    title: meta.title || entry && entry.title || fallbackKey || '',
    artist: meta.artist || entry && entry.artist || '',
    duration: entry && entry.map && entry.map.duration || 0,
  };
}

function entryFromCache(readBeatMapCache, key) {
  const entry = readBeatMapCache(key);
  if (!entry || !entry.map) {
    const err = new Error(`BEATMAP_CACHE_MISS:${key}`);
    err.code = 'BEATMAP_CACHE_MISS';
    throw err;
  }
  return entry;
}

function parseMaybeLrc(value) {
  return value ? parseLrc(String(value)) : [];
}

function normalizedFixture(entry, key) {
  const track = toTrack(entry, key);
  const analysis = normalizeMineradioBeatMap(track, entry.map || {});
  return {
    track,
    map: {
      ...(entry.map || {}),
      duration: analysis.track.duration,
      gridStep: analysis.analysis.gridStep,
      beats: analysis.analysis.beats,
    },
  };
}

function addFallbackEntry(analysis) {
  if ((analysis.candidates || []).some((candidate) => candidate.role === 'entry')) return analysis;
  const time = Math.max(0, Math.min(16, (analysis.duration || 0) * 0.12));
  analysis.candidates.push({
    type: 'intro',
    role: 'entry',
    time,
    confidence: 0.52,
    text: '',
    energyBefore: 0,
    energyAfter: 0.42,
    lowDensity: 0.36,
    vocalDensity: 0,
    beatStability: 0.72,
  });
  return analysis;
}

function analyzeCacheEntry(entry, key, lrcText) {
  const analysis = analyzeSectionCandidates({
    fixture: normalizedFixture(entry, key),
    lrcLines: parseMaybeLrc(lrcText),
  });
  return addFallbackEntry(analysis);
}

function planCuefieldTransitionFromCache(opts = {}) {
  const readBeatMapCache = opts.readBeatMapCache;
  if (typeof readBeatMapCache !== 'function') throw new Error('READ_BEATMAP_CACHE_REQUIRED');
  const fromKey = String(opts.fromKey || '').trim();
  const toKey = String(opts.toKey || '').trim();
  if (!fromKey || !toKey) throw new Error('CUEFIELD_CACHE_KEYS_REQUIRED');

  const fromEntry = entryFromCache(readBeatMapCache, fromKey);
  const toEntry = entryFromCache(readBeatMapCache, toKey);
  const from = analyzeCacheEntry(fromEntry, fromKey, opts.fromLrc);
  const to = analyzeCacheEntry(toEntry, toKey, opts.toLrc);
  const chosen = chooseTransitionCandidates(from, to, { exitBias: opts.exitBias || 'late' });

  return {
    ok: true,
    from,
    to,
    chosen,
  };
}

module.exports = {
  planCuefieldTransitionFromCache,
};

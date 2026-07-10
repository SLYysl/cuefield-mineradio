const { analyzeSectionCandidates, chooseTransitionCandidates } = require('./section-candidates');
const { normalizeMineradioBeatMap } = require('./adapter-mineradio');
const { buildCueProfile } = require('./cue-profile');
const { parseLrc } = require('./lrc-anchors');
const { planRecipeCandidates } = require('./recipe-planner');
const { buildStructureMap } = require('./structure-map');

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

function analyzeCacheEntry(entry, key, lrcText) {
  const fixture = normalizedFixture(entry, key);
  const lrcLines = parseMaybeLrc(lrcText);
  const analysis = analyzeSectionCandidates({
    fixture,
    lrcLines,
  });
  const baseProfile = buildCueProfile({
    track: analysis.track,
    map: fixture.map,
    candidates: analysis.candidates,
  });
  const structureMap = buildStructureMap({ profile: baseProfile, lrcLines });
  const candidates = [
    ...analysis.candidates,
    ...structureMap.exitCandidates,
    ...structureMap.entryCandidates,
  ];
  return {
    ...analysis,
    candidates,
    structureMap,
    cueProfile: buildCueProfile({
      track: analysis.track,
      map: fixture.map,
      candidates,
    }),
  };
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
  const sectionChoice = chooseTransitionCandidates(from, to, { exitBias: opts.exitBias || 'late' });
  const recipePlan = planRecipeCandidates(from.cueProfile, to.cueProfile, {
    sectionChoice,
  });
  const chosen = {
    ...sectionChoice,
    transitionRecipe: recipePlan.chosen.recipe,
    timeline: recipePlan.chosen.timeline,
    recipeCandidate: recipePlan.chosen,
  };
  const structureSource = from.structureMap.structureSource === 'lyric+beat'
    && to.structureMap.structureSource === 'lyric+beat'
    ? 'lyric+beat'
    : 'beat-only';

  return {
    ok: true,
    from,
    to,
    chosen,
    candidates: recipePlan.candidates,
    diagnostics: {
      ...recipePlan.diagnostics,
      structureSource,
      structureConfidence: Math.min(from.structureMap.structureConfidence, to.structureMap.structureConfidence),
      protectedUntil: from.structureMap.protectedUntil,
      exitType: chosen.exit && chosen.exit.type || '',
      exitConfidence: chosen.exit && chosen.exit.confidence,
      entryType: chosen.entry && chosen.entry.type || '',
      exitCandidateCount: from.structureMap.exitCandidates.length,
      entryCandidateCount: to.structureMap.entryCandidates.length,
    },
  };
}

module.exports = {
  planCuefieldTransitionFromCache,
};

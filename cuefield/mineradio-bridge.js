const { analyzeSectionCandidates } = require('./section-candidates');
const { normalizeMineradioBeatMap } = require('./adapter-mineradio');
const { buildCueProfile } = require('./cue-profile');
const { parseLrc } = require('./lrc-anchors');
const { buildStructureMap } = require('./structure-map');
const { chooseTransitionWindow } = require('./transition-window-planner');

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

function credibleFirstHook(structureMap) {
  return (structureMap && structureMap.sections || []).find((section) => (
    section
    && structureMap.structureSource === 'lyric+beat'
    && String(section.type || '').toLowerCase() === 'hook'
    && Number(section.confidence) >= 0.65
  )) || null;
}

function transitionDiagnostics(from, to, windowPlan, chosen, structureSource) {
  const fromStructure = from.structureMap || {};
  const toStructure = to.structureMap || {};
  const fromHook = credibleFirstHook(fromStructure);
  const recipeDiagnostics = windowPlan.diagnostics || {};
  const entry = chosen.entry || {};
  const rawLandingType = String(entry.landingType || entry.type || 'start').toLowerCase();
  const landingType = toStructure.structureSource !== 'lyric+beat' && rawLandingType === 'hook'
    ? (entry.source === 'fallback' ? 'start' : 'drop')
    : rawLandingType;
  return {
    ...recipeDiagnostics,
    structureSource,
    structureConfidence: Math.min(fromStructure.structureConfidence, toStructure.structureConfidence),
    protectedUntil: chosen.protectedUntil,
    ...(fromHook ? {
      firstHookStart: fromHook.start,
      firstHookEnd: fromHook.end,
      hookConfidence: fromHook.confidence,
      ...(fromHook.evidence ? { hookEvidence: fromHook.evidence } : {}),
    } : {}),
    exitType: chosen.exit && chosen.exit.type || '',
    exitConfidence: chosen.exit && chosen.exit.confidence,
    exitRatio: chosen.exitRatio,
    entryType: landingType,
    entrySource: entry.source || '',
    entryConfidence: entry.confidence,
    landingAt: entry.landingAt,
    mixStart: chosen.mixStart,
    handoffAt: chosen.handoffAt,
    audibleOverlap: chosen.audibleOverlap,
    preRollDuration: chosen.preRollDuration,
    energyContinuity: chosen.energyContinuity,
    grooveContinuity: chosen.grooveContinuity,
    tempoCompatibility: chosen.tempoCompatibility,
    windowRejectionReasons: Array.isArray(chosen.rejectionReasons) ? chosen.rejectionReasons.slice() : [],
    sourceExitCount: recipeDiagnostics.sourceExitCount,
    sourceLandingCount: recipeDiagnostics.sourceLandingCount,
    consideredExitCount: recipeDiagnostics.consideredExitCount,
    consideredLandingCount: recipeDiagnostics.consideredLandingCount,
    exitCandidateCount: fromStructure.exitCandidates.length,
    entryCandidateCount: toStructure.entryCandidates.length,
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
  const windowPlan = chooseTransitionWindow(from, to);
  const selected = windowPlan.chosen || {};
  const sectionChoice = selected.sectionChoice || {};
  const recipeCandidate = selected.recipeCandidate || {};
  const chosenScore = sectionChoice.score ?? selected.score ?? recipeCandidate.score ?? 0;
  const chosen = {
    ...sectionChoice,
    recipe: sectionChoice.recipe || recipeCandidate.recipe || 'honest-start-fallback',
    score: chosenScore,
    evaluation: sectionChoice.evaluation || {
      score: chosenScore,
      tier: 'weak',
      risks: selected.rejectionReasons || [],
    },
    exit: selected.exit,
    entry: selected.entry,
    protectedUntil: from.structureMap.protectedUntil,
    transitionRecipe: recipeCandidate.recipe,
    timeline: selected.timeline,
    recipeCandidate,
    mixStart: selected.mixStart,
    handoffAt: selected.handoffAt,
    audibleOverlap: selected.audibleOverlap,
    preRollDuration: selected.preRollDuration,
    exitRatio: selected.exitRatio,
    energyContinuity: selected.energyContinuity,
    grooveContinuity: selected.grooveContinuity,
    tempoCompatibility: selected.tempoCompatibility,
    rejectionReasons: selected.rejectionReasons || [],
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
    candidates: windowPlan.candidates,
    rejected: windowPlan.rejected,
    diagnostics: transitionDiagnostics(from, to, windowPlan, chosen, structureSource),
  };
}

module.exports = {
  planCuefieldTransitionFromCache,
};

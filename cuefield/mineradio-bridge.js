const { analyzeSectionCandidates } = require('./section-candidates');
const { normalizeMineradioBeatMap } = require('./adapter-mineradio');
const { buildCueProfile } = require('./cue-profile');
const { parseLrc } = require('./lrc-anchors');
const { buildStructureMap } = require('./structure-map');
const { chooseTransitionWindow } = require('./transition-window-planner');
const { scoreLyricLink } = require('./lyric-link');
const { planBridge, trustedClimax } = require('./bridge-planner');

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

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactString(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function compactCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(24, Math.round(number))) : 0;
}

function compactTrack(track = {}) {
  return {
    id: compactString(track.id, 120),
    title: compactString(track.title, 160),
    artist: compactString(track.artist, 160),
    duration: finiteOrNull(track.duration),
  };
}

function compactStructureMap(structureMap = {}) {
  return {
    structureSource: compactString(structureMap.structureSource, 24),
    structureConfidence: finiteOrNull(structureMap.structureConfidence),
    protectedUntil: finiteOrNull(structureMap.protectedUntil),
    exitCandidateCount: compactCount((structureMap.exitCandidates || []).length),
    entryCandidateCount: compactCount((structureMap.entryCandidates || []).length),
  };
}

function compactAnalysisSummary(analysis = {}) {
  return {
    track: compactTrack(analysis.track),
    structureMap: compactStructureMap(analysis.structureMap),
  };
}

function compactTransitionPoint(point) {
  if (!point) return null;
  return {
    type: compactString(point.type, 32),
    role: compactString(point.role, 16),
    source: compactString(point.source, 24),
    time: finiteOrNull(point.time),
    confidence: finiteOrNull(point.confidence),
    playFrom: finiteOrNull(point.playFrom),
    landingAt: finiteOrNull(point.landingAt),
    landingType: compactString(point.landingType, 32),
  };
}

function compactBridgePlan(plan) {
  if (!plan) return null;
  return {
    template: compactString(plan.template, 32),
    bars: finiteOrNull(plan.bars),
    bpmFrom: finiteOrNull(plan.bpmFrom),
    bpmTo: finiteOrNull(plan.bpmTo),
    climax: plan.climax ? {
      time: finiteOrNull(plan.climax.time),
      type: compactString(plan.climax.type, 16),
      confidence: finiteOrNull(plan.climax.confidence),
    } : null,
    stageDurations: Array.isArray(plan.stageDurations) ? plan.stageDurations.slice(0, 3).map(finiteOrNull) : [],
    totalDuration: finiteOrNull(plan.totalDuration),
    predictedScore: finiteOrNull(plan.predictedScore),
    improvement: finiteOrNull(plan.improvement),
    lyricLinkScore: finiteOrNull(plan.lyricLinkScore),
    reasons: Array.isArray(plan.reasons) ? plan.reasons.slice(0, 4).map((reason) => compactString(reason, 40)) : [],
  };
}

function minimumFiniteOrNull(...values) {
  const numbers = values.map(finiteOrNull).filter((value) => value !== null);
  return numbers.length ? Math.min(...numbers) : null;
}

function transitionDiagnostics(from, to, windowPlan, chosen, structureSource) {
  const fromStructure = from.structureMap || {};
  const toStructure = to.structureMap || {};
  const fromHook = credibleFirstHook(fromStructure);
  const recipeDiagnostics = windowPlan.diagnostics || {};
  const policy = chosen.policy || windowPlan.policy || {};
  const entry = chosen.entry || {};
  const rawLandingType = String(entry.landingType || entry.type || 'start').toLowerCase();
  const landingType = toStructure.structureSource !== 'lyric+beat' && rawLandingType === 'hook'
    ? (entry.source === 'fallback' ? 'start' : 'drop')
    : rawLandingType;
  return {
    ...recipeDiagnostics,
    structureSource,
    structureConfidence: minimumFiniteOrNull(fromStructure.structureConfidence, toStructure.structureConfidence),
    protectedUntil: finiteOrNull(chosen.protectedUntil),
    firstHookStart: null,
    firstHookEnd: null,
    hookConfidence: null,
    hookEvidence: [],
    ...(fromHook ? {
      firstHookStart: finiteOrNull(fromHook.start),
      firstHookEnd: finiteOrNull(fromHook.end),
      hookConfidence: finiteOrNull(fromHook.confidence),
      ...(fromHook.evidence ? { hookEvidence: fromHook.evidence } : {}),
    } : {}),
    exitType: chosen.exit && chosen.exit.type || '',
    exitConfidence: finiteOrNull(chosen.exit && chosen.exit.confidence),
    exitRatio: finiteOrNull(chosen.exitRatio),
    entryType: landingType,
    entrySource: entry.source || '',
    entryConfidence: finiteOrNull(entry.confidence),
    landingAt: finiteOrNull(entry.landingAt),
    mixStart: finiteOrNull(chosen.mixStart),
    handoffAt: finiteOrNull(chosen.handoffAt),
    audibleOverlap: finiteOrNull(chosen.audibleOverlap),
    preRollDuration: finiteOrNull(chosen.preRollDuration),
    energyContinuity: finiteOrNull(chosen.energyContinuity),
    grooveContinuity: finiteOrNull(chosen.grooveContinuity),
    tempoCompatibility: finiteOrNull(chosen.tempoCompatibility),
    bpmA: finiteOrNull(from.cueProfile && from.cueProfile.bpm),
    bpmB: finiteOrNull(to.cueProfile && to.cueProfile.bpm),
    windowRejectionReasons: Array.isArray(chosen.rejectionReasons) ? chosen.rejectionReasons.slice() : [],
    route: String(policy.route || ''),
    compatibilityClass: String(policy.compatibilityClass || ''),
    contrastDirection: String(policy.contrastDirection || ''),
    preferredExitRange: Array.isArray(policy.preferredExitRange) ? policy.preferredExitRange.slice(0, 2) : [],
    routeReasons: Array.isArray(policy.reasons) ? policy.reasons.slice(0, 4) : [],
    routeFallbackUsed: chosen.routeFallbackUsed === true,
    technicalFailure: chosen.technicalFailure === true,
    errorCode: compactString(chosen.errorCode, 80),
    sourceExitCount: finiteOrNull(recipeDiagnostics.sourceExitCount),
    sourceLandingCount: finiteOrNull(recipeDiagnostics.sourceLandingCount),
    consideredExitCount: finiteOrNull(recipeDiagnostics.consideredExitCount),
    consideredLandingCount: finiteOrNull(recipeDiagnostics.consideredLandingCount),
    exitCandidateCount: finiteOrNull((fromStructure.exitCandidates || []).length),
    entryCandidateCount: finiteOrNull((toStructure.entryCandidates || []).length),
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
  const policy = windowPlan.policy || selected.policy || {};
  const chosenScore = sectionChoice.score ?? selected.score ?? recipeCandidate.score ?? 0;
  let chosen = {
    ...sectionChoice,
    recipe: sectionChoice.recipe || recipeCandidate.recipe || 'honest-start-fallback',
    score: chosenScore,
    evaluation: sectionChoice.evaluation || {
      score: chosenScore,
      tier: 'weak',
      risks: selected.rejectionReasons || [],
    },
    exit: compactTransitionPoint(selected.exit),
    entry: compactTransitionPoint(selected.entry),
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
    policy: {
      ...policy,
      preferredExitRange: Array.isArray(policy.preferredExitRange) ? policy.preferredExitRange.slice(0, 2) : [],
      reasons: Array.isArray(policy.reasons) ? policy.reasons.slice(0, 4) : [],
      metrics: { ...(policy.metrics || {}) },
    },
    routeFallbackUsed: selected.routeFallbackUsed === true,
    technicalFailure: selected.technicalFailure === true,
    errorCode: compactString(selected.errorCode, 80),
  };
  const fromLrcLines = parseMaybeLrc(opts.fromLrc);
  const toLrcLines = parseMaybeLrc(opts.toLrc);
  const climax = trustedClimax(to);
  const lyricLink = scoreLyricLink({
    fromLines: fromLrcLines,
    toLines: toLrcLines,
    exitTime: chosen.exit && chosen.exit.time,
    climaxTime: climax && (climax.start ?? climax.time),
    vocalOverlapSec: 0,
  });
  const bridge = chosen.technicalFailure === true ? null : planBridge({
    fromAnalysis: from,
    toAnalysis: to,
    directPlan: chosen,
    lyricLink,
  });
  if (bridge) {
    const directChosen = chosen;
    const stage3 = bridge.stageDurations[2];
    const entryTime = bridge.climax.time;
    chosen = {
      ...directChosen,
      recipe: 'synthetic-bridge',
      transitionRecipe: 'synthetic-bridge',
      recipeCandidate: {
        recipe: 'synthetic-bridge',
        fallbackTimeline: bridge.fallbackTimeline,
      },
      score: bridge.predictedScore,
      evaluation: {
        score: bridge.predictedScore,
        tier: bridge.predictedScore >= 0.84 ? 'magic' : 'usable',
        risks: [],
      },
      exit: {
        ...(directChosen.exit || {}),
        role: 'exit',
        source: 'structure',
        time: bridge.mixStart,
      },
      entry: {
        type: bridge.climax.type,
        role: 'entry',
        source: 'bridge',
        time: entryTime,
        confidence: bridge.climax.confidence,
        playFrom: Math.max(0, entryTime - stage3),
        landingAt: entryTime,
        landingType: bridge.climax.type,
      },
      timeline: bridge.timeline,
      mixStart: bridge.mixStart,
      handoffAt: bridge.handoffAt,
      audibleOverlap: 0,
      preRollDuration: stage3,
      exitRatio: from.cueProfile.duration > 0 ? bridge.mixStart / from.cueProfile.duration : 0,
      bridgePlan: compactBridgePlan(bridge),
      directTransition: {
        recipe: directChosen.transitionRecipe || directChosen.recipe,
        score: finiteOrNull((directChosen.evaluation && directChosen.evaluation.score) ?? directChosen.score),
      },
    };
  }
  const structureSource = from.structureMap.structureSource === 'lyric+beat'
    && to.structureMap.structureSource === 'lyric+beat'
    ? 'lyric+beat'
    : 'beat-only';

  const technicalFailure = chosen.technicalFailure === true;
  const diagnostics = transitionDiagnostics(from, to, windowPlan, chosen, structureSource);
  diagnostics.lyricLinkScore = finiteOrNull(lyricLink.score);
  diagnostics.lyricLinkReasons = Array.isArray(lyricLink.reasons) ? lyricLink.reasons.slice(0, 4) : [];
  diagnostics.bridgeSelected = !!bridge;
  diagnostics.bridgeTemplate = bridge ? bridge.template : '';
  diagnostics.bridgeBars = bridge ? bridge.bars : null;
  return {
    ok: !technicalFailure,
    ...(technicalFailure ? { error: chosen.errorCode || 'CUEFIELD_TECHNICAL_FAILURE' } : {}),
    from: compactAnalysisSummary(from),
    to: compactAnalysisSummary(to),
    chosen,
    candidates: windowPlan.candidates,
    rejected: windowPlan.rejected,
    diagnostics,
  };
}

module.exports = {
  planCuefieldTransitionFromCache,
};

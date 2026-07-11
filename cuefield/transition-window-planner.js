const { round, toNumber } = require('./cue-profile');
const { planRecipeCandidates } = require('./recipe-planner');
const { scoreCandidatePair } = require('./section-candidates');
const { classifyTransitionRoute } = require('./transition-router');
const { compareMusicalProfiles } = require('./musical-profile');

const MINIMUM_TERMINAL_OVERLAP = 2.2;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value)));
}

// Neutral policy: absent, NaN, null, and negative infinity mean no penalty.
function normalizePenalty(value) {
  if (value === Infinity) return 1;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

function profileOf(analysis) {
  return analysis && analysis.cueProfile || analysis || {};
}

function musicalEvidenceFor(fromAnalysis, toAnalysis) {
  const first = fromAnalysis && fromAnalysis.musicalProfile;
  const second = toAnalysis && toAnalysis.musicalProfile;
  const reliable = (profile) => profile
    && toNumber(profile.confidence) >= 0.55
    && toNumber(profile.noteCount) >= 12;
  return reliable(first) && reliable(second) ? compareMusicalProfiles(first, second) : null;
}

function landingKind(entry) {
  const explicit = String(entry && entry.landingType || '').toLowerCase();
  if (explicit) return explicit;
  const type = String(entry && entry.type || 'start').toLowerCase();
  if (type === 'pre-hook' || type === 'hook' || type === 'chorus') return 'hook';
  if (type === 'low-density-start') return 'start';
  if (type === 'intro' || type === 'drop' || type === 'start') return type;
  return entry && entry.source === 'fallback' ? 'start' : type;
}

function normalizeEntry(candidate) {
  const landingType = landingKind(candidate);
  const landingAt = toNumber(candidate && candidate.landingAt, toNumber(candidate && candidate.resolvesTo && candidate.resolvesTo.time, toNumber(candidate && candidate.time)));
  const playFrom = toNumber(candidate && candidate.playFrom, toNumber(candidate && candidate.time, landingAt));
  return {
    ...candidate,
    time: toNumber(candidate && candidate.time, landingAt),
    playFrom,
    landingAt,
    landingType,
  };
}

function credibleHookEvidence(candidate) {
  const evidence = candidate && candidate.evidence || candidate || {};
  return toNumber(evidence.repeatedLineCount) >= 2
    && toNumber(evidence.repeatedBlockCount) >= 2
    && evidence.sustainedEnergy === true;
}

function landingTime(candidate) {
  const values = [
    candidate && candidate.landingAt,
    candidate && candidate.resolvesTo && candidate.resolvesTo.time,
    candidate && candidate.time,
    candidate && candidate.start,
  ];
  const value = values.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
}

function sameLanding(first, second) {
  const firstTime = landingTime(first);
  const secondTime = landingTime(second);
  return firstTime !== null && secondTime !== null && Math.abs(firstTime - secondTime) < 1.5;
}

function trustedStructureHookEntries(structure) {
  if (!structure || structure.structureSource !== 'lyric+beat') return [];
  const sections = (structure.sections || []).filter((section) => (
    section
    && ['hook', 'chorus'].includes(String(section.type || '').toLowerCase())
    && toNumber(section.confidence) >= 0.65
    && credibleHookEvidence(section)
  ));
  const entries = (structure.entryCandidates || []).filter((candidate) => candidate && candidate.role === 'entry');
  const directHooks = entries.filter((candidate) => (
    ['hook', 'chorus'].includes(String(candidate.type || '').toLowerCase())
    && landingKind(candidate) === 'hook'
    && toNumber(candidate.confidence) >= 0.65
    && credibleHookEvidence(candidate)
    && sections.some((section) => sameLanding(candidate, section))
  ));
  const preHooks = entries.filter((candidate) => (
    String(candidate.type || '').toLowerCase() === 'pre-hook'
    && landingKind(candidate) === 'hook'
    && toNumber(candidate.confidence) >= 0.65
    && candidate.resolvesTo
    && ['hook', 'chorus'].includes(String(candidate.resolvesTo.type || '').toLowerCase())
    && directHooks.some((hook) => sameLanding(candidate.resolvesTo, hook) && sameLanding(candidate, hook))
  ));
  return [...directHooks, ...preHooks];
}

function naturalLanding(candidate) {
  if (!candidate || candidate.role !== 'entry' || String(candidate.source || '').toLowerCase() === 'lyric') return false;
  const type = String(candidate.type || '').toLowerCase();
  if (['hook', 'chorus', 'pre-hook', 'pre-section'].includes(type)) return false;
  return ['start', 'intro', 'drop'].includes(landingKind(candidate));
}

function sourceLandings(analysis) {
  const structure = analysis && analysis.structureMap || {};
  const structureEntries = (structure.entryCandidates || []).filter((candidate) => naturalLanding(candidate));
  const supplementalEntries = (analysis && analysis.candidates || []).filter((candidate) => naturalLanding(candidate));
  return [
    ...structureEntries,
    ...trustedStructureHookEntries(structure),
    ...supplementalEntries,
  ];
}

function landingOptions(analysis) {
  const candidates = sourceLandings(analysis)
    .map(normalizeEntry)
    .sort((a, b) => toNumber(b.confidence) - toNumber(a.confidence) || a.time - b.time);
  const unique = [];
  candidates.forEach((candidate) => {
    if (!unique.some((item) => item.landingType === candidate.landingType && Math.abs(item.landingAt - candidate.landingAt) < 1.5)) {
      unique.push(candidate);
    }
  });
  return unique.slice(0, 6);
}

function exitSourceCandidates(analysis) {
  const structure = analysis && analysis.structureMap || {};
  const source = structure.exitCandidates && structure.exitCandidates.length
    ? structure.exitCandidates
    : (analysis && analysis.candidates || []).filter((candidate) => candidate && candidate.role === 'exit');
  return source.filter((candidate) => candidate && candidate.role === 'exit');
}

function sourceExits(analysis, protectedUntil) {
  return exitSourceCandidates(analysis)
    .filter((candidate) => toNumber(candidate.time) >= protectedUntil);
}

function scoreWindowExit(candidate) {
  let score = clamp(candidate && candidate.confidence);
  if (candidate && candidate.type === 'release') score += 0.18;
  if (toNumber(candidate && candidate.energyAfter) < toNumber(candidate && candidate.energyBefore)) score += 0.08;
  return clamp(score - normalizePenalty(candidate && candidate.latePenalty));
}

function exitsForPolicy(exits, duration, policy) {
  const range = Array.isArray(policy && policy.preferredExitRange) ? policy.preferredExitRange : [];
  const minRatio = toNumber(range[0], NaN);
  const maxRatio = toNumber(range[1], NaN);
  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio)) return exits;
  const inRange = exits.filter((candidate) => {
    const ratio = toNumber(candidate.time) / Math.max(1, toNumber(duration));
    return ratio >= minRatio && ratio <= maxRatio;
  });
  if (inRange.length || !policy || policy.route === 'structure-mix') return inRange.length ? inRange : exits;
  return [];
}

function exitOptions(analysis, protectedUntil, policy) {
  return exitsForPolicy(sourceExits(analysis, protectedUntil), profileOf(analysis).duration, policy)
    .slice()
    .sort((a, b) => scoreWindowExit(b) - scoreWindowExit(a) || toNumber(a.time) - toNumber(b.time))
    .slice(0, 8);
}

function trustedGrid(from, to, diagnostics) {
  if (diagnostics && typeof diagnostics.beatGridTrusted === 'boolean') return diagnostics.beatGridTrusted;
  return !!(from && to && toNumber(from.gridStep) > 0 && toNumber(to.gridStep) > 0
    && (from.downbeats || []).length >= 4 && (to.downbeats || []).length >= 4);
}

function nearbyBar(profile, time) {
  const bars = profile && profile.bars || [];
  return bars.slice().sort((a, b) => Math.abs(toNumber(a.start) - time) - Math.abs(toNumber(b.start) - time))[0] || {};
}

function grooveContinuity(from, to, exit, entry, diagnostics) {
  if (!trustedGrid(from, to, diagnostics)) return 0.35;
  const a = nearbyBar(from, toNumber(exit && exit.time));
  const b = nearbyBar(to, toNumber(entry && entry.landingAt));
  const differences = [
    Math.abs(toNumber(a.beatStability) - toNumber(b.beatStability)),
    Math.abs(toNumber(a.snapDensity) - toNumber(b.snapDensity)),
    Math.abs(toNumber(a.bodyDensity) - toNumber(b.bodyDensity)),
  ];
  return round(clamp(1 - differences.reduce((sum, value) => sum + value, 0) / differences.length));
}

function overlapScore(overlap, relativeTempoDelta) {
  const target = relativeTempoDelta <= 0.08 ? 8 : (relativeTempoDelta <= 0.15 ? 5 : 3.4);
  return clamp(1 - Math.abs(toNumber(overlap) - target) / target);
}

function recipeSectionEntry(entry) {
  return {
    ...entry,
    time: entry.landingAt,
    resolvesTo: entry.landingType === 'hook' && entry.playFrom < entry.landingAt
      ? { type: 'hook', time: entry.landingAt }
      : entry.resolvesTo,
  };
}

function isAnchoredLandingDiagnosticValid(entry, window) {
  if (!['hook', 'intro', 'drop'].includes(landingKind(entry))) return true;
  const landingError = window && window.landingError;
  return Number.isFinite(landingError) && Math.abs(landingError) <= 0.08;
}

function rejectionReasons({ protectedUntil, sourceDuration, exit, entry, recipeCandidate, diagnostics }) {
  const reasons = [];
  const window = recipeCandidate.window || {};
  const mixStart = toNumber(exit.time) + toNumber(window.audibleStart);
  const anchored = ['hook', 'intro', 'drop'].includes(landingKind(entry));
  if (mixStart < protectedUntil) reasons.push('mix start precedes protected section');
  if (anchored && window.runwayAvailable === false) reasons.push('landing has no runway');
  if (anchored && !Number.isFinite(window.landingError)) reasons.push('landing diagnostic unavailable');
  else if (anchored && !isAnchoredLandingDiagnosticValid(entry, window)) reasons.push('landing error exceeds .08');
  if (landingKind(entry) === 'hook' && entry.playFrom === entry.landingAt && toNumber(diagnostics.relativeTempoDelta) > 0.15) {
    reasons.push('direct hook has no compatible runway');
  }
  if (toNumber(exit.time) + toNumber(window.handoffOffset) > toNumber(sourceDuration) + 0.000001) {
    reasons.push('handoff exceeds source duration');
  }
  if (!Array.isArray(recipeCandidate.timeline) || !recipeCandidate.timeline.length) reasons.push('missing executable timeline');
  return reasons;
}

function rangeDistancePenalty(exitRatio, policy) {
  const range = Array.isArray(policy && policy.preferredExitRange) ? policy.preferredExitRange : [];
  const minRatio = toNumber(range[0], NaN);
  const maxRatio = toNumber(range[1], NaN);
  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio) || minRatio > maxRatio) return 0;
  const distance = exitRatio < minRatio ? minRatio - exitRatio : (exitRatio > maxRatio ? exitRatio - maxRatio : 0);
  return clamp(distance / Math.max(0.04, maxRatio - minRatio));
}

function entryPolicyPenalty(entry, policy) {
  if (!policy || policy.route !== 'late-contrast-rise') return 0;
  const type = String(entry && entry.type || '').toLowerCase();
  return landingKind(entry) === 'hook' && type !== 'pre-hook' ? 0.18 : 0;
}

function recipeCandidateAllowedByRoute(candidate, policy) {
  if (candidate && candidate.eligible === false) return false;
  const route = policy && policy.route;
  const overlap = toNumber(candidate && candidate.window && candidate.window.audibleOverlap);
  if (route === 'late-contrast-rise') {
    return [
      'filtered-pickup',
      'echo-out',
      'quick-safe-fade',
      'safety-long-blend',
    ].includes(candidate.recipe) && overlap <= 3.5;
  }
  if (route === 'late-contrast-release') return overlap <= 6;
  return true;
}

function rankWindow({ exit, entry, sectionChoice, recipeCandidate, diagnostics, fromProfile, toProfile, policy, musicalEvidence }) {
  const energyContinuity = clamp(diagnostics.energyScore);
  const tempoCompatibility = clamp(diagnostics.bpmScore);
  const groove = grooveContinuity(fromProfile, toProfile, exit, entry, diagnostics);
  const continuity = clamp((energyContinuity + groove + tempoCompatibility + clamp(diagnostics.bassScore)) / 4);
  const suppliedExitRatio = clamp(exit.exitRatio);
  const exitRatio = suppliedExitRatio || clamp(toNumber(exit.time) / Math.max(1, toNumber(fromProfile.duration)));
  const latePenalty = Math.max(normalizePenalty(exit.latePenalty), policy && policy.route === 'structure-mix' && exitRatio > 0.78 ? 0.45 : 0);
  const routePenalty = rangeDistancePenalty(exitRatio, policy) + entryPolicyPenalty(entry, policy);
  const musicalAdjustment = musicalEvidence ? (toNumber(musicalEvidence.score, 0.5) - 0.5) * 0.12 : 0;
  const score = clamp(clamp(sectionChoice.score) * 0.34
    + clamp(recipeCandidate.selectionScore == null ? recipeCandidate.score : recipeCandidate.selectionScore) * 0.2
    + ((clamp(exit.confidence) + clamp(entry.confidence)) / 2) * 0.16
    + overlapScore(recipeCandidate.window.audibleOverlap, toNumber(diagnostics.relativeTempoDelta)) * 0.12
    + continuity * 0.18
    - latePenalty
    - routePenalty
    + musicalAdjustment);
  return {
    exit,
    entry,
    sectionChoice,
    recipeCandidate,
    timeline: recipeCandidate.timeline,
    mixStart: round(toNumber(exit.time) + toNumber(recipeCandidate.window.audibleStart)),
    handoffAt: round(toNumber(exit.time) + toNumber(recipeCandidate.window.handoffOffset)),
    audibleOverlap: toNumber(recipeCandidate.window.audibleOverlap),
    preRollDuration: toNumber(recipeCandidate.window.preRollDuration),
    exitRatio: round(clamp(exitRatio)),
    energyContinuity: round(energyContinuity),
    grooveContinuity: groove,
    tempoCompatibility: round(tempoCompatibility),
    score: round(score),
    rejectionReasons: [],
  };
}

function compactWindow(window) {
  return {
    exit: {
      type: window.exit && window.exit.type,
      time: window.exit && window.exit.time,
      exitRatio: window.exitRatio,
    },
    entry: {
      type: window.entry && window.entry.type,
      source: window.entry && window.entry.source,
      landingType: window.entry && window.entry.landingType,
      landingAt: window.entry && window.entry.landingAt,
    },
    recipe: window.recipeCandidate && window.recipeCandidate.recipe,
    score: clamp(window.score),
    audibleOverlap: toNumber(window.audibleOverlap),
    mixStart: window.mixStart,
    handoffAt: window.handoffAt,
    rejectionReasons: Array.isArray(window.rejectionReasons) ? window.rejectionReasons.slice() : [],
  };
}

function terminalRescuePolicy(policy, fromProfile, protectedUntil) {
  const duration = Math.max(1, toNumber(fromProfile && fromProfile.duration));
  const protectedRatio = clamp(toNumber(protectedUntil) / duration);
  return {
    ...policy,
    route: 'terminal-rescue',
    compatibilityClass: 'uncertain',
    contrastDirection: 'unknown',
    preferredExitRange: [Math.max(0.88, protectedRatio), Math.max(0.96, protectedRatio)],
    entryPolicy: 'start-or-downbeat',
    overlapClass: 'short',
    recipe: 'terminal-rescue',
    reasons: [...(policy && policy.reasons || []), 'no-valid-window'].slice(0, 4),
  };
}

function technicalFailure(errorCode, rejected = []) {
  const entry = {
    type: 'start',
    role: 'entry',
    source: 'fallback',
    time: 0,
    playFrom: 0,
    landingAt: 0,
    landingType: 'start',
    confidence: 0.35,
  };
  return {
    exit: null,
    entry,
    sectionChoice: null,
    recipeCandidate: {
      recipe: 'technical-failure',
      score: 0,
      timeline: [],
      window: {
        audibleStart: null,
        audibleEnd: null,
        audibleOverlap: null,
        preRollDuration: null,
        handoffOffset: null,
        runwayAvailable: false,
        landingError: null,
      },
    },
    timeline: [],
    mixStart: null,
    handoffAt: null,
    audibleOverlap: null,
    preRollDuration: null,
    exitRatio: null,
    energyContinuity: null,
    grooveContinuity: null,
    tempoCompatibility: null,
    score: 0,
    rejectionReasons: ['no valid complete transition window', ...(rejected.length ? ['structural windows rejected'] : [])],
    errorCode,
    technicalFailure: true,
    routeFallbackUsed: false,
  };
}

function terminalRescue(fromAnalysis, fromProfile, toProfile, protectedUntil, policy, rejected, entries = []) {
  const duration = Math.max(0, toNumber(fromProfile && fromProfile.duration));
  const targetDuration = Math.max(0, toNumber(toProfile && toProfile.duration));
  const protectedBoundary = toNumber(protectedUntil);
  if (!(duration > 0)) return technicalFailure('TERMINAL_RESCUE_INVALID_DURATION', rejected);
  if (!(targetDuration > 0)) return technicalFailure('TERMINAL_RESCUE_INVALID_TARGET_DURATION', rejected);
  if (targetDuration < MINIMUM_TERMINAL_OVERLAP - 0.000001) {
    return technicalFailure('TERMINAL_RESCUE_INSUFFICIENT_TARGET_RUNWAY', rejected);
  }
  if (duration - protectedBoundary < MINIMUM_TERMINAL_OVERLAP - 0.000001) {
    return technicalFailure('TERMINAL_RESCUE_INSUFFICIENT_POST_PROTECTION_RUNWAY', rejected);
  }
  const [minRatio, maxRatio] = policy.preferredExitRange || [];
  const rangeExits = sourceExits(fromAnalysis, protectedUntil)
    .filter((candidate) => {
      const time = toNumber(candidate.time, NaN);
      const ratio = time / Math.max(1, duration);
      return Number.isFinite(time)
        && ratio >= minRatio
        && ratio <= maxRatio
        && duration - time >= MINIMUM_TERMINAL_OVERLAP - 0.000001;
    })
    .sort((a, b) => toNumber(b.time) - toNumber(a.time));
  const selectedExit = rangeExits[0] || null;
  const preferredStart = selectedExit
    ? toNumber(selectedExit.time)
    : Math.max(toNumber(protectedUntil), Math.min(duration - 3.6, duration * 0.92));
  const mixStart = selectedExit
    ? round(toNumber(selectedExit.time))
    : round(Math.max(
      protectedBoundary,
      Math.min(duration - MINIMUM_TERMINAL_OVERLAP, preferredStart),
    ));
  const overlapDuration = round(Math.max(0, Math.min(3.4, duration - mixStart, targetDuration)));
  const landingOffset = 0.55;
  const bRiseAt = 0.38;
  const bRiseDuration = 170;
  const trustedEntry = entries.find((candidate) => (
    ['hook', 'drop'].includes(landingKind(candidate))
    && toNumber(candidate.confidence) >= 0.6
    && toNumber(candidate.landingAt) >= landingOffset
    && toNumber(candidate.landingAt) + overlapDuration - landingOffset <= targetDuration
  ));
  const requestedLanding = trustedEntry ? toNumber(trustedEntry.landingAt) : landingOffset;
  const bStart = round(Math.max(0, requestedLanding - landingOffset));
  const actualLanding = round(bStart + landingOffset);
  const entry = trustedEntry ? {
    ...trustedEntry,
    playFrom: bStart,
    landingAt: requestedLanding,
  } : {
    type: 'start',
    role: 'entry',
    source: 'fallback',
    time: 0,
    playFrom: bStart,
    landingAt: actualLanding,
    landingType: 'start',
    confidence: 0.35,
  };
  const fallbackTimeline = [
    { t: 0, deck: 'B', op: 'play', at: bStart, volume: 0 },
    { t: 0, deck: 'A', op: 'filter', type: 'highpass', value: 1800, duration: 450 },
    { t: 0, deck: 'A', op: 'bass', value: 0.12, duration: 350 },
    { t: 0, deck: 'A', op: 'volume', value: 0, duration: 500, curve: 'equal-power-out' },
    { t: bRiseAt, deck: 'B', op: 'volume', value: 1, duration: bRiseDuration, curve: 'equal-power-in' },
    { t: overlapDuration, deck: 'B', op: 'handoff' },
  ];
  const timeline = fallbackTimeline;
  const exit = selectedExit ? { ...selectedExit, time: mixStart } : {
    type: 'terminal-boundary',
    role: 'exit',
    source: 'fallback',
    time: mixStart,
  };
  return {
    exit,
    entry,
    sectionChoice: null,
    recipeCandidate: {
      recipe: 'terminal-rescue',
      score: 0,
      timeline,
      fallbackTimeline,
      window: { audibleStart: 0, audibleEnd: landingOffset, audibleOverlap: 0.12, preRollDuration: bRiseAt, handoffOffset: overlapDuration, runwayAvailable: true, landingError: round(actualLanding - requestedLanding) },
    },
    timeline,
    mixStart,
    handoffAt: round(mixStart + overlapDuration),
    audibleOverlap: 0.12,
    preRollDuration: bRiseAt,
    exitRatio: round(mixStart / Math.max(1, duration)),
    energyContinuity: 0.35,
    grooveContinuity: 0.35,
    tempoCompatibility: 0,
    score: 0,
    rejectionReasons: ['no valid complete transition window', ...(rejected.length ? ['structural windows rejected'] : [])],
    routeFallbackUsed: true,
  };
}

function representativeRelationshipRisks(fromAnalysis, toAnalysis, exits, entries) {
  const exit = exits.slice()
    .sort((a, b) => scoreWindowExit(b) - scoreWindowExit(a) || toNumber(a.time) - toNumber(b.time))[0];
  const entry = entries[0];
  if (!exit || !entry) return [];
  const scored = scoreCandidatePair(exit, entry, fromAnalysis, toAnalysis, scoreWindowExit, exits);
  return Array.from(new Set((scored.evaluation && scored.evaluation.risks || [])
    .filter((risk) => typeof risk === 'string' && risk))).slice(0, 4);
}

function chooseTransitionWindow(fromAnalysis = {}, toAnalysis = {}) {
  const fromProfile = profileOf(fromAnalysis);
  const toProfile = profileOf(toAnalysis);
  const protectedUntil = toNumber(fromAnalysis.structureMap && fromAnalysis.structureMap.protectedUntil);
  const sourceExitOptions = sourceExits(fromAnalysis, protectedUntil);
  const entries = landingOptions(toAnalysis);
  const musicalEvidence = musicalEvidenceFor(fromAnalysis, toAnalysis);
  const risks = representativeRelationshipRisks(fromAnalysis, toAnalysis, sourceExitOptions, entries);
  const policy = classifyTransitionRoute({
    fromProfile,
    toProfile,
    protectedUntil,
    exits: sourceExitOptions,
    entries,
    risks,
  });
  const exits = exitOptions(fromAnalysis, protectedUntil, policy);
  const diagnostics = {
    protectedUntil,
    sourceExitCount: exitSourceCandidates(fromAnalysis).length,
    sourceLandingCount: sourceLandings(toAnalysis).length,
    consideredExitCount: exits.length,
    consideredLandingCount: entries.length,
    exitCount: exits.length,
    landingCount: entries.length,
    recipeCandidatesConsidered: 0,
    musicalEvidence: !!musicalEvidence,
    musicalCompatibility: musicalEvidence ? musicalEvidence.score : null,
    harmonicSimilarity: musicalEvidence ? musicalEvidence.harmonicSimilarity : null,
    keyCompatibility: musicalEvidence ? musicalEvidence.keyCompatibility : null,
    melodySimilarity: musicalEvidence ? musicalEvidence.melodySimilarity : null,
    musicalRisks: musicalEvidence ? musicalEvidence.risks : [],
  };

  if (policy.route === 'terminal-rescue') {
    const chosen = terminalRescue(fromAnalysis, fromProfile, toProfile, protectedUntil, policy, [], entries);
    chosen.policy = policy;
    return {
      chosen,
      candidates: [],
      rejected: [],
      diagnostics,
      policy,
    };
  }

  const candidateWindows = [];
  const rejected = [];

  exits.forEach((exit) => {
    entries.forEach((entry) => {
      const scoredSectionChoice = scoreCandidatePair(exit, entry, fromAnalysis, toAnalysis, scoreWindowExit, exits);
      const sectionChoice = { ...scoredSectionChoice, score: clamp(scoredSectionChoice.score) };
      const recipePlan = planRecipeCandidates(fromProfile, toProfile, {
        sectionChoice: { ...sectionChoice, entry: recipeSectionEntry(entry) },
        routePolicy: policy,
      });
      (recipePlan.candidates || []).filter((candidate) => recipeCandidateAllowedByRoute(candidate, policy)).forEach((candidate) => {
        const recipeCandidate = { ...candidate, score: clamp(candidate.score) };
        diagnostics.recipeCandidatesConsidered += 1;
        const reasons = rejectionReasons({
          protectedUntil,
          sourceDuration: fromProfile.duration,
          exit,
          entry,
          recipeCandidate,
          diagnostics: recipePlan.diagnostics || {},
        });
        const window = rankWindow({ exit, entry, sectionChoice, recipeCandidate, diagnostics: recipePlan.diagnostics || {}, fromProfile, toProfile, policy, musicalEvidence });
        if (reasons.length) rejected.push({ ...window, rejectionReasons: reasons });
        else candidateWindows.push(window);
      });
    });
  });
  candidateWindows.sort((a, b) => b.score - a.score || a.exit.time - b.exit.time || a.entry.landingAt - b.entry.landingAt);
  const selectedPolicy = candidateWindows.length ? policy : terminalRescuePolicy(policy, fromProfile, protectedUntil);
  const chosen = candidateWindows[0] || terminalRescue(fromAnalysis, fromProfile, toProfile, protectedUntil, selectedPolicy, rejected, entries);
  chosen.policy = selectedPolicy;
  if (!chosen.routeFallbackUsed) chosen.routeFallbackUsed = false;
  return {
    chosen,
    candidates: candidateWindows.slice(1).map(compactWindow),
    rejected: rejected.map(compactWindow),
    diagnostics,
    policy: selectedPolicy,
  };
}

module.exports = { chooseTransitionWindow, isAnchoredLandingDiagnosticValid };

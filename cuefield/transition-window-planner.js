const { round, toNumber } = require('./cue-profile');
const { planRecipeCandidates } = require('./recipe-planner');
const { scoreCandidatePair } = require('./section-candidates');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value)));
}

function profileOf(analysis) {
  return analysis && analysis.cueProfile || analysis || {};
}

function landingKind(entry) {
  const explicit = String(entry && entry.landingType || '').toLowerCase();
  if (explicit) return explicit;
  const type = String(entry && entry.type || 'start').toLowerCase();
  if (type === 'pre-hook' || type === 'hook' || type === 'chorus') return 'hook';
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

function landingOptions(analysis) {
  const structure = analysis && analysis.structureMap || {};
  const candidates = [...(structure.entryCandidates || []), ...(analysis && analysis.candidates || [])]
    .filter((candidate) => candidate && candidate.role === 'entry')
    .map(normalizeEntry)
    .sort((a, b) => toNumber(b.confidence) - toNumber(a.confidence) || a.time - b.time);
  const unique = [];
  candidates.forEach((candidate) => {
    if (!unique.some((item) => item.landingType === candidate.landingType && Math.abs(item.landingAt - candidate.landingAt) < 0.08)) {
      unique.push(candidate);
    }
  });
  return unique.slice(0, 6);
}

function sourceExits(analysis, protectedUntil) {
  const structure = analysis && analysis.structureMap || {};
  const source = structure.exitCandidates && structure.exitCandidates.length
    ? structure.exitCandidates
    : (analysis && analysis.candidates || []).filter((candidate) => candidate && candidate.role === 'exit');
  return source.filter((candidate) => candidate && candidate.role === 'exit' && toNumber(candidate.time) >= protectedUntil);
}

function scoreWindowExit(candidate) {
  let score = clamp(candidate && candidate.confidence);
  if (candidate && candidate.type === 'release') score += 0.18;
  if (toNumber(candidate && candidate.energyAfter) < toNumber(candidate && candidate.energyBefore)) score += 0.08;
  return score - toNumber(candidate && candidate.latePenalty);
}

function exitOptions(analysis, protectedUntil) {
  return sourceExits(analysis, protectedUntil)
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

function rejectionReasons({ protectedUntil, exit, entry, recipeCandidate, diagnostics }) {
  const reasons = [];
  const window = recipeCandidate.window || {};
  const mixStart = toNumber(exit.time) + toNumber(window.audibleStart);
  const anchored = ['hook', 'intro', 'drop'].includes(landingKind(entry));
  if (mixStart < protectedUntil) reasons.push('mix start precedes protected section');
  if (anchored && window.runwayAvailable === false) reasons.push('landing has no runway');
  if (anchored && Math.abs(toNumber(window.landingError, Number.MAX_SAFE_INTEGER)) > 0.08) reasons.push('landing error exceeds .08');
  if (landingKind(entry) === 'hook' && entry.playFrom === entry.landingAt && toNumber(diagnostics.relativeTempoDelta) > 0.15) {
    reasons.push('direct hook has no compatible runway');
  }
  if (!Array.isArray(recipeCandidate.timeline) || !recipeCandidate.timeline.length) reasons.push('missing executable timeline');
  return reasons;
}

function rankWindow({ exit, entry, sectionChoice, recipeCandidate, diagnostics, fromProfile, toProfile }) {
  const energyContinuity = clamp(diagnostics.energyScore);
  const tempoCompatibility = clamp(diagnostics.bpmScore);
  const groove = grooveContinuity(fromProfile, toProfile, exit, entry, diagnostics);
  const continuity = (energyContinuity + groove + tempoCompatibility + clamp(diagnostics.bassScore)) / 4;
  const exitRatio = toNumber(exit.exitRatio, toNumber(exit.time) / Math.max(1, toNumber(fromProfile.duration)));
  const latePenalty = Math.max(toNumber(exit.latePenalty), exitRatio > 0.78 ? 0.45 : 0);
  const score = sectionChoice.score * 0.34
    + toNumber(recipeCandidate.score) * 0.2
    + ((clamp(exit.confidence) + clamp(entry.confidence)) / 2) * 0.16
    + overlapScore(recipeCandidate.window.audibleOverlap, toNumber(diagnostics.relativeTempoDelta)) * 0.12
    + continuity * 0.18
    - latePenalty;
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
    exitRatio: round(exitRatio),
    energyContinuity: round(energyContinuity),
    grooveContinuity: groove,
    tempoCompatibility: round(tempoCompatibility),
    score: round(score),
    rejectionReasons: [],
  };
}

function startFallback(fromProfile, exit, rejected) {
  const entry = { type: 'start', role: 'entry', source: 'fallback', time: 0, playFrom: 0, landingType: 'start', confidence: 0.35 };
  const timeline = [
    { t: 0, deck: 'B', op: 'play', at: 0, volume: 0 },
    { t: 0, deck: 'B', op: 'volume', value: 1, duration: 3400, curve: 'equal-power-in' },
    { t: 0, deck: 'A', op: 'volume', value: 0, duration: 3400, curve: 'equal-power-out' },
    { t: 3.4, deck: 'B', op: 'handoff' },
  ];
  return {
    exit: exit || null,
    entry,
    sectionChoice: null,
    recipeCandidate: { recipe: 'honest-start-fallback', score: 0, timeline, window: { audibleStart: 0, audibleEnd: 3.4, audibleOverlap: 3.4, preRollDuration: 0, handoffOffset: 3.4, runwayAvailable: null, landingError: null } },
    timeline,
    mixStart: round(toNumber(exit && exit.time)),
    handoffAt: round(toNumber(exit && exit.time) + 3.4),
    audibleOverlap: 3.4,
    preRollDuration: 0,
    exitRatio: round(toNumber(exit && exit.time) / Math.max(1, toNumber(fromProfile && fromProfile.duration))),
    energyContinuity: 0.35,
    grooveContinuity: 0.35,
    tempoCompatibility: 0,
    score: 0,
    rejectionReasons: ['no valid complete transition window'],
    rejected,
  };
}

function chooseTransitionWindow(fromAnalysis = {}, toAnalysis = {}) {
  const fromProfile = profileOf(fromAnalysis);
  const toProfile = profileOf(toAnalysis);
  const protectedUntil = toNumber(fromAnalysis.structureMap && fromAnalysis.structureMap.protectedUntil);
  const exits = exitOptions(fromAnalysis, protectedUntil);
  const entries = landingOptions(toAnalysis);
  const candidates = [];
  const rejected = [];
  const diagnostics = { protectedUntil, exitCount: exits.length, landingCount: entries.length, recipeCandidatesConsidered: 0 };

  exits.forEach((exit) => {
    entries.forEach((entry) => {
      const sectionChoice = scoreCandidatePair(exit, entry, fromAnalysis, toAnalysis, scoreWindowExit, exits);
      const recipePlan = planRecipeCandidates(fromProfile, toProfile, {
        sectionChoice: { ...sectionChoice, entry: recipeSectionEntry(entry) },
      });
      (recipePlan.candidates || []).forEach((recipeCandidate) => {
        diagnostics.recipeCandidatesConsidered += 1;
        const reasons = rejectionReasons({ protectedUntil, exit, entry, recipeCandidate, diagnostics: recipePlan.diagnostics || {} });
        const window = rankWindow({ exit, entry, sectionChoice, recipeCandidate, diagnostics: recipePlan.diagnostics || {}, fromProfile, toProfile });
        if (reasons.length) rejected.push({ ...window, rejectionReasons: reasons });
        else candidates.push(window);
      });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.exit.time - b.exit.time || a.entry.landingAt - b.entry.landingAt);
  const earliestExit = sourceExits(fromAnalysis, protectedUntil)
    .slice()
    .sort((a, b) => toNumber(a.time) - toNumber(b.time))[0] || exits[0];
  const chosen = candidates[0] || startFallback(fromProfile, earliestExit, rejected);
  return { chosen, candidates, rejected, diagnostics };
}

module.exports = { chooseTransitionWindow };

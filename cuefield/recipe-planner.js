const { round, toNumber } = require('./cue-profile');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value)));
}

function densityAt(windows, time) {
  const list = Array.isArray(windows) ? windows : [];
  const found = list.find((window) => time >= toNumber(window.start) && time < toNumber(window.end));
  if (found) return clamp(found.value);
  const nearest = list.slice().sort((a, b) => Math.abs(toNumber(a.start) - time) - Math.abs(toNumber(b.start) - time))[0];
  return nearest ? clamp(nearest.value) : 0;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function barsInRange(profile, start, end) {
  const bars = profile && Array.isArray(profile.bars) ? profile.bars : [];
  return bars.filter((bar) => toNumber(bar.end) > start && toNumber(bar.start) < end);
}

function textureAt(profile, start, end) {
  const bars = barsInRange(profile, start, end);
  return {
    energy: clamp(average(bars.map((bar) => toNumber(bar.energy, NaN)))),
    low: clamp(average(bars.map((bar) => toNumber(bar.lowDensity, NaN)))),
    body: clamp(average(bars.map((bar) => toNumber(bar.bodyDensity, NaN)))),
    snap: clamp(average(bars.map((bar) => toNumber(bar.snapDensity, NaN)))),
  };
}

function nearestCandidate(profile, role, time) {
  return (profile.candidates || [])
    .filter((candidate) => candidate && candidate.role === role && Number.isFinite(toNumber(candidate.time, NaN)))
    .sort((a, b) => Math.abs(toNumber(a.time) - time) - Math.abs(toNumber(b.time) - time))[0] || null;
}

function firstCandidate(profile, predicate) {
  return (profile.candidates || [])
    .filter((candidate) => candidate && Number.isFinite(toNumber(candidate.time, NaN)) && predicate(candidate))
    .sort((a, b) => toNumber(b.confidence) - toNumber(a.confidence) || toNumber(a.time) - toNumber(b.time))[0] || null;
}

function downbeatOffset(timeA, timeB, barLength) {
  if (!barLength) return 0;
  const raw = Math.abs((timeA - timeB) % barLength);
  return round(Math.min(raw, Math.abs(barLength - raw)));
}

function barLength(profile) {
  const bars = profile && Array.isArray(profile.bars) ? profile.bars : [];
  const first = bars.find((bar) => toNumber(bar.end) > toNumber(bar.start));
  return first ? round(first.end - first.start) : Math.max(1, toNumber(profile && profile.gridStep, 0.5) * 4);
}

function pickAnchors(fromProfile, toProfile, opts = {}) {
  const sectionChoice = opts.sectionChoice || {};
  const fromCue = fromProfile.cuePoints || {};
  const toCue = toProfile.cuePoints || {};
  const hook = firstCandidate(toProfile, (candidate) => candidate.role === 'entry' && (candidate.type === 'hook' || candidate.type === 'chorus'));
  const intro = firstCandidate(toProfile, (candidate) => candidate.role === 'entry' && candidate.type === 'intro');
  const aExit = round(toNumber(sectionChoice.exit && sectionChoice.exit.time, toNumber(fromCue.outroStart, Math.max(0, fromProfile.duration - 16))));
  const bIntro = round(toNumber(intro && intro.time, toNumber(toCue.introStart, 0)));
  const sectionEntry = sectionChoice.entry || {};
  const bAnchor = round(toNumber(sectionEntry.resolvesTo && sectionEntry.resolvesTo.time, toNumber(sectionEntry.time, toNumber(hook && hook.time, toNumber(toCue.firstStrongDownbeat, bIntro)))));
  const bStart = Math.max(0, Math.min(bIntro, bAnchor));
  const bar = barLength(fromProfile);

  return {
    aExit,
    bStart: round(bStart),
    bAnchor,
    barLength: bar,
    downbeatOffset: 0,
  };
}

function commonScores(fromProfile, toProfile, anchors) {
  const aEnergy = densityAt(fromProfile.windows && fromProfile.windows.energy, anchors.aExit);
  const bEnergy = densityAt(toProfile.windows && toProfile.windows.energy, anchors.bAnchor);
  const aBass = densityAt(fromProfile.windows && fromProfile.windows.bass, anchors.aExit);
  const bBass = densityAt(toProfile.windows && toProfile.windows.bass, anchors.bStart);
  const bpmDiff = Math.abs(toNumber(fromProfile.bpm) - toNumber(toProfile.bpm));
  const beatScore = 1 - Math.min(1, anchors.downbeatOffset / Math.max(anchors.barLength / 2, 0.001));
  const energyScore = 1 - Math.min(1, Math.abs(aEnergy - bEnergy) / 0.65);
  const bassScore = 1 - Math.min(1, Math.max(0, aBass + bBass - 0.88) / 0.7);
  const bpmScore = 1 - Math.min(1, bpmDiff / 18);
  const outroTexture = textureAt(fromProfile, anchors.aExit, toNumber(fromProfile.duration, anchors.aExit) + 0.001);
  const introTexture = textureAt(toProfile, anchors.bStart, anchors.bStart + 12);
  const exitCandidate = nearestCandidate(fromProfile, 'exit', anchors.aExit);
  const outroLengthScore = clamp((toNumber(fromProfile.duration) - anchors.aExit) / 16);
  const outroConfidence = clamp(exitCandidate && exitCandidate.confidence, 0, 1);
  const outroCompleteness = clamp(outroLengthScore * 0.45 + outroConfidence * 0.35 + (1 - outroTexture.energy) * 0.2);
  const bIntroAggression = clamp(introTexture.energy * 0.55 + introTexture.low * 0.25 + introTexture.snap * 0.2);
  const styleTextureDistance = clamp(average([
    Math.abs(outroTexture.energy - introTexture.energy),
    Math.abs(outroTexture.low - introTexture.low),
    Math.abs(outroTexture.body - introTexture.body),
    Math.abs(outroTexture.snap - introTexture.snap),
  ]) / 0.7);

  return {
    aEnergy,
    bEnergy,
    aBass,
    bBass,
    beatScore,
    energyScore,
    bassScore,
    bpmScore,
    outroCompleteness,
    bIntroAggression,
    styleTextureDistance,
  };
}

function baseCandidate(recipe, score, confidence, reason, risks, anchors, timeline) {
  return {
    recipe,
    score: round(score),
    confidence: round(confidence),
    reason,
    risks,
    anchors,
    timeline,
  };
}

function makeLongBlend(anchors, scores) {
  const lead = 8;
  const score = 0.28 + scores.beatScore * 0.28 + scores.energyScore * 0.18 + scores.bassScore * 0.18 + scores.bpmScore * 0.08;
  const risks = [];
  if (scores.bassScore < 0.45) risks.push('bass overlap needs eq');
  return baseCandidate(
    'intro-outro-long-blend',
    score,
    Math.min(0.9, score + 0.04),
    ['A outro supports longer bed', 'B intro can enter before anchor'],
    risks,
    { ...anchors, lead },
    [
      { t: -lead, deck: 'B', op: 'play', at: anchors.bStart, volume: 0 },
      { t: -lead, deck: 'B', op: 'volume', value: 0.58, duration: 5200 },
      { t: -4.5, deck: 'B', op: 'filter', type: 'highpass', value: 650, duration: 2600 },
      { t: -3.2, deck: 'A', op: 'bass', value: 0.38, duration: 2200 },
      { t: -1.2, deck: 'B', op: 'bass', value: 0.82, duration: 1400 },
      { t: 0, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 900 },
      { t: 0.8, deck: 'A', op: 'volume', value: 0, duration: 1600 },
      { t: 2.6, deck: 'B', op: 'handoff' },
    ],
  );
}

function makeFilteredPickup(anchors, scores) {
  const lead = 4;
  const bStart = Math.max(0, anchors.bAnchor - lead);
  const score = 0.34 + scores.beatScore * 0.3 + scores.energyScore * 0.18 + scores.bassScore * 0.12 + scores.bpmScore * 0.06;
  const risks = [];
  if (scores.energyScore < 0.35) risks.push('noticeable energy change');
  return baseCandidate(
    'filtered-pickup',
    score,
    Math.min(0.92, score + 0.05),
    ['B pickup is filtered before downbeat', 'A low end clears before handoff'],
    risks,
    { ...anchors, bStart: round(bStart), lead },
    [
      { t: -lead, deck: 'B', op: 'play', at: round(bStart), volume: 0 },
      { t: -lead, deck: 'B', op: 'filter', type: 'highpass', value: 900, duration: 1800 },
      { t: -3.6, deck: 'B', op: 'volume', value: 0.72, duration: 2600 },
      { t: -2.2, deck: 'A', op: 'bass', value: 0.35, duration: 1300 },
      { t: -0.4, deck: 'B', op: 'bass', value: 0.8, duration: 900 },
      { t: 0, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 900 },
      { t: 1.1, deck: 'A', op: 'volume', value: 0, duration: 1000 },
      { t: 2.2, deck: 'B', op: 'handoff' },
    ],
  );
}

function makeBassHandoff(anchors, scores) {
  const lead = 5.2;
  const score = 0.3 + scores.beatScore * 0.28 + scores.bassScore * 0.24 + scores.energyScore * 0.12 + scores.bpmScore * 0.06;
  const risks = [];
  if (scores.aBass > 0.65 && scores.bBass > 0.55) risks.push('requires bass swap');
  return baseCandidate(
    'bass-eq-handoff',
    score,
    Math.min(0.88, score + 0.03),
    ['bass is exchanged instead of stacked', 'handoff lands near downbeat'],
    risks,
    { ...anchors, lead },
    [
      { t: -lead, deck: 'B', op: 'play', at: anchors.bStart, volume: 0 },
      { t: -lead, deck: 'B', op: 'bass', value: 0.15, duration: 0 },
      { t: -4.8, deck: 'B', op: 'volume', value: 0.68, duration: 2600 },
      { t: -2.6, deck: 'A', op: 'bass', value: 0.18, duration: 1800 },
      { t: -1, deck: 'B', op: 'bass', value: 0.92, duration: 1100 },
      { t: 0.3, deck: 'A', op: 'volume', value: 0, duration: 1200 },
      { t: 1.8, deck: 'B', op: 'handoff' },
    ],
  );
}

function makeQuickFade(anchors, scores) {
  const lead = 2.6;
  const score = 0.24 + scores.beatScore * 0.32 + scores.energyScore * 0.16 + scores.bpmScore * 0.1;
  return baseCandidate(
    'quick-safe-fade',
    score,
    Math.min(0.78, score),
    ['fallback when longer overlap is risky'],
    ['short transition'],
    { ...anchors, lead },
    [
      { t: -lead, deck: 'B', op: 'play', at: anchors.bAnchor, volume: 0 },
      { t: -lead, deck: 'B', op: 'volume', value: 0.76, duration: 1800 },
      { t: -0.6, deck: 'A', op: 'volume', value: 0.2, duration: 800 },
      { t: 0.3, deck: 'A', op: 'volume', value: 0, duration: 600 },
      { t: 1, deck: 'B', op: 'handoff' },
    ],
  );
}

function safetyAssessment(fromProfile, toProfile, sectionChoice = {}) {
  const entry = sectionChoice.entry || {};
  const entrySource = String(entry.source || 'fallback');
  const entryConfidence = clamp(entry.confidence);
  const entryTrusted = entrySource !== 'fallback' && entryConfidence >= 0.6;
  const bpmA = Math.max(0, toNumber(fromProfile && fromProfile.bpm));
  const bpmB = Math.max(0, toNumber(toProfile && toProfile.bpm));
  const relativeTempoDelta = bpmA > 0 && bpmB > 0 ? Math.abs(bpmA - bpmB) / Math.max(bpmA, bpmB) : 1;
  const fromDownbeatConfidence = average((fromProfile && fromProfile.downbeats || []).map((beat) => toNumber(beat.confidence, NaN)));
  const toDownbeatConfidence = average((toProfile && toProfile.downbeats || []).map((beat) => toNumber(beat.confidence, NaN)));
  const fromBarStability = average((fromProfile && fromProfile.bars || []).map((bar) => toNumber(bar.beatStability, NaN)));
  const toBarStability = average((toProfile && toProfile.bars || []).map((bar) => toNumber(bar.beatStability, NaN)));
  const beatGridTrusted = !!(
    fromProfile && toProfile
    && toNumber(fromProfile.gridStep) > 0
    && toNumber(toProfile.gridStep) > 0
    && (fromProfile.downbeats || []).length >= 4
    && (toProfile.downbeats || []).length >= 4
    && fromDownbeatConfidence >= 0.65
    && toDownbeatConfidence >= 0.65
    && fromBarStability >= 0.35
    && toBarStability >= 0.35
  );
  let overlapClass = 'short';
  if (entryTrusted && beatGridTrusted && relativeTempoDelta <= 0.08) overlapClass = 'long';
  else if (entryTrusted && relativeTempoDelta <= 0.15) overlapClass = 'medium';
  const overlapDuration = overlapClass === 'long' ? 10.5 : (overlapClass === 'medium' ? 5.6 : 3.1);
  return {
    entrySource,
    entryConfidence: round(entryConfidence),
    entryTrusted,
    bpmA: round(bpmA),
    bpmB: round(bpmB),
    relativeTempoDelta: round(relativeTempoDelta),
    beatGridTrusted,
    overlapClass,
    overlapDuration,
  };
}

function safetyTimeline(anchors, assessment) {
  const overlapClass = assessment.overlapClass;
  const lead = overlapClass === 'long' ? 9.5 : (overlapClass === 'medium' ? 5 : 2.8);
  const handoffAt = round(assessment.overlapDuration - lead);
  const bStart = round(Math.max(0, anchors.bAnchor - lead));
  if (overlapClass === 'short') {
    return {
      lead,
      bStart,
      timeline: [
        { t: -lead, deck: 'B', op: 'play', at: bStart, volume: 0 },
        { t: -lead, deck: 'B', op: 'bass', value: 0.15, duration: 0 },
        { t: -lead, deck: 'B', op: 'volume', value: 0, duration: 1400 },
        { t: -1.6, deck: 'A', op: 'bass', value: 0.5, duration: 700 },
        { t: -1.4, deck: 'B', op: 'volume', value: 1, duration: 1400, curve: 'equal-power-in' },
        { t: -1.4, deck: 'A', op: 'volume', value: 0, duration: 1400, curve: 'equal-power-out' },
        { t: -0.8, deck: 'B', op: 'bass', value: 0.85, duration: 700 },
        { t: 0, deck: 'B', op: 'bass', value: 1, duration: 300 },
        { t: handoffAt, deck: 'B', op: 'handoff' },
      ],
    };
  }
  if (overlapClass === 'medium') {
    return {
      lead,
      bStart,
      timeline: [
        { t: -lead, deck: 'B', op: 'play', at: bStart, volume: 0 },
        { t: -lead, deck: 'B', op: 'bass', value: 0.12, duration: 0 },
        { t: -lead, deck: 'B', op: 'filter', type: 'highpass', value: 850, duration: 0 },
        { t: -lead, deck: 'B', op: 'volume', value: 0, duration: 2800 },
        { t: -1.8, deck: 'B', op: 'volume', value: 1, duration: 1800, curve: 'equal-power-in' },
        { t: -1.8, deck: 'A', op: 'bass', value: 0.3, duration: 1000 },
        { t: -1.2, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 1000 },
        { t: -1.8, deck: 'A', op: 'volume', value: 0, duration: 1800, curve: 'equal-power-out' },
        { t: -0.8, deck: 'B', op: 'bass', value: 1, duration: 900 },
        { t: handoffAt, deck: 'B', op: 'handoff' },
      ],
    };
  }
  return {
    lead,
    bStart,
    timeline: [
      { t: -lead, deck: 'B', op: 'play', at: bStart, volume: 0 },
      { t: -lead, deck: 'B', op: 'bass', value: 0.08, duration: 0 },
      { t: -lead, deck: 'B', op: 'filter', type: 'highpass', value: 1100, duration: 0 },
      { t: -lead, deck: 'B', op: 'volume', value: 0, duration: 3600 },
      { t: -5.4, deck: 'B', op: 'volume', value: 0, duration: 3000 },
      { t: -2, deck: 'A', op: 'filter', type: 'highpass', value: 160, duration: 1600 },
      { t: -1.8, deck: 'A', op: 'bass', value: 0.24, duration: 1200 },
      { t: -2, deck: 'B', op: 'volume', value: 1, duration: 2000, curve: 'equal-power-in' },
      { t: -1.2, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 1100 },
      { t: -2, deck: 'A', op: 'volume', value: 0, duration: 2000, curve: 'equal-power-out' },
      { t: -0.8, deck: 'B', op: 'bass', value: 1, duration: 900 },
      { t: handoffAt, deck: 'B', op: 'handoff' },
    ],
  };
}

function makeSafetyLongBlend(anchors, scores, sectionChoice = {}, fromProfile = {}, toProfile = {}) {
  const assessment = safetyAssessment(fromProfile, toProfile, sectionChoice);
  const execution = safetyTimeline(anchors, assessment);
  const lead = execution.lead;
  const bStart = execution.bStart;
  const score = 0.48
    + scores.bpmScore * 0.08
    + scores.beatScore * 0.05
    + scores.outroCompleteness * 0.08
    - scores.bIntroAggression * 0.04
    - scores.styleTextureDistance * 0.03;
  const tier = sectionChoice.evaluation && sectionChoice.evaluation.tier || '';
  const risks = ['safety fallback'];
  if (tier === 'reject') risks.push('masked rejected pair');
  if (scores.bassScore < 0.5) risks.push('bass protected');
  if (scores.bIntroAggression > 0.68) risks.push('intro aggression masked');
  if (scores.styleTextureDistance > 0.45) risks.push('texture distance masked');
  return baseCandidate(
    'safety-long-blend',
    score,
    0.72,
    [
      'universal conservative blend for weak or rejected pairs',
      'B enters from intro or low-density start instead of hook',
      'low end is delayed to avoid bass collision',
    ],
    risks,
    { ...anchors, ...assessment, bStart, lead, safetyFallback: true },
    execution.timeline,
  );
}

function planRecipeCandidates(fromProfile, toProfile, opts = {}) {
  const anchors = pickAnchors(fromProfile || {}, toProfile || {}, opts);
  const scores = commonScores(fromProfile || {}, toProfile || {}, anchors);
  const sectionTier = opts.sectionChoice && opts.sectionChoice.evaluation && opts.sectionChoice.evaluation.tier || '';
  const sectionRisks = opts.sectionChoice && opts.sectionChoice.evaluation && opts.sectionChoice.evaluation.risks || [];
  const needsSafetyFallback = sectionTier === 'weak'
    || sectionTier === 'reject'
    || sectionRisks.includes('directionality mismatch')
    || sectionRisks.includes('style bridge mismatch');
  const safety = makeSafetyLongBlend(anchors, scores, opts.sectionChoice, fromProfile, toProfile);
  const candidates = [
    safety,
    makeLongBlend(anchors, scores),
    makeFilteredPickup(anchors, scores),
    makeBassHandoff(anchors, scores),
    makeQuickFade(anchors, scores),
  ].sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  const requiresAdaptiveSafety = needsSafetyFallback || safety.anchors.overlapClass !== 'long';
  const chosen = requiresAdaptiveSafety
    ? safety
    : (candidates.find((candidate) => !candidate.risks.includes('hard cut')) || candidates[0]);

  return {
    chosen,
    candidates,
    diagnostics: {
      aEnergy: round(scores.aEnergy),
      bEnergy: round(scores.bEnergy),
      aBass: round(scores.aBass),
      bBass: round(scores.bBass),
      beatScore: round(scores.beatScore),
      energyScore: round(scores.energyScore),
      bassScore: round(scores.bassScore),
      bpmScore: round(scores.bpmScore),
      outroCompleteness: round(scores.outroCompleteness),
      bIntroAggression: round(scores.bIntroAggression),
      styleTextureDistance: round(scores.styleTextureDistance),
      entrySource: safety.anchors.entrySource,
      entryConfidence: safety.anchors.entryConfidence,
      entryTrusted: safety.anchors.entryTrusted,
      bpmA: safety.anchors.bpmA,
      bpmB: safety.anchors.bpmB,
      relativeTempoDelta: safety.anchors.relativeTempoDelta,
      beatGridTrusted: safety.anchors.beatGridTrusted,
      overlapClass: safety.anchors.overlapClass,
      overlapDuration: safety.anchors.overlapDuration,
    },
  };
}

module.exports = {
  planRecipeCandidates,
};

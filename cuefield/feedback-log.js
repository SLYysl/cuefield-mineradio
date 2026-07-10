const fs = require('fs');
const path = require('path');

function roundNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

function compactString(value, maxLength = 160) {
  const text = String(value == null ? '' : value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function compactList(value, maxItems = 8) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => compactString(item, 80)).filter(Boolean)
    : [];
}

function normalizeHookCount(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function normalizeSustainedEnergy(value) {
  if (typeof value === 'boolean') return value;
  return typeof value === 'number' ? roundNumber(value) : null;
}

function compactRejectionReasons(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((reason) => compactString(reason, 96)).filter(Boolean))).slice(0, 8);
}

function compactWindow(window = {}) {
  return {
    firstHookStart: roundNumber(window.firstHookStart),
    firstHookEnd: roundNumber(window.firstHookEnd),
    hookConfidence: roundNumber(window.hookConfidence),
    hookEvidence: {
      repeatedLineCount: normalizeHookCount(window.hookEvidence && window.hookEvidence.repeatedLineCount),
      repeatedBlockCount: normalizeHookCount(window.hookEvidence && window.hookEvidence.repeatedBlockCount),
      energyLift: roundNumber(window.hookEvidence && window.hookEvidence.energyLift),
      sustainedEnergy: normalizeSustainedEnergy(window.hookEvidence && window.hookEvidence.sustainedEnergy),
    },
    exitRatio: roundNumber(window.exitRatio),
    mixStart: roundNumber(window.mixStart),
    handoffAt: roundNumber(window.handoffAt),
    landingAt: roundNumber(window.landingAt),
    audibleOverlap: roundNumber(window.audibleOverlap),
    preRollDuration: roundNumber(window.preRollDuration),
    energyContinuity: roundNumber(window.energyContinuity),
    grooveContinuity: roundNumber(window.grooveContinuity),
    tempoCompatibility: roundNumber(window.tempoCompatibility),
    rejectionReasons: compactRejectionReasons(window.rejectionReasons),
  };
}

function normalizeRating(value) {
  const rating = Number(value);
  if (rating !== 1 && rating !== 2 && rating !== 3) {
    const err = new Error('RATING_MUST_BE_1_2_OR_3');
    err.code = 'RATING_MUST_BE_1_2_OR_3';
    throw err;
  }
  return rating;
}

function compactPair(pair = {}) {
  return {
    fromKey: compactString(pair.fromKey, 120),
    toKey: compactString(pair.toKey, 120),
    fromTitle: compactString(pair.fromTitle, 160),
    fromArtist: compactString(pair.fromArtist, 160),
    toTitle: compactString(pair.toTitle, 160),
    toArtist: compactString(pair.toArtist, 160),
  };
}

function compactDiagnostics(diagnostics = {}) {
  return {
    outroCompleteness: roundNumber(diagnostics.outroCompleteness),
    bIntroAggression: roundNumber(diagnostics.bIntroAggression),
    styleTextureDistance: roundNumber(diagnostics.styleTextureDistance),
  };
}

function compactStructure(transition = {}) {
  return {
    source: compactString(transition.structureSource || transition.source, 24),
    confidence: roundNumber(transition.structureConfidence == null ? transition.confidence : transition.structureConfidence),
    protectedUntil: roundNumber(transition.protectedUntil),
    exitType: compactString(transition.exitType, 32),
    exitConfidence: roundNumber(transition.exitConfidence),
    entryType: compactString(transition.entryType, 32),
    entryConfidence: roundNumber(transition.entryConfidence),
    exitCandidateCount: Math.max(0, Math.min(12, Number(transition.exitCandidateCount) || 0)),
    entryCandidateCount: Math.max(0, Math.min(12, Number(transition.entryCandidateCount) || 0)),
  };
}

function compactTransition(transition = {}) {
  const structure = transition.structure || transition;
  return {
    recipe: compactString(transition.recipe, 80),
    transitionRecipe: compactString(transition.transitionRecipe, 80),
    executionMode: compactString(transition.executionMode, 80),
    tier: compactString(transition.tier, 60),
    score: roundNumber(transition.score),
    evalScore: roundNumber(transition.evalScore),
    exitTime: roundNumber(transition.exitTime),
    entryTime: roundNumber(transition.entryTime),
    overlapClass: compactString(transition.overlapClass, 24),
    overlapDuration: roundNumber(transition.overlapDuration),
    entrySource: compactString(transition.entrySource, 24),
    entryConfidence: roundNumber(transition.entryConfidence),
    bpmA: roundNumber(transition.bpmA),
    bpmB: roundNumber(transition.bpmB),
    relativeTempoDelta: roundNumber(transition.relativeTempoDelta),
    beatGridTrusted: transition.beatGridTrusted === true,
    runtimeDowngrade: compactString(transition.runtimeDowngrade, 40),
    diagnostics: compactDiagnostics(transition.diagnostics),
    structure: compactStructure(structure),
    risks: compactList(transition.risks),
    window: compactWindow(transition.window || transition),
  };
}

function safeParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (err) {
    return null;
  }
}

function emptyBucket(key) {
  return { key, total: 0, passed: 0, failed: 0, pending: 0, passRate: 0 };
}

function addToBucket(map, key, rating) {
  const bucketKey = compactString(key || 'unknown', 120) || 'unknown';
  if (!map.has(bucketKey)) map.set(bucketKey, emptyBucket(bucketKey));
  const bucket = map.get(bucketKey);
  bucket.total += 1;
  if (rating === 1) bucket.passed += 1;
  else if (rating === 2) bucket.failed += 1;
  else if (rating === 3) bucket.pending += 1;
}

function finalizeBuckets(map) {
  return Array.from(map.values())
    .map((bucket) => ({
      ...bucket,
      passRate: roundNumber(bucket.total ? bucket.passed / bucket.total : 0),
    }))
    .sort((a, b) => b.total - a.total || b.failed - a.failed || a.key.localeCompare(b.key));
}

function buildCuefieldFeedbackRecord(input = {}, now = new Date()) {
  return {
    createdAt: now.toISOString(),
    rating: normalizeRating(input.rating),
    note: compactString(input.note, 240),
    pair: compactPair(input.pair),
    transition: compactTransition(input.transition),
  };
}

function appendCuefieldFeedback(filePath, input = {}, now = new Date()) {
  const record = buildCuefieldFeedbackRecord(input, now);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  return record;
}

function readCuefieldFeedbackStats(filePath) {
  const byRecipe = new Map();
  const byTier = new Map();
  const byOverlapClass = new Map();
  const byRisk = new Map();
  const byPair = new Map();
  const ratingCounts = { 1: 0, 2: 0, 3: 0 };
  const failedSamples = [];
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const records = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(safeParseJsonLine).filter(Boolean);

  records.forEach((record) => {
    const rating = Number(record.rating);
    if (rating !== 1 && rating !== 2 && rating !== 3) return;
    const pair = record.pair || {};
    const transition = record.transition || {};
    const recipe = transition.transitionRecipe || transition.recipe || transition.executionMode || 'unknown';
    const tier = transition.tier || 'unknown';
    const pairKey = [pair.fromTitle || pair.fromKey || 'A', pair.toTitle || pair.toKey || 'B'].join(' -> ');

    ratingCounts[rating] += 1;
    addToBucket(byRecipe, recipe, rating);
    addToBucket(byTier, tier, rating);
    addToBucket(byOverlapClass, transition.overlapClass || 'unknown', rating);
    addToBucket(byPair, pairKey, rating);
    (Array.isArray(transition.risks) && transition.risks.length ? transition.risks : ['none'])
      .forEach((risk) => addToBucket(byRisk, risk, rating));

    if (rating !== 1) {
      failedSamples.push({
        createdAt: compactString(record.createdAt, 40),
        rating,
        note: compactString(record.note, 180),
        pair: compactPair(pair),
        transition: compactTransition(transition),
      });
    }
  });

  const total = ratingCounts[1] + ratingCounts[2] + ratingCounts[3];
  return {
    total,
    ratingCounts,
    passRate: roundNumber(total ? ratingCounts[1] / total : 0),
    byRecipe: finalizeBuckets(byRecipe),
    byTier: finalizeBuckets(byTier),
    byOverlapClass: finalizeBuckets(byOverlapClass),
    byRisk: finalizeBuckets(byRisk),
    byPair: finalizeBuckets(byPair).slice(0, 20),
    failedSamples: failedSamples
      .sort((a, b) => a.rating - b.rating || String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20),
  };
}

module.exports = {
  appendCuefieldFeedback,
  buildCuefieldFeedbackRecord,
  readCuefieldFeedbackStats,
  compactTransition,
};

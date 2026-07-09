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

function compactTransition(transition = {}) {
  return {
    recipe: compactString(transition.recipe, 80),
    transitionRecipe: compactString(transition.transitionRecipe, 80),
    executionMode: compactString(transition.executionMode, 80),
    tier: compactString(transition.tier, 60),
    score: roundNumber(transition.score),
    evalScore: roundNumber(transition.evalScore),
    exitTime: roundNumber(transition.exitTime),
    entryTime: roundNumber(transition.entryTime),
    risks: compactList(transition.risks),
  };
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

module.exports = {
  appendCuefieldFeedback,
  buildCuefieldFeedbackRecord,
};

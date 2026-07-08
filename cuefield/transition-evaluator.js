function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value)));
}

function textOf(candidate) {
  return String(candidate && candidate.text || '').trim();
}

function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return normalizedText(value).split(/\s+/).filter(Boolean);
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'i',
  "i'm",
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'the',
  'to',
  'we',
  'you',
]);

function contentTokens(value) {
  return tokens(value).filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function includesAny(value, patterns) {
  const text = normalizedText(value);
  return patterns.some((pattern) => text.includes(pattern));
}

function isClosedOutgoingPhrase(value) {
  const text = normalizedText(value);
  if (!text) return false;
  return includesAny(text, [
    "what's going on",
    'whats going on',
    'what is going on',
    'boss bitch',
  ]);
}

function scoreExitSuitability(exit) {
  if (!exit) return 0;
  const text = textOf(exit);
  let score = exit.type === 'outro' ? 0.74 : 0.64;
  if (exit.type === 'release') score += 0.08;
  if (!text) score += 0.04;
  if (toNumber(exit.energyAfter) < toNumber(exit.energyBefore)) score += 0.07;
  if (isClosedOutgoingPhrase(text)) score = Math.min(score, 0.36);
  return round(clamp01(score));
}

function scoreEntryPromise(entry) {
  if (!entry) return 0;
  let score = entry.confidence || 0.5;
  if (entry.type === 'pre-section') score += 0.16;
  if (entry.type === 'chorus' || entry.type === 'hook') score += 0.12;
  if (entry.resolvesTo && (entry.resolvesTo.type === 'chorus' || entry.resolvesTo.type === 'hook')) score += 0.12;
  if (textOf(entry)) score += 0.04;
  return round(clamp01(score));
}

function scorePairCompatibility(exit, entry) {
  if (!exit || !entry) return 0.35;
  const exitLow = toNumber(exit.lowDensity, toNumber(exit.energyAfter, NaN));
  const entryLow = toNumber(entry.lowDensity, toNumber(entry.energyAfter, NaN));
  const exitEnergy = toNumber(exit.energyAfter, NaN);
  const entryEnergy = toNumber(entry.energyAfter, NaN);
  const lowDiff = Number.isFinite(exitLow) && Number.isFinite(entryLow) ? Math.abs(exitLow - entryLow) : 0.18;
  const energyDiff = Number.isFinite(exitEnergy) && Number.isFinite(entryEnergy) ? Math.abs(exitEnergy - entryEnergy) : lowDiff;
  return round(clamp01(1 - (lowDiff * 1.4) - (energyDiff * 0.8)));
}

function scoreLyricHandoff(exit, entry) {
  const exitText = textOf(exit);
  const entryText = textOf(entry);
  if (!exitText || !entryText) return 0;
  const exitContent = new Set(contentTokens(exitText));
  const entryContent = new Set(contentTokens(entryText));
  const shared = Array.from(exitContent).filter((token) => entryContent.has(token));
  let score = shared.length ? Math.min(0.78, 0.48 + shared.length * 0.16) : 0;

  const directionalExit = includesAny(exitText, ['break through', 'through', 'help me', 'rise', 'above', 'away', 'out']);
  const pickupEntry = includesAny(entryText, ['take me to', 'take me', 'to the', 'into', 'come with', 'go to']);
  if (directionalExit && pickupEntry) score = Math.max(score, 0.84);

  return round(clamp01(score));
}

function scoreDirectionality(exit, entry) {
  if (!exit || !entry) return 0.5;
  const delta = toNumber(entry.energyAfter) - toNumber(exit.energyAfter);
  if (delta > 0.18) return 0.46;
  if (delta > 0.04) return 0.72;
  if (delta < -0.16) return 0.42;
  return 0.68;
}

function recipeFor(ctx) {
  if (ctx.lyricHandoff >= 0.75) return 'lyric-handoff';
  if (!ctx.hasExitText && ctx.hasEntryText && ctx.exitIsOutro && ctx.exitLateEnough && ctx.entryPromise >= 0.75) {
    return 'instrumental-outro-to-vocal-hook';
  }
  if (ctx.entry && ctx.entry.type === 'pre-section') return 'outro-to-chorus';
  return 'section-jump';
}

function evaluateTransitionPair(opts = {}) {
  const exit = opts.exit || null;
  const entry = opts.entry || null;
  const fromDuration = toNumber(opts.fromDuration);
  const dimensions = {
    pairCompatibility: scorePairCompatibility(exit, entry),
    exitSuitability: scoreExitSuitability(exit),
    entryPromise: scoreEntryPromise(entry),
    lyricHandoff: scoreLyricHandoff(exit, entry),
    directionality: scoreDirectionality(exit, entry),
  };
  const ctx = {
    entry,
    lyricHandoff: dimensions.lyricHandoff,
    entryPromise: dimensions.entryPromise,
    hasExitText: Boolean(textOf(exit)),
    hasEntryText: Boolean(textOf(entry)),
    exitIsOutro: exit && (exit.type === 'outro' || exit.type === 'release'),
    exitLateEnough: !fromDuration || (exit && toNumber(exit.time) / fromDuration >= 0.89),
  };
  const recipe = recipeFor(ctx);
  const reasons = [];
  const risks = [];
  if (dimensions.lyricHandoff >= 0.75) reasons.push('lyric handoff');
  if (recipe === 'instrumental-outro-to-vocal-hook') reasons.push('instrumental outro to vocal hook');
  if (dimensions.pairCompatibility >= 0.8) reasons.push('stable energy handoff');
  if (isClosedOutgoingPhrase(textOf(exit))) risks.push('closed outgoing phrase');
  if (dimensions.directionality < 0.5) risks.push('directionality mismatch');

  const recipeBonus = recipe === 'lyric-handoff'
    ? 0.1
    : (recipe === 'instrumental-outro-to-vocal-hook' ? 0.18 : 0);
  const score = round(clamp01(
    dimensions.exitSuitability * 0.25
    + dimensions.entryPromise * 0.25
    + dimensions.pairCompatibility * 0.2
    + dimensions.lyricHandoff * 0.2
    + dimensions.directionality * 0.1
    + recipeBonus,
  ));

  return {
    recipe,
    score,
    dimensions,
    reasons,
    risks,
  };
}

module.exports = {
  evaluateTransitionPair,
  isClosedOutgoingPhrase,
};

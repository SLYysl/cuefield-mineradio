const { round, toNumber } = require('./cue-profile');

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function repeatedLyricTimes(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const key = String(line && line.normalized || '').trim();
    if (key.length < 4) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(toNumber(line.time));
  }
  return Array.from(groups.values())
    .filter((times) => times.length >= 2)
    .flat()
    .sort((a, b) => a - b);
}

function phraseForTime(phrases, time) {
  return phrases.find((phrase) => time >= toNumber(phrase.start) && time < toNumber(phrase.end)) || null;
}

function signaturePhrase(profile, lrcLines) {
  const phrases = profile.phrases || [];
  const mean = average(phrases.map((phrase) => toNumber(phrase.energy, NaN)));
  const lyricPhrase = repeatedLyricTimes(lrcLines)
    .map((time) => phraseForTime(phrases, time))
    .find((phrase) => phrase && toNumber(phrase.energy) >= mean * 0.95);
  if (lyricPhrase) return { phrase: lyricPhrase, source: 'lyric+beat', confidence: 0.82 };

  const sustained = phrases.find((phrase, index) => (
    index > 0
    && toNumber(phrase.energy) >= mean * 1.05
    && phrases[index + 1]
    && toNumber(phrases[index + 1].energy) >= mean * 0.95
  ));
  const fallback = sustained
    || phrases.slice(1).sort((a, b) => toNumber(b.energy) - toNumber(a.energy))[0]
    || phrases[0]
    || null;
  return { phrase: fallback, source: 'beat-only', confidence: sustained ? 0.62 : 0.42 };
}

function buildExitCandidates(profile, protectedUntil) {
  const phrases = profile.phrases || [];
  const duration = toNumber(profile.duration);
  const searchStart = Math.max(protectedUntil, duration * 0.35);
  const searchEnd = Math.max(searchStart, duration - 8);
  const candidates = [];

  phrases.forEach((phrase, index) => {
    const time = toNumber(phrase.end);
    if (time < searchStart || time > searchEnd) return;
    const next = phrases[index + 1];
    const before = toNumber(phrase.energy);
    const after = next ? toNumber(next.energy) : before;
    const delta = after - before;
    candidates.push({
      type: delta <= -0.08 ? 'release' : 'phrase-boundary',
      role: 'exit',
      source: 'structure',
      time: round(time),
      confidence: round(Math.max(0.35, Math.min(0.9, 0.58 - delta * 0.5))),
      energyBefore: round(before),
      energyAfter: round(after),
      beatStability: 0,
      lowDensity: 0,
      vocalDensity: 0,
    });
  });

  if (!candidates.length && duration > protectedUntil) {
    candidates.push({
      type: 'natural-tail',
      role: 'exit',
      source: 'structure',
      time: round(Math.max(protectedUntil, duration - 2)),
      confidence: 0.35,
      energyBefore: 0,
      energyAfter: 0,
      beatStability: 0,
      lowDensity: 0,
      vocalDensity: 0,
    });
  }
  return candidates;
}

function buildStructureMap(opts = {}) {
  const profile = opts.profile || {};
  const phrases = profile.phrases || [];
  const signature = signaturePhrase(profile, opts.lrcLines || []);
  const protectedUntil = round(signature.phrase
    ? signature.phrase.end
    : Math.min(toNumber(profile.duration), 32));
  const fallbackEntry = {
    type: 'start',
    role: 'entry',
    source: 'fallback',
    time: 0,
    confidence: 0.35,
    energyBefore: 0,
    energyAfter: 0,
    vocalDensity: 0,
    lowDensity: 0,
    beatStability: 0,
  };
  const signatureType = signature.source === 'lyric+beat' ? 'hook' : 'drop';
  const signatureEntry = signature.phrase && signature.confidence >= 0.6 ? {
    type: signatureType,
    role: 'entry',
    source: signature.source,
    time: round(signature.phrase.start),
    confidence: signature.confidence,
    energyBefore: 0,
    energyAfter: round(signature.phrase.energy),
    vocalDensity: signature.source === 'lyric+beat' ? 0.7 : 0,
    lowDensity: 0,
    beatStability: 0,
  } : null;
  const signatureIndex = signature.phrase ? phrases.indexOf(signature.phrase) : -1;
  const priorPhrase = signatureIndex > 0 ? phrases[signatureIndex - 1] : null;
  const preHookEntry = signatureEntry && priorPhrase ? {
    type: 'pre-hook',
    role: 'entry',
    source: signature.source,
    time: round(priorPhrase.start),
    confidence: round(Math.max(0.35, signature.confidence - 0.08)),
    resolvesTo: { type: signatureEntry.type, time: signatureEntry.time },
    energyBefore: round(priorPhrase.energy),
    energyAfter: round(signature.phrase.energy),
    vocalDensity: 0,
    lowDensity: 0,
    beatStability: 0,
  } : null;
  const sections = [];
  if (priorPhrase && preHookEntry) sections.push({
    ...priorPhrase,
    type: 'pre-hook',
    confidence: preHookEntry.confidence,
    source: signature.source,
  });
  if (signature.phrase) sections.push({
    ...signature.phrase,
    type: signatureType,
    confidence: signature.confidence,
    source: signature.source,
  });

  return {
    duration: round(profile.duration),
    structureSource: signature.source,
    structureConfidence: signature.confidence,
    protectedUntil,
    sections,
    exitCandidates: buildExitCandidates(profile, protectedUntil),
    entryCandidates: [fallbackEntry, preHookEntry, signatureEntry].filter(Boolean),
  };
}

module.exports = {
  buildStructureMap,
};

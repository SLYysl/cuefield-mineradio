const assert = require('node:assert/strict');
const test = require('node:test');

const { chooseTransitionWindow } = require('../cuefield/transition-window-planner');

function bars(duration, energy = 0.5, beatStability = 0.9) {
  return Array.from({ length: Math.ceil(duration / 2) }, (_, index) => ({
    start: index * 2,
    end: (index + 1) * 2,
    energy,
    lowDensity: energy * 0.5,
    bodyDensity: energy * 0.6,
    snapDensity: energy * 0.4,
    beatStability,
  }));
}

function profile({
  duration = 128,
  bpm = 120,
  protectedUntil = 0,
  exits = [],
  entries = [],
  candidates = [],
  beatGridTrusted = true,
} = {}) {
  const grid = beatGridTrusted ? Array.from({ length: 8 }, (_, index) => ({ confidence: 0.9, time: index * 2 })) : [];
  return {
    duration,
    bpm,
    gridStep: beatGridTrusted ? 0.5 : 0,
    downbeats: grid,
    bars: bars(duration, 0.5, beatGridTrusted ? 0.9 : 0.1),
    windows: {
      energy: [{ start: 0, end: duration, value: 0.5 }],
      bass: [{ start: 0, end: duration, value: 0.25 }],
    },
    structureMap: {
      protectedUntil,
      exitCandidates: exits,
      entryCandidates: entries,
    },
    candidates,
  };
}

function exit(time, confidence = 0.8, extra = {}) {
  return { type: 'release', role: 'exit', time, confidence, energyBefore: 0.6, energyAfter: 0.35, ...extra };
}

function entry(type, time, extra = {}) {
  return {
    type,
    role: 'entry',
    time,
    confidence: 0.82,
    energyBefore: 0.3,
    energyAfter: 0.55,
    ...extra,
  };
}

test('prefers usable early exit at .44 over similar .94 emergency exit', () => {
  const from = profile({
    duration: 200,
    exits: [
      exit(88, 0.8, { exitRatio: 0.44, latePenalty: 0 }),
      exit(188, 0.8, { exitRatio: 0.94, latePenalty: 0.55 }),
    ],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.exit.time, 88);
});

test('rejects recipe windows whose audible mix start precedes protectedUntil', () => {
  const from = profile({
    protectedUntil: 60,
    exits: [
      exit(60, 0.95, { exitRatio: 0.47, latePenalty: 0 }),
      exit(76, 0.7, { exitRatio: 0.59, latePenalty: 0 }),
    ],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.exit.time, 76);
  assert.equal(result.rejected.some((candidate) => candidate.exit.time === 60 && candidate.rejectionReasons.includes('mix start precedes protected section')), true);
});

test('direct incompatible hook loses to natural intro', () => {
  const from = profile({ duration: 128, bpm: 88, exits: [exit(80)] });
  const to = profile({
    bpm: 128,
    entries: [
      entry('hook', 32, { playFrom: 32, landingAt: 32, landingType: 'hook' }),
      entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' }),
    ],
  });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.landingType, 'intro');
  assert.equal(result.rejected.some((candidate) => candidate.rejectionReasons.includes('direct hook has no compatible runway')), true);
});

test('pre-hook landing reaches its hook handoff within .08 seconds', () => {
  const from = profile({ exits: [exit(80)] });
  const to = profile({ entries: [entry('pre-hook', 20, { playFrom: 20, landingAt: 32, landingType: 'hook' })] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.landingType, 'hook');
  assert.equal(Math.abs(result.chosen.recipeCandidate.window.landingError) <= 0.08, true);
});

test('uses audible overlap rather than silent B preroll as mixStart', () => {
  const from = profile({ exits: [exit(80)] });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.mixStart, result.chosen.exit.time + result.chosen.recipeCandidate.window.audibleStart);
  assert.equal(result.chosen.mixStart > result.chosen.exit.time - result.chosen.recipeCandidate.anchors.lead, true);
});

test('returns an honest start fallback when no anchored window is valid', () => {
  const from = profile({
    protectedUntil: 60,
    exits: [
      exit(80, 0.95, { exitRatio: 0.63, latePenalty: 0 }),
      exit(64, 0.45, { exitRatio: 0.5, latePenalty: 0 }),
    ],
  });
  const to = profile({ entries: [entry('hook', 1, { playFrom: 1, landingAt: 1, landingType: 'hook' })] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.landingType, 'start');
  assert.equal(result.chosen.entry.type, 'start');
  assert.equal(result.chosen.entry.source, 'fallback');
  assert.equal('landingAt' in result.chosen.entry, false);
  assert.equal(result.chosen.exit.time, 64);
  assert.equal(result.chosen.mixStart >= 60, true);
  assert.equal(result.chosen.handoffAt, result.chosen.mixStart + 3.4);
  assert.equal(result.chosen.audibleOverlap >= 3, true);
  assert.equal(result.chosen.recipeCandidate.window.landingError, null);
  assert.equal(result.chosen.rejectionReasons.includes('no valid complete transition window'), true);
});

test('uses .35 conservative groove continuity without a trusted beat grid', () => {
  const from = profile({ exits: [exit(80)], beatGridTrusted: false });
  const to = profile({ entries: [entry('intro', 16)], beatGridTrusted: false });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.grooveContinuity, 0.35);
});

test('latePenalty changes selection between otherwise similar windows', () => {
  const from = profile({
    exits: [
      exit(88, 0.8, { exitRatio: 0.69, latePenalty: 0 }),
      exit(104, 0.81, { exitRatio: 0.81, latePenalty: 0.5 }),
    ],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.exit.time, 88);
});

test('uses cueProfile runtime data while retaining wrapper structure metadata', () => {
  const fromProfile = profile({ duration: 128, bpm: 120 });
  const toProfile = profile({ duration: 128, bpm: 120 });
  const from = {
    duration: 128,
    candidates: [],
    structureMap: { protectedUntil: 0, exitCandidates: [exit(80)] },
    cueProfile: fromProfile,
  };
  const to = {
    duration: 128,
    candidates: [],
    structureMap: { entryCandidates: [entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' })] },
    cueProfile: toProfile,
  };

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.landingType, 'intro');
  assert.notEqual(result.chosen.recipeCandidate.recipe, 'honest-start-fallback');
  assert.equal(result.chosen.tempoCompatibility > 0.9, true);
  assert.equal(result.chosen.grooveContinuity > 0.35, true);
});

test('keeps an early usable exit when late outro candidates exceed the top-eight cap', () => {
  const lateOutros = Array.from({ length: 9 }, (_, index) => exit(116 + index, 0.99, {
    type: 'outro',
    energyBefore: 0.5,
    energyAfter: 0.5,
    exitRatio: 0.9 + index * 0.005,
    latePenalty: 0.55,
  }));
  const from = profile({
    duration: 140,
    exits: [exit(72, 0.7, { exitRatio: 0.51, latePenalty: 0 }), ...lateOutros],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.diagnostics.exitCount, 8);
  assert.equal(result.chosen.exit.time, 72);
});

test('deduplicates same-type landings within 1.5 seconds before the six-option cap', () => {
  const from = profile({ exits: [exit(80)] });
  const to = profile({ entries: [
    entry('intro', 16, { landingAt: 16, landingType: 'intro', confidence: 0.9 }),
    entry('intro', 17.2, { landingAt: 17.2, landingType: 'intro', confidence: 0.8 }),
    entry('hook', 32, { landingAt: 32, landingType: 'hook' }),
  ] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.diagnostics.sourceLandingCount, 3);
  assert.equal(result.diagnostics.consideredLandingCount, 2);
});

test('returns only compact alternatives and rejected windows', () => {
  const sentinel = 'PRIVATE-LYRIC-SENTINEL';
  const from = profile({ exits: [exit(80), exit(96)] });
  const to = profile({
    entries: [
      entry('intro', 16, { text: sentinel, resolvesTo: { text: sentinel } }),
      entry('hook', 32, { playFrom: 32, landingAt: 32, landingType: 'hook', text: sentinel }),
    ],
  });

  const result = chooseTransitionWindow(from, to);
  const alternativeJson = JSON.stringify(result.candidates);
  const rejectedJson = JSON.stringify(result.rejected);

  assert.equal(result.candidates.every((candidate) => !('sectionChoice' in candidate) && !('recipeCandidate' in candidate) && !('timeline' in candidate)), true);
  assert.equal(result.rejected.every((candidate) => !('sectionChoice' in candidate) && !('recipeCandidate' in candidate) && !('timeline' in candidate)), true);
  assert.equal(alternativeJson.includes(sentinel), false);
  assert.equal(rejectedJson.includes(sentinel), false);
  assert.equal(result.candidates.every((candidate) => candidate.score >= 0 && candidate.score <= 1), true);
});

test('sanitizes malformed scores and penalties to finite ranking values', () => {
  const from = profile({ exits: [exit(80, Infinity, { latePenalty: Infinity, exitRatio: NaN, energyBefore: NaN, energyAfter: Infinity })] });
  const to = profile({ entries: [entry('intro', 16, { confidence: Infinity })] });

  const result = chooseTransitionWindow(from, to);
  const ranked = [result.chosen, ...result.candidates, ...result.rejected];

  assert.equal(ranked.every((candidate) => Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1), true);
});

test('treats an infinite late penalty as maximum in cap selection and ranking', () => {
  const from = profile({
    duration: 150,
    exits: [
      exit(80, 0.8, { exitRatio: 0.53, latePenalty: 0 }),
      exit(104, 0.99, { exitRatio: 0.69, latePenalty: Infinity }),
    ],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);
  const ranked = [result.chosen, ...result.candidates, ...result.rejected];

  assert.equal(result.chosen.exit.time, 80);
  assert.equal(ranked.every((candidate) => Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1), true);
});

test('rejects anchored windows without a finite landing diagnostic', () => {
  const { isAnchoredLandingDiagnosticValid } = require('../cuefield/transition-window-planner');

  assert.equal(isAnchoredLandingDiagnosticValid(entry('hook', 32, { landingType: 'hook' }), { landingError: null }), false);
  assert.equal(isAnchoredLandingDiagnosticValid(entry('intro', 16, { landingType: 'intro' }), { landingError: undefined }), false);
  assert.equal(isAnchoredLandingDiagnosticValid(entry('drop', 24, { landingType: 'drop' }), { landingError: NaN }), false);
});

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
  const from = profile({ exits: [exit(80)] });
  const to = profile({ entries: [entry('hook', 1, { playFrom: 1, landingAt: 1, landingType: 'hook' })] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.landingType, 'start');
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

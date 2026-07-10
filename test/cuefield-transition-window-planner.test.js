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
  const hookEvidence = {
    repeatedLineCount: 2,
    repeatedBlockCount: 2,
    energyLift: 0.2,
    sustainedEnergy: true,
  };
  const structureEntries = entries.map((candidate) => {
    const type = String(candidate.landingType || candidate.type || '').toLowerCase();
    if (!['hook', 'chorus'].includes(type) || candidate.type === 'pre-hook') return candidate;
    return { ...candidate, source: candidate.source || 'lyric+beat', evidence: candidate.evidence || hookEvidence };
  });
  structureEntries
    .filter((candidate) => candidate.type === 'pre-hook')
    .forEach((candidate) => {
      const landingAt = candidate.landingAt ?? (candidate.resolvesTo && candidate.resolvesTo.time);
      const hasHook = structureEntries.some((item) => item.type !== 'pre-hook' && Math.abs((item.landingAt ?? item.time) - landingAt) < 1.5);
      if (!hasHook) structureEntries.push(entry('hook', landingAt, {
        source: 'lyric+beat',
        confidence: 0.88,
        playFrom: landingAt,
        landingAt,
        landingType: 'hook',
        evidence: hookEvidence,
      }));
    });
  const hookSections = structureEntries
    .filter((candidate) => candidate.type !== 'pre-hook' && ['hook', 'chorus'].includes(String(candidate.landingType || candidate.type).toLowerCase()))
    .map((candidate) => ({
      type: String(candidate.landingType || candidate.type).toLowerCase(),
      start: candidate.landingAt ?? candidate.time,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    }));
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
      structureSource: hookSections.length ? 'lyric+beat' : 'beat-only',
      protectedUntil,
      exitCandidates: exits,
      entryCandidates: structureEntries,
      sections: hookSections,
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

function setBarMetrics(analysis, time, metrics) {
  const bar = analysis.bars.find((candidate) => candidate.start === time);
  Object.assign(bar, metrics);
  return analysis;
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

test('late contrast rise constrains exits to its late range and uses a short overlap', () => {
  const from = setBarMetrics(profile({
    duration: 200,
    exits: [
      exit(92, 0.99, { exitRatio: 0.46 }),
      exit(160, 0.62, { exitRatio: 0.8 }),
    ],
  }), 92, { energy: 0.36, snapDensity: 0.16 });
  const to = setBarMetrics(profile({
    entries: [
      entry('hook', 32, { playFrom: 32, landingAt: 32, landingType: 'hook' }),
      entry('intro', 12, { playFrom: 0, landingAt: 12, landingType: 'intro' }),
    ],
  }), 12, { energy: 0.82, snapDensity: 0.58 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'late-contrast-rise');
  assert.equal(result.chosen.policy.route, 'late-contrast-rise');
  assert.equal(result.chosen.exitRatio >= 0.75 && result.chosen.exitRatio <= 0.9, true);
  assert.equal(result.chosen.audibleOverlap <= 3.5, true);
  assert.notEqual(result.chosen.entry.type, 'hook');
});

test('structure mix retains an early usable post-hook exit', () => {
  const from = profile({
    duration: 200,
    exits: [exit(88, 0.9, { exitRatio: 0.44 }), exit(164, 0.5, { exitRatio: 0.82 })],
  });
  const to = profile({ entries: [entry('intro', 16)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'structure-mix');
  assert.equal(result.chosen.exitRatio < 0.75, true);
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

test('terminal rescue returns an executable late timeline when structural windows are unavailable', () => {
  const from = profile({
    duration: 128,
    protectedUntil: 60,
  });
  const to = profile();

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.entry.landingType, 'start');
  assert.equal(result.chosen.entry.type, 'start');
  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.chosen.routeFallbackUsed, true);
  assert.equal(result.chosen.exitRatio >= 0.88 && result.chosen.exitRatio <= 0.96, true);
  assert.equal(result.chosen.mixStart < result.chosen.handoffAt, true);
  assert.equal(result.chosen.handoffAt <= from.duration, true);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'handoff'), true);
  assert.equal(result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'play').at, 0);
});

test('terminal rescue respects a very late protected section without negative timing or ending after A', () => {
  const from = profile({ duration: 12, protectedUntil: 10.5 });
  const to = profile({ duration: 24 });

  const result = chooseTransitionWindow(from, to);
  const timeline = result.chosen.timeline;

  assert.equal(result.chosen.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.mixStart >= 10.5, true);
  assert.equal(result.chosen.handoffAt <= 12, true);
  assert.equal(result.chosen.mixStart < result.chosen.handoffAt, true);
  assert.equal(timeline.every((action) => action.t >= 0), true);
  assert.equal(timeline.find((action) => action.deck === 'B' && action.op === 'play').at, 0);
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

  assert.equal(result.diagnostics.exitCount, 1);
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

test('does not promote a raw single-line lyric candidate to a Hook landing', () => {
  const from = profile({ exits: [exit(80)] });
  const fallback = entry('start', 0, {
    source: 'fallback',
    confidence: 0.35,
    playFrom: 0,
    landingAt: 0,
    landingType: 'start',
  });
  const rawHook = entry('hook', 32, {
    source: 'lyric',
    confidence: 0.78,
    text: 'single repeated line',
    playFrom: 32,
    landingAt: 32,
    landingType: 'hook',
  });
  const to = profile({ candidates: [rawHook] });
  to.structureMap = {
    structureSource: 'lyric+beat',
    sections: [{ type: 'hook-candidate', start: 32, confidence: 0.5 }],
    entryCandidates: [fallback],
  };

  const result = chooseTransitionWindow(from, to);

  assert.notEqual(result.chosen.entry.landingType, 'hook');
  assert.equal(result.candidates.some((candidate) => candidate.entry.landingType === 'hook'), false);
  assert.equal(result.rejected.some((candidate) => candidate.entry.landingType === 'hook'), false);
});

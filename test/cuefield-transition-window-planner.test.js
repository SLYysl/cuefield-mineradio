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
  track = {},
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
    track,
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

function musicalProfile(root, extra = {}) {
  return {
    confidence: 0.9,
    noteCount: 64,
    pitchClassProfile: Array.from({ length: 12 }, (_, index) => index === root ? 1 : 0),
    intervalProfile: Array.from({ length: 25 }, (_, index) => index === 14 ? 1 : 0),
    key: { root, mode: 'major' },
    ...extra,
  };
}

function musicalWindow(start, root, extra = {}) {
  return {
    ...musicalProfile(root),
    start,
    duration: 8,
    ...extra,
  };
}

function impactWindowFixture() {
  const hookEvidence = {
    repeatedLineCount: 2,
    repeatedBlockCount: 2,
    energyLift: 0.2,
    sustainedEnergy: true,
  };
  const from = profile({
    duration: 128,
    exits: [exit(96, 0.92, {
      text: 'Help me to break through',
      energyBefore: 0.6,
      energyAfter: 0.543,
      lowDensity: 0.543,
    })],
  });
  const to = profile({
    duration: 120,
    entries: [entry('hook', 32, {
      source: 'lyric+beat',
      confidence: 0.92,
      text: 'Take me to...',
      playFrom: 32,
      landingAt: 32,
      landingType: 'hook',
      resolvesTo: { type: 'chorus', time: 32, text: 'the moon where we both fell in love...' },
      energyBefore: 0.3,
      energyAfter: 0.538,
      lowDensity: 0.538,
      evidence: hookEvidence,
    })],
  });
  from.musicalProfile = musicalProfile(0);
  to.musicalProfile = musicalProfile(0);
  return { from, to };
}

function validRecipes(plan) {
  return [plan.chosen, ...plan.candidates]
    .map((candidate) => candidate.recipeCandidate && candidate.recipeCandidate.recipe || candidate.recipe)
    .filter(Boolean);
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

test('rejects a transition whose audible A-B window interrupts an outgoing lyric', () => {
  const from = profile({
    duration: 128,
    exits: [
      exit(80, 0.92, { exitRatio: 0.625, latePenalty: 0 }),
      exit(112, 0.8, { exitRatio: 0.875, latePenalty: 0.2 }),
    ],
  });
  from.structureMap.structureSource = 'lyric+beat';
  from.structureMap.vocalWindows = [{ start: 75, end: 81 }];
  const to = profile({ entries: [entry('intro', 16, { source: 'energy' })] });

  const result = chooseTransitionWindow(from, to);

  assert.notEqual(result.chosen.exit.time, 80);
  assert.equal(result.rejected.some((item) => item.exit.time === 80
    && item.rejectionReasons.includes('outgoing vocal phrase incomplete')), true);
});

test('requires a release before mixing musically incompatible tracks', () => {
  const from = profile({
    duration: 128,
    exits: [
      exit(80, 0.94, { type: 'phrase-boundary', exitRatio: 0.625, latePenalty: 0 }),
      exit(96, 0.82, { type: 'release', exitRatio: 0.75, latePenalty: 0.1 }),
    ],
  });
  const to = profile({ entries: [entry('intro', 16, { source: 'energy' })] });
  from.musicalProfile = musicalProfile(0);
  to.musicalProfile = musicalProfile(6);

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.exit.type, 'release');
  assert.equal(result.rejected.some((item) => item.exit.time === 80
    && item.rejectionReasons.includes('musical mismatch needs release exit')), true);
});

test('holds a musically incompatible release until the late part of A', () => {
  const from = profile({
    duration: 160,
    exits: [exit(64, 0.92, { type: 'release', exitRatio: 0.4, latePenalty: 0 })],
  });
  const to = profile({ entries: [entry('intro', 16, { source: 'energy' })] });
  from.musicalProfile = musicalProfile(0);
  to.musicalProfile = musicalProfile(6);

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.exitRatio >= 0.88, true);
  assert.equal(result.rejected.some((item) => item.exit.time === 64
    && item.rejectionReasons.includes('musical mismatch needs late release')), true);
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
  assert.equal(['filtered-pickup', 'echo-out', 'quick-safe-fade'].includes(result.chosen.recipeCandidate.recipe), true);
});

test('late contrast rise with only an early exit escalates to terminal rescue', () => {
  const from = setBarMetrics(profile({
    duration: 200,
    exits: [exit(92, 0.99, { exitRatio: 0.46 })],
  }), 92, { energy: 0.36, snapDensity: 0.16 });
  const to = setBarMetrics(profile({
    entries: [entry('intro', 12, { playFrom: 0, landingAt: 12, landingType: 'intro' })],
  }), 12, { energy: 0.82, snapDensity: 0.58 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.diagnostics.consideredExitCount, 0);
  assert.equal(result.chosen.exitRatio >= 0.88 && result.chosen.exitRatio <= 0.96, true);
});

test('late contrast release filters a high-scoring long recipe from window ranking', () => {
  const from = setBarMetrics(profile({
    duration: 200,
    exits: [exit(160, 0.84, { exitRatio: 0.8 })],
  }), 160, { energy: 0.86, snapDensity: 0.64 });
  const intro = entry('intro', 1.4, {
    source: 'energy',
    confidence: 0.55,
    playFrom: 0,
    landingAt: 1.4,
    landingType: 'intro',
  });
  const to = setBarMetrics(profile({
    entries: [entry('drop', 12, {
      source: 'energy',
      confidence: 0.95,
      playFrom: 0,
      landingAt: 12,
      landingType: 'drop',
    })],
    candidates: [intro],
  }), 12, { energy: 0.34, snapDensity: 0.16 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'late-contrast-release');
  assert.notEqual(result.chosen.recipeCandidate.recipe, 'intro-outro-long-blend');
  assert.equal(result.chosen.audibleOverlap <= 6, true);
});

test('relationship style risk routes directly to terminal rescue without structural recipes', () => {
  const from = profile({
    duration: 200,
    bpm: 100,
    track: { artist: 'Avicii', title: 'Wake Me Up' },
    exits: [exit(160, 0.84, { exitRatio: 0.8 })],
  });
  const to = profile({
    duration: 120,
    bpm: 140,
    track: { artist: 'ACDC', title: 'Highway to Hell' },
    entries: [entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' })],
  });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.diagnostics.recipeCandidatesConsidered, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.rejected, []);
});

test('relationship directionality risk alone keeps the structure route available', () => {
  const from = profile({ exits: [exit(80, 0.84, { energyAfter: 0.35 })] });
  const to = profile({
    entries: [entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro', energyAfter: 0.8 })],
  });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'structure-mix');
  assert.notEqual(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
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
  assert.equal(result.chosen.rescueClass, 'C');
  assert.equal(result.chosen.recipeCandidate.variant, 'limited-window-crossfade');
  assert.equal(result.chosen.timeline.some((action) => action.op === 'echo'), false);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'bass'), false);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'filter'), false);
  assert.equal(Array.isArray(result.chosen.recipeCandidate.fallbackTimeline), true);
  assert.equal(result.chosen.recipeCandidate.fallbackTimeline.some((action) => action.op === 'echo'), false);
  const aFade = result.chosen.timeline.find((action) => action.deck === 'A' && action.op === 'volume');
  const bFade = result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'volume');
  assert.equal(aFade.t, 0);
  assert.equal(aFade.duration, 3400);
  assert.equal(bFade.t, 0);
  assert.equal(bFade.duration >= 1800, true);
  assert.equal(result.chosen.audibleOverlap >= 1.8, true);
  assert.equal(result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'play').at, 0);
});

test('terminal rescue class A clears outgoing vocals before B becomes audible', () => {
  const from = profile({ duration: 128, exits: [] });
  from.structureMap.structureSource = 'lyric+beat';
  from.structureMap.vocalWindows = [{ start: 118, end: 127.5 }];
  const to = profile({ duration: 96, entries: [entry('intro', 8, { source: 'energy' })] });

  const result = chooseTransitionWindow(from, to);
  const aFade = result.chosen.timeline.find((action) => action.deck === 'A' && action.op === 'volume');
  const bFade = result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'volume');

  assert.equal(result.chosen.rescueClass, 'A');
  assert.equal(result.chosen.recipeCandidate.variant, 'vocal-release');
  assert.equal(aFade.duration >= 1200 && aFade.duration <= 1500, true);
  assert.equal(bFade.t >= 0.6, true);
  assert.equal(result.chosen.audibleOverlap >= 0.45, true);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'echo'), false);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'filter'), false);
});

test('terminal rescue class B stages an energy contrast instead of cutting both drums at once', () => {
  const from = setBarMetrics(profile({
    duration: 200,
    exits: [exit(92, 0.99, { exitRatio: 0.46 })],
  }), 92, { energy: 0.36, snapDensity: 0.16 });
  const to = setBarMetrics(profile({
    entries: [entry('intro', 12, { playFrom: 0, landingAt: 12, landingType: 'intro' })],
  }), 12, { energy: 0.82, snapDensity: 0.58 });

  const result = chooseTransitionWindow(from, to);
  const bFilters = result.chosen.timeline.filter((action) => action.deck === 'B' && action.op === 'filter');
  const bBass = result.chosen.timeline.filter((action) => action.deck === 'B' && action.op === 'bass');
  const aBass = result.chosen.timeline.find((action) => action.deck === 'A' && action.op === 'bass');

  assert.equal(result.chosen.rescueClass, 'B');
  assert.equal(result.chosen.recipeCandidate.variant, 'staged-energy-bridge');
  assert.equal(bFilters.length >= 3, true);
  assert.equal(bBass.length >= 3, true);
  assert.equal(bFilters[0].value <= 900, true);
  assert.equal(bBass[0].value >= 0.2, true);
  assert.equal(Math.abs(bFilters.at(-1).t + bFilters.at(-1).duration / 1000 - (result.chosen.handoffAt - result.chosen.mixStart)) <= 0.001, true);
  assert.equal(Math.abs(bBass.at(-1).t + bBass.at(-1).duration / 1000 - (result.chosen.handoffAt - result.chosen.mixStart)) <= 0.001, true);
  assert.equal(aBass.value >= 0.7, true);
  assert.equal(result.chosen.timeline.some((action) => action.op === 'echo'), false);
});

test('terminal rescue class C beds B under the last vocal before fading A', () => {
  const from = profile({ duration: 128, exits: [] });
  from.structureMap.structureSource = 'lyric+beat';
  from.structureMap.vocalWindows = [{ start: 116, end: 121 }];
  const to = profile({ duration: 96, entries: [entry('intro', 8, { source: 'energy' })] });

  const result = chooseTransitionWindow(from, to);
  const aFade = result.chosen.timeline.find((action) => action.deck === 'A' && action.op === 'volume');
  const bFade = result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'volume');

  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.chosen.rescueClass, 'C');
  assert.equal(result.chosen.mixStart < 121, true);
  assert.equal(aFade.t >= 121 - result.chosen.mixStart, true);
  assert.equal(bFade.t, 0);
  assert.equal(result.chosen.handoffAt - result.chosen.mixStart > 3.4, true);
  assert.equal(result.chosen.handoffAt <= 128, true);
});

test('terminal rescue caps class C at the effective end before a zero-energy file tail', () => {
  const from = profile({
    duration: 245.705,
    exits: [exit(235.23, 0.58, { exitRatio: 0.957 })],
  });
  from.windows.energy = [
    { start: 0, end: 240, value: 0.55 },
    { start: 240, end: 245.705, value: 0 },
  ];
  from.structureMap.structureSource = 'lyric+beat';
  from.structureMap.vocalWindows = [{ start: 234.551, end: 239.051 }];
  const to = profile({ duration: 180 });

  const result = chooseTransitionWindow(from, to);
  const aFade = result.chosen.timeline.find((action) => action.deck === 'A' && action.op === 'volume');

  assert.equal(result.chosen.rescueClass, 'C');
  assert.equal(result.chosen.effectiveSourceEnd, 240);
  assert.equal(result.chosen.mixStart, 235.23);
  assert.equal(result.chosen.handoffAt <= 240, true);
  assert.equal(aFade.t >= 3.8, true);
});

test('terminal rescue keeps metadata duration when the final energy window is not silent', () => {
  const from = profile({ duration: 128 });
  from.windows.energy = [
    { start: 0, end: 120, value: 0.5 },
    { start: 120, end: 128, value: 0.02 },
  ];

  const result = chooseTransitionWindow(from, profile({ duration: 96 }));

  assert.equal(result.chosen.effectiveSourceEnd, 128);
});

test('terminal rescue millisecond rounding never starts before protection or hands off after source end', () => {
  const from = profile({
    duration: 46.66404849117999,
    protectedUntil: 43.37641786050503,
  });

  const result = chooseTransitionWindow(from, profile({ duration: 96 }));

  assert.equal(result.chosen.technicalFailure, undefined);
  assert.equal(result.chosen.mixStart >= from.structureMap.protectedUntil, true);
  assert.equal(result.chosen.handoffAt <= from.duration, true);
});

test('terminal rescue prerolls a trusted hook and reaches full volume on its landing', () => {
  const from = profile({ duration: 128, bpm: 122, exits: [exit(80)] });
  const to = profile({
    duration: 96,
    bpm: 81,
    entries: [entry('hook', 20, { playFrom: 20, landingAt: 20, landingType: 'hook', confidence: 0.88 })],
  });

  const result = chooseTransitionWindow(from, to);
  const play = result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const rise = result.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'volume');
  const landingOffset = result.chosen.entry.landingAt - play.at;

  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.chosen.entry.landingType, 'hook');
  assert.equal(play.at < result.chosen.entry.landingAt, true);
  assert.equal(Math.abs(rise.t + rise.duration / 1000 - landingOffset) <= 0.01, true);
  assert.equal(result.chosen.preRollDuration > rise.t && result.chosen.preRollDuration < landingOffset, true);
});

test('terminal rescue caps a valid late exit to a short executable overlap', () => {
  const from = profile({ duration: 200, exits: [exit(180, 0.82, { exitRatio: 0.9 })] });
  const to = profile({ duration: 120 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.mixStart, 180);
  assert.equal(result.chosen.exit.time, result.chosen.mixStart);
  assert.equal(result.chosen.mixStart >= from.structureMap.protectedUntil, true);
  assert.equal(result.chosen.audibleOverlap >= 1.8, true);
  assert.equal(result.chosen.handoffAt <= from.duration, true);
  const handoffSpan = result.chosen.handoffAt - result.chosen.mixStart;
  assert.equal(result.chosen.timeline.every((action) => action.t + Number(action.duration || 0) / 1000 <= handoffSpan + 0.001), true);
});

test('returns a non-executable technical result when protection leaves less than 2.2 seconds', () => {
  const from = profile({ duration: 12, protectedUntil: 11.9 });
  const to = profile({ duration: 24 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INSUFFICIENT_POST_PROTECTION_RUNWAY');
  assert.deepEqual(result.chosen.timeline, []);
  assert.equal(result.chosen.recipeCandidate.recipe, 'technical-failure');
});

test('returns a non-executable technical result when protection leaves no post-protection runway', () => {
  const from = profile({ duration: 12, protectedUntil: 12 });
  const to = profile({ duration: 24 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INSUFFICIENT_POST_PROTECTION_RUNWAY');
  assert.deepEqual(result.chosen.timeline, []);
});

test('returns a non-executable technical result for an invalid source duration', () => {
  const result = chooseTransitionWindow(profile({ duration: 0 }), profile({ duration: 24 }));

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INVALID_DURATION');
  assert.deepEqual(result.chosen.timeline, []);
  assert.equal(result.chosen.handoffAt, null);
});

test('returns a non-executable technical result for an invalid target duration', () => {
  const result = chooseTransitionWindow(profile({ duration: 128 }), profile({ duration: 0 }));

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INVALID_TARGET_DURATION');
  assert.deepEqual(result.chosen.timeline, []);
  assert.equal(result.chosen.handoffAt, null);
});

test('returns a technical result when the target is shorter than the minimum rescue runway', () => {
  const result = chooseTransitionWindow(profile({ duration: 128 }), profile({ duration: 1 }));

  assert.equal(result.chosen.technicalFailure, true);
  assert.equal(result.chosen.errorCode, 'TERMINAL_RESCUE_INSUFFICIENT_TARGET_RUNWAY');
  assert.deepEqual(result.chosen.timeline, []);
});

test('caps terminal rescue overlap to the playable target duration', () => {
  const result = chooseTransitionWindow(profile({ duration: 128 }), profile({ duration: 2.5 }));

  assert.equal(result.chosen.technicalFailure, undefined);
  assert.equal(result.chosen.audibleOverlap >= 1.2, true);
  assert.equal(result.chosen.entry.landingAt >= 1.5, true);
  assert.equal(result.chosen.handoffAt - result.chosen.mixStart, 2.5);
  assert.equal(result.chosen.timeline.every((action) => action.t + Number(action.duration || 0) / 1000 <= 2.5), true);
});

test('terminal rescue executes an exact 2.2-second post-protection runway', () => {
  const from = profile({ duration: 12, protectedUntil: 9.8 });
  const to = profile({ duration: 24 });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.mixStart, 9.8);
  assert.equal(result.chosen.mixStart < result.chosen.handoffAt, true);
  assert.equal(result.chosen.handoffAt <= 12, true);
  assert.equal(result.chosen.audibleOverlap >= 1.1, true);
  const handoffSpan = result.chosen.handoffAt - result.chosen.mixStart;
  assert.equal(result.chosen.timeline.every((action) => action.t + Number(action.duration || 0) / 1000 <= handoffSpan + 0.001), true);
});

test('rejects every structural candidate whose handoff would exceed A duration before rescuing', () => {
  const from = profile({ duration: 128, exits: [exit(127.5)] });
  const to = profile({ entries: [entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' })] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.policy.route, 'terminal-rescue');
  assert.equal(result.chosen.recipeCandidate.recipe, 'terminal-rescue');
  assert.equal(result.rejected.length > 0, true);
  assert.equal(result.rejected.every((candidate) => candidate.rejectionReasons.includes('handoff exceeds source duration')), true);
});

test('uses .35 conservative groove continuity without a trusted beat grid', () => {
  const from = profile({ exits: [exit(80)], beatGridTrusted: false });
  const to = profile({ entries: [entry('intro', 16)], beatGridTrusted: false });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.grooveContinuity, 0.35);
  assert.equal(['intro-outro-long-blend', 'bass-eq-handoff'].includes(result.chosen.recipeCandidate.recipe), false);
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

test('prefers a locally compatible entry over an otherwise equivalent incompatible entry', () => {
  const from = profile({ exits: [exit(80)] });
  const to = profile({ entries: [
    entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' }),
    entry('drop', 32, { playFrom: 32, landingAt: 32, landingType: 'drop' }),
  ] });
  from.musicalProfile = musicalProfile(0, { windows: [musicalWindow(80, 0)] });
  to.musicalProfile = musicalProfile(0, {
    windows: [musicalWindow(0, 0), musicalWindow(32, 6)],
  });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.chosen.entry.playFrom, 0);
  assert.equal(result.chosen.localMusicalEvidence.score > 0.9, true);
  assert.equal(result.candidates.some((candidate) => candidate.entry.landingAt === 32
    && candidate.localMusicalEvidence.score < 0.42), true);
});

test('local musical clash rejects long overlap while retaining an executable short transition', () => {
  const from = profile({ duration: 160, exits: [exit(112, 0.92)] });
  const to = profile({ entries: [entry('intro', 16, { source: 'energy', playFrom: 0, landingAt: 16, landingType: 'intro' })] });
  from.musicalProfile = musicalProfile(0, { windows: [musicalWindow(112, 0)] });
  to.musicalProfile = musicalProfile(0, { windows: [musicalWindow(0, 6)] });

  const result = chooseTransitionWindow(from, to);

  assert.equal(result.rejected.some((candidate) => candidate.audibleOverlap > 3.5
    && candidate.rejectionReasons.includes('local musical clash needs short overlap')), true);
  assert.notEqual(result.chosen.technicalFailure, true);
  assert.equal(Array.isArray(result.chosen.timeline) && result.chosen.timeline.some((action) => action.op === 'handoff'), true);
  assert.equal(Number.isFinite(result.chosen.audibleOverlap) && result.chosen.audibleOverlap <= 3.5, true);
  assert.equal(result.chosen.localMusicalEvidence.score < 0.42, true);
});

test('local musical clash rejects a short harmonic double drop and removes it from valid candidates', () => {
  const from = profile({
    duration: 128,
    exits: [exit(112, 0.92, { energyAfter: 0.55, text: 'help me break through' })],
  });
  const to = profile({
    entries: [entry('hook', 32, {
      source: 'lyric+beat',
      confidence: 0.92,
      text: 'take me through the night',
      playFrom: 32,
      landingAt: 32,
      landingType: 'hook',
    })],
  });
  from.musicalProfile = musicalProfile(0, { windows: [musicalWindow(112, 0)] });
  to.musicalProfile = musicalProfile(0, { windows: [musicalWindow(32, 6)] });

  const result = chooseTransitionWindow(from, to);

  assert.notEqual(result.chosen.recipeCandidate.recipe, 'harmonic-double-drop');
  assert.equal(result.candidates.some((candidate) => candidate.recipe === 'harmonic-double-drop'), false);
  assert.equal(result.rejected.some((candidate) => candidate.recipe === 'harmonic-double-drop'
    && candidate.rejectionReasons.includes('local musical clash forbids harmonic double drop')), true);
});

test('missing, weak, and distant local windows leave local musical scoring neutral', () => {
  const scenarios = [
    { fromWindows: [], toWindows: [] },
    { fromWindows: [musicalWindow(80, 0, { confidence: 0.54 })], toWindows: [musicalWindow(0, 0)] },
    { fromWindows: [musicalWindow(20, 0)], toWindows: [musicalWindow(80, 0)] },
  ];

  scenarios.forEach(({ fromWindows, toWindows }) => {
    const from = profile({ exits: [exit(80)] });
    const to = profile({ entries: [entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' })] });
    from.musicalProfile = musicalProfile(0, { windows: fromWindows });
    to.musicalProfile = musicalProfile(0, { windows: toWindows });

    const result = chooseTransitionWindow(from, to);

    assert.equal(result.chosen.localMusicalEvidence, null);
  });
});

test('compact transition windows expose local diagnostics without raw musical profile arrays', () => {
  const from = profile({ exits: [exit(80), exit(96)] });
  const to = profile({ entries: [
    entry('intro', 16, { playFrom: 0, landingAt: 16, landingType: 'intro' }),
    entry('drop', 32, { playFrom: 32, landingAt: 32, landingType: 'drop' }),
  ] });
  from.musicalProfile = musicalProfile(0, { windows: [musicalWindow(80, 0), musicalWindow(96, 0)] });
  to.musicalProfile = musicalProfile(0, { windows: [musicalWindow(0, 0), musicalWindow(32, 6)] });

  const result = chooseTransitionWindow(from, to);
  const compact = [...result.candidates, ...result.rejected];
  const compactJson = JSON.stringify(compact);

  assert.equal(compact.length > 0, true);
  assert.equal(compact.every((candidate) => candidate.localMusicalEvidence
    && Number.isFinite(candidate.localMusicalEvidence.score)), true);
  assert.equal(compactJson.includes('pitchClassProfile'), false);
  assert.equal(compactJson.includes('intervalProfile'), false);
  assert.equal(compactJson.includes('melodyContour'), false);
});

test('blocks the composite impact recipe only when its identifier is in recent history', () => {
  const { from, to } = impactWindowFixture();

  const open = chooseTransitionWindow(from, to, { recentRecipes: [] });
  const blocked = chooseTransitionWindow(from, to, { recentRecipes: ['tease-roll-double-drop'] });
  const unrelated = chooseTransitionWindow(from, to, { recentRecipes: ['quick-safe-fade'] });

  assert.equal(open.chosen.recipeCandidate.recipe, 'tease-roll-double-drop');
  assert.equal(validRecipes(open).includes('tease-roll-double-drop'), true);
  assert.equal(validRecipes(blocked).includes('tease-roll-double-drop'), false);
  assert.notEqual(blocked.chosen.recipeCandidate.recipe, 'tease-roll-double-drop');
  assert.equal(validRecipes(unrelated).includes('tease-roll-double-drop'), true);
});

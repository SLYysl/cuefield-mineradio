const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyTransitionRoute } = require('../cuefield/transition-router');

function profile(duration, bpm = 120, bars = []) {
  return {
    duration,
    bpm,
    bars,
  };
}

test('routes a large snap rise into a late controlled build', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.27, energy: 0.72 }]),
    toProfile: profile(220, 88, [{ start: 106, snapDensity: 0.53, energy: 0.58 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'hook', confidence: 0.88 }],
    risks: [],
  });

  assert.equal(policy.route, 'late-contrast-rise');
  assert.deepEqual(policy.preferredExitRange, [0.75, 0.9]);
  assert.equal(policy.overlapClass, 'short');
});

test('keeps a late rise range at or after a ninety-five percent protection boundary', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.27, energy: 0.72 }]),
    toProfile: profile(220, 88, [{ start: 106, snapDensity: 0.53, energy: 0.58 }]),
    protectedUntil: 190,
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'hook', confidence: 0.88 }],
    risks: [],
  });

  assert.equal(policy.route, 'late-contrast-rise');
  assert.deepEqual(policy.preferredExitRange, [0.95, 0.95]);
});

test('does not route late from directionality mismatch alone', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 115, [{ start: 73, snapDensity: 0.38, energy: 0.61 }]),
    toProfile: profile(212, 100, [{ start: 31, snapDensity: 0.28, energy: 0.72 }]),
    exits: [{ time: 73, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 31, landingType: 'hook', confidence: 0.88 }],
    risks: ['directionality mismatch'],
  });

  assert.equal(policy.route, 'structure-mix');
  assert.equal(policy.metrics.directionalityMismatch, 1);
  assert.ok(policy.reasons.includes('directionality-mismatch'));
});

test('routes a large snap release into a late energy release', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 128, [{ start: 150, snapDensity: 0.55, energy: 0.82 }]),
    toProfile: profile(230, 96, [{ start: 18, snapDensity: 0.22, energy: 0.48 }]),
    exits: [{ time: 150, type: 'release', confidence: 0.76 }],
    entries: [{ landingAt: 18, landingType: 'intro', confidence: 0.8 }],
    risks: [],
  });

  assert.equal(policy.route, 'late-contrast-release');
  assert.deepEqual(policy.preferredExitRange, [0.72, 0.9]);
});

test('routes missing structural evidence into terminal rescue', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(180),
    toProfile: profile(210),
    exits: [],
    entries: [],
  });

  assert.equal(policy.route, 'terminal-rescue');
  assert.deepEqual(policy.preferredExitRange, [0.88, 0.96]);
});

test('routes unusable bars into terminal rescue instead of treating metrics as zero', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(180, 100, [{ start: 'bad', snapDensity: 0.2, energy: 0.2 }]),
    toProfile: profile(210, 104, [{ start: 20, snapDensity: 0.7, energy: 0.7 }]),
    exits: [{ time: 10, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 20, landingType: 'intro', confidence: 0.8 }],
  });

  assert.equal(policy.route, 'terminal-rescue');
});

test('routes non-positive durations into terminal rescue', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(0, 100, [{ start: 10, snapDensity: 0.2, energy: 0.2 }]),
    toProfile: profile(210, 104, [{ start: 20, snapDensity: 0.7, energy: 0.7 }]),
    exits: [{ time: 10, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 20, landingType: 'intro', confidence: 0.8 }],
  });

  assert.equal(policy.route, 'terminal-rescue');
});

test('selects supported release and non-fallback entry from unordered candidates', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [
      { start: 10, snapDensity: 0.3, energy: 0.5 },
      { start: 150, snapDensity: 0.27, energy: 0.5 },
    ]),
    toProfile: profile(220, 88, [
      { start: 5, snapDensity: 0.3, energy: 0.5 },
      { start: 100, snapDensity: 0.53, energy: 0.5 },
    ]),
    exits: [
      { time: 10, type: 'fallback', confidence: 0.99 },
      { time: 150, type: 'release', confidence: 0.7, latePenalty: 0.1 },
    ],
    entries: [
      { landingAt: Number.NaN, landingType: 'fallback', confidence: 1 },
      { landingAt: 100, landingType: 'intro', confidence: 0.8 },
    ],
    risks: [],
  });

  assert.equal(policy.route, 'late-contrast-rise');
});

test('uses energy and tempo as secondary rise evidence', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.3, energy: 0.2 }]),
    toProfile: profile(220, 112, [{ start: 106, snapDensity: 0.34, energy: 0.5 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'intro', confidence: 0.8 }],
    risks: ['directionality mismatch'],
  });

  assert.equal(policy.route, 'late-contrast-rise');
});

test('uses energy and tempo as secondary release evidence', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 112, [{ start: 150, snapDensity: 0.3, energy: 0.8 }]),
    toProfile: profile(220, 100, [{ start: 18, snapDensity: 0.26, energy: 0.5 }]),
    exits: [{ time: 150, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 18, landingType: 'intro', confidence: 0.8 }],
    risks: [],
  });

  assert.equal(policy.route, 'late-contrast-release');
});

test('routes style bridge mismatch with severe tempo contrast to terminal rescue', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.3, energy: 0.2 }]),
    toProfile: profile(220, 140, [{ start: 106, snapDensity: 0.34, energy: 0.5 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'intro', confidence: 0.8 }],
    risks: ['style bridge mismatch'],
  });

  assert.equal(policy.route, 'terminal-rescue');
});

test('routes invalid bpm to terminal rescue with a finite common metrics shape', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 0, [{ start: 70, snapDensity: 0.27, energy: 0.72 }]),
    toProfile: profile(220, 88, [{ start: 106, snapDensity: 0.53, energy: 0.58 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'hook', confidence: 0.88 }],
    risks: [],
  });

  assert.equal(policy.route, 'terminal-rescue');
  assert.deepEqual(Object.keys(policy.metrics).sort(), [
    'directionalityMismatch',
    'energyDelta',
    'fromSnap',
    'snapDelta',
    'tempoDelta',
    'tempoKnown',
    'toSnap',
  ]);
  assert.equal(policy.metrics.tempoKnown, 0);
  assert.equal(policy.metrics.tempoDelta, 1);
  for (const value of Object.values(policy.metrics)) assert.equal(Number.isFinite(value), true);
});

test('protects the structure mix exit from the supplied boundary', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 80, snapDensity: 0.3, energy: 0.5 }]),
    toProfile: profile(212, 104, [{ start: 20, snapDensity: 0.31, energy: 0.5 }]),
    protectedUntil: 80,
    exits: [{ time: 80, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 20, landingType: 'intro', confidence: 0.8 }],
    risks: [],
  });

  assert.equal(policy.route, 'structure-mix');
  assert.deepEqual(policy.preferredExitRange, [0.4, 0.78]);
});

test('does not lower a structure mix range below a late protected boundary', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 180, snapDensity: 0.3, energy: 0.5 }]),
    toProfile: profile(212, 104, [{ start: 20, snapDensity: 0.31, energy: 0.5 }]),
    protectedUntil: 180,
    exits: [{ time: 180, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 20, landingType: 'intro', confidence: 0.8 }],
    risks: [],
  });

  assert.deepEqual(policy.preferredExitRange, [0.9, 0.9]);
});

test('returns a compact policy with finite metrics', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 100, [{ start: 70, snapDensity: 0.27, energy: 0.72 }]),
    toProfile: profile(220, 88, [{ start: 106, snapDensity: 0.53, energy: 0.58 }]),
    exits: [{ time: 70, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 106, landingType: 'hook', confidence: 0.88 }],
    risks: ['directionality mismatch'],
  });

  assert.deepEqual(Object.keys(policy).sort(), [
    'compatibilityClass',
    'contrastDirection',
    'entryPolicy',
    'metrics',
    'overlapClass',
    'preferredExitRange',
    'reasons',
    'recipe',
    'route',
  ]);
  assert.deepEqual(Object.keys(policy.metrics).sort(), [
    'directionalityMismatch',
    'energyDelta',
    'fromSnap',
    'snapDelta',
    'tempoDelta',
    'tempoKnown',
    'toSnap',
  ]);
  for (const value of Object.values(policy.metrics)) assert.equal(Number.isFinite(value), true);
  assert.ok(policy.reasons.length <= 4);
});

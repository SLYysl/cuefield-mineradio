const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyTransitionRoute } = require('../cuefield/transition-router');

function profile(duration, tempo = 120, bars = []) {
  return {
    duration,
    tempo,
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

test('does not route late from directionality mismatch alone', () => {
  const policy = classifyTransitionRoute({
    fromProfile: profile(200, 115, [{ start: 73, snapDensity: 0.38, energy: 0.61 }]),
    toProfile: profile(212, 100, [{ start: 31, snapDensity: 0.28, energy: 0.72 }]),
    exits: [{ time: 73, type: 'release', confidence: 0.7 }],
    entries: [{ landingAt: 31, landingType: 'hook', confidence: 0.88 }],
    risks: ['directionality mismatch'],
  });

  assert.equal(policy.route, 'structure-mix');
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
  assert.ok(Object.keys(policy.metrics).length <= 6);
  for (const value of Object.values(policy.metrics)) assert.equal(Number.isFinite(value), true);
  assert.ok(policy.reasons.length <= 4);
});

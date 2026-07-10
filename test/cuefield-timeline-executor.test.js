const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCuefieldTimelineExecution,
  buildEqualPowerCurve,
  buildVolumeOnlyCuefieldExecution,
  shouldReleaseCuefieldDeckGraph,
} = require('../public/cuefield-timeline-executor');

test('builds complementary equal-power curves', () => {
  assert.equal(typeof buildEqualPowerCurve, 'function');
  const incoming = buildEqualPowerCurve('in', 9);
  const outgoing = buildEqualPowerCurve('out', 9);

  assert.equal(incoming[0], 0);
  assert.equal(incoming.at(-1), 1);
  assert.equal(outgoing[0], 1);
  assert.equal(outgoing.at(-1), 0);
  assert.equal(Math.abs((incoming[4] ** 2 + outgoing[4] ** 2) - 1) < 0.02, true);
});

test('builds delayed execution actions from a Cuefield recipe timeline', () => {
  const execution = buildCuefieldTimelineExecution({
    exitTime: 40,
    entryTime: 8,
    targetVolume: 0.75,
    timeline: [
      { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
      { t: -8, deck: 'B', op: 'volume', value: 0.58, duration: 5200, curve: 'equal-power-in' },
      { t: -3.2, deck: 'A', op: 'bass', value: 0.38, duration: 2200 },
      { t: 0, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 900 },
      { t: 0.8, deck: 'A', op: 'volume', value: 0, duration: 1600 },
      { t: 2.6, deck: 'B', op: 'handoff' },
    ],
  });

  assert.equal(execution.leadSec, 8);
  assert.equal(execution.bStart, 8);
  assert.equal(execution.actions[0].delayMs, 0);
  assert.equal(execution.actions[1].target, 0.435);
  assert.equal(execution.actions[1].curve, 'equal-power-in');
  assert.equal(execution.actions.find((action) => action.op === 'bass').delayMs, 4800);
  assert.equal(execution.handoffDelayMs, 10600);
});

test('falls back to the current soft handoff curve when no timeline exists', () => {
  const execution = buildCuefieldTimelineExecution({
    exitTime: 30,
    entryTime: 12,
    targetVolume: 0.8,
    timeline: [],
    executionMode: 'intro-bed',
  });

  assert.equal(execution.leadSec, 5.2);
  assert.equal(execution.bStart, 6.8);
  assert.equal(execution.actions.some((action) => action.op === 'volume' && action.deck === 'B'), true);
  assert.equal(execution.handoffDelayMs, 4140);
});

test('marks timelines that need a B deck audio graph for filter or bass actions', () => {
  const execution = buildCuefieldTimelineExecution({
    entryTime: 4,
    timeline: [
      { t: -4, deck: 'B', op: 'play', at: 0, volume: 0 },
      { t: -4, deck: 'B', op: 'filter', type: 'highpass', value: 900, duration: 1200 },
      { t: -2, deck: 'B', op: 'bass', value: 0.25, duration: 800 },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });

  assert.equal(execution.requiresBGraph, true);
});

test('requires a B deck graph for equal-power volume curves', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -2, deck: 'B', op: 'play', at: 4, volume: 0 },
      { t: -2, deck: 'B', op: 'volume', value: 1, duration: 2000, curve: 'equal-power-in' },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });

  assert.equal(execution.requiresBGraph, true);
});

test('realigns volume-only downgrade to the strong B anchor', () => {
  assert.equal(typeof buildVolumeOnlyCuefieldExecution, 'function');
  const execution = buildVolumeOnlyCuefieldExecution({
    anchorTime: 12,
    targetVolume: 0.7,
  });
  const play = execution.actions.find((action) => action.op === 'play');

  assert.equal(execution.handoffDelayMs, 2200);
  assert.equal(play.at, 9.8);
  assert.equal(play.at + execution.leadSec, 12);
  assert.equal(execution.actions.some((action) => action.op === 'filter' || action.op === 'bass'), false);
});

test('keeps an adopted active Cuefield graph connected across normal source changes', () => {
  assert.equal(typeof shouldReleaseCuefieldDeckGraph, 'function');
  assert.equal(shouldReleaseCuefieldDeckGraph({ hasGraph: true, isPrepared: false, isActiveGraph: true }), false);
  assert.equal(shouldReleaseCuefieldDeckGraph({ hasGraph: true, isPrepared: false, isActiveGraph: false }), true);
});

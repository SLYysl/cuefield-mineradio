const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCuefieldTimelineExecution,
  buildEqualPowerCurve,
  buildVolumeOnlyCuefieldExecution,
  shouldReleaseCuefieldDeckGraph,
  transferCuefieldGainOwnership,
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

test('normalizes late-action metadata for every timeline action', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -3, deck: 'A', op: 'bass', optionalWhenLate: true, maxLateMs: 60.8 },
      { t: -2, deck: 'B', op: 'bass', optionalWhenLate: false, maxLateMs: 999 },
      { t: -1, deck: 'A', op: 'volume', optionalWhenLate: 'true', maxLateMs: -12 },
      { t: 0, deck: 'B', op: 'handoff', maxLateMs: 'invalid' },
    ],
  });

  assert.deepEqual(execution.actions.map((action) => ({
    optionalWhenLate: action.optionalWhenLate,
    maxLateMs: action.maxLateMs,
  })), [
    { optionalWhenLate: true, maxLateMs: 61 },
    { optionalWhenLate: false, maxLateMs: 200 },
    { optionalWhenLate: false, maxLateMs: 0 },
    { optionalWhenLate: false, maxLateMs: 0 },
  ]);
});

test('uses explicit transition window as the runtime clock without moving the B landing', () => {
  const execution = buildCuefieldTimelineExecution({
    entryTime: 8,
    mixStart: 75.985,
    handoffAt: 85,
    audibleOverlap: 4.85,
    preRollDuration: 0.475,
    timeline: [
      { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
      { t: -8, deck: 'B', op: 'volume', value: 0.58, duration: 5200 },
      { t: -3.2, deck: 'A', op: 'bass', value: 0.38, duration: 2200 },
      { t: 2.6, deck: 'B', op: 'handoff' },
    ],
  });
  const play = execution.actions.find((action) => action.op === 'play');

  assert.equal(execution.handoffDelayMs, 9015);
  assert.equal(execution.audibleOverlap, 4.85);
  assert.equal(execution.preRollDuration, 0.475);
  assert.equal(Math.abs((play.at + execution.handoffDelayMs / 1000) - 18.6) <= 0.001, true);
});

test('falls back to legacy timing for an empty explicit transition window', () => {
  const execution = buildCuefieldTimelineExecution({
    mixStart: 50,
    handoffAt: 50,
    timeline: [
      { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
      { t: 2.6, deck: 'B', op: 'handoff' },
    ],
  });

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

test('normalizes bounded echo actions and requires the addressed deck graph', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -2, deck: 'B', op: 'play', at: 4, volume: 0 },
      { t: -1.4, deck: 'A', op: 'echo', enabled: true, bpm: NaN, delayBeats: 0.5, feedback: 2, wet: 2, duration: 180 },
      { t: -1.2, deck: 'A', op: 'volume', value: 0, duration: 1400, curve: 'equal-power-out' },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });
  const echo = execution.actions.find((action) => action.op === 'echo');

  assert.equal(echo.delayMs, 600);
  assert.equal(echo.enabled, true);
  assert.equal(echo.bpm, 120);
  assert.equal(echo.delayBeats, 0.5);
  assert.equal(echo.feedback, 0.72);
  assert.equal(echo.wet, 0.5);
  assert.equal(execution.requiresAGraph, true);
});

test('normalizes bounded release echo tails', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -1, deck: 'A', op: 'echo', enabled: false, bpm: 120, tailMs: 99999 },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });

  assert.equal(execution.actions[0].tailMs, 4000);
});

test('normalizes low-band kick ducking and requires the addressed graph', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -2, deck: 'A', op: 'duck', bpm: 500, depth: 2, pulses: 99, beats: 0.01, attack: 999, hold: 999, release: 999 },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });
  const duck = execution.actions.find((action) => action.op === 'duck');

  assert.equal(duck.bpm, 240);
  assert.equal(duck.depth, 0.75);
  assert.equal(duck.pulses, 16);
  assert.equal(duck.beats, 0.25);
  assert.equal(duck.attack, 120);
  assert.equal(duck.hold, 180);
  assert.equal(duck.release, 320);
  assert.equal(execution.requiresAGraph, true);
});

test('normalizes source loop actions and marks loop runtime as required', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -4, deck: 'A', op: 'loop', enabled: true, startAt: 80, bpm: 120, loopBeats: 0.1, slip: true },
      { t: -2, deck: 'A', op: 'loop', enabled: false, slip: true },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });
  const start = execution.actions.find((action) => action.op === 'loop' && action.enabled);

  assert.equal(start.startAt, 80);
  assert.equal(start.loopBeats, 0.5);
  assert.equal(start.loopSeconds, 0.25);
  assert.equal(start.slip, true);
  assert.equal(execution.requiresSourceLoop, true);
});

test('marks B-deck echo as a B graph requirement', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: -1, deck: 'B', op: 'play', at: 0, volume: 0 },
      { t: -0.5, deck: 'B', op: 'echo', enabled: true, bpm: 120, delayBeats: 0.5, feedback: 0.4, wet: 0.3 },
      { t: 0, deck: 'B', op: 'handoff' },
    ],
  });

  assert.equal(execution.requiresBGraph, true);
  assert.equal(execution.requiresAGraph, false);
});

test('normalizes a bounded bridge action and marks bridge runtime as required', () => {
  const execution = buildCuefieldTimelineExecution({
    timeline: [
      { t: 0, deck: 'A', op: 'bridge', duration: 999999, bridge: { template: 'unknown', bars: 30, bpmFrom: 1, bpmTo: 999, stageDurations: [2, 4, 2] } },
      { t: 8, deck: 'B', op: 'handoff' },
    ],
  });
  const bridge = execution.actions.find((action) => action.op === 'bridge');

  assert.equal(bridge.bridge.template, 'drum-build');
  assert.equal(bridge.bridge.bars, 16);
  assert.equal(bridge.bridge.bpmFrom, 40);
  assert.equal(bridge.bridge.bpmTo, 240);
  assert.deepEqual(bridge.bridge.stageDurations, [2, 4, 2]);
  assert.equal(bridge.durationMs, 64000);
  assert.equal(execution.requiresBridge, true);
});

test('realigns volume-only downgrade to the strong B anchor', () => {
  assert.equal(typeof buildVolumeOnlyCuefieldExecution, 'function');
  const execution = buildVolumeOnlyCuefieldExecution({
    anchorTime: 12,
    targetVolume: 0.7,
  });
  const play = execution.actions.find((action) => action.op === 'play');

  assert.equal(execution.handoffDelayMs, 2200);
  assert.equal(execution.audibleStartDelayMs, 60);
  assert.equal(execution.audibleOverlap, 1.964);
  assert.equal(execution.preRollDuration, 0.06);
  assert.equal(play.at, 9.8);
  assert.equal(play.at + execution.leadSec, 12);
  assert.equal(execution.actions.some((action) => action.op === 'filter' || action.op === 'bass'), false);
  assert.equal(execution.actions.some((action) => action.op === 'echo'), false);
});

test('measures the shorter volume-only overlap when A also uses cubic media fading', () => {
  const execution = buildVolumeOnlyCuefieldExecution({
    anchorTime: 12,
    outgoingCurve: 'cubic-ease-out',
  });

  assert.equal(execution.audibleOverlap, 1.192);
});

test('keeps an adopted active Cuefield graph connected across normal source changes', () => {
  assert.equal(typeof shouldReleaseCuefieldDeckGraph, 'function');
  assert.equal(shouldReleaseCuefieldDeckGraph({ hasGraph: true, isPrepared: false, isActiveGraph: true }), false);
  assert.equal(shouldReleaseCuefieldDeckGraph({ hasGraph: true, isPrepared: false, isActiveGraph: false }), true);
});

test('transfers media gain into a graph exactly once', () => {
  assert.deepEqual(transferCuefieldGainOwnership({
    mediaVolume: 0.7,
    graphGain: 1,
    gainOwned: false,
  }), {
    mediaVolume: 1,
    graphGain: 0.7,
    gainOwned: true,
  });
  assert.deepEqual(transferCuefieldGainOwnership({
    mediaVolume: 1,
    graphGain: 0.7,
    gainOwned: true,
  }), {
    mediaVolume: 1,
    graphGain: 0.7,
    gainOwned: true,
  });
});

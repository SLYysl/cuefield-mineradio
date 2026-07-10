const assert = require('node:assert/strict');
const test = require('node:test');

const {
  interpolateBridgeTempo,
  buildBridgeEventPlan,
  createCuefieldBridgeEngine,
} = require('../public/cuefield-bridge-engine');

test('interpolates tempo once per bar with bounded endpoints', () => {
  assert.deepEqual(interpolateBridgeTempo(100, 140, 5), [100, 110, 120, 130, 140]);
  assert.deepEqual(interpolateBridgeTempo(2, 999, 2), [40, 240]);
});

test('builds bounded procedural events for every bridge template', () => {
  ['drum-build', 'echo-break', 'loop-rise', 'impact-drop'].forEach((template) => {
    const plan = buildBridgeEventPlan({
      template,
      bars: 8,
      bpmFrom: 110,
      bpmTo: 130,
      stageDurations: [4, 8, 4],
    });
    assert.equal(plan.bars, 8);
    assert.equal(plan.events.length > 4, true, template);
    assert.equal(plan.events.length <= 512, true, template);
    assert.equal(plan.events.every((event) => event.t >= 0 && event.t <= plan.duration), true, template);
    assert.equal(plan.events.some((event) => event.type === 'impact'), true, template);
  });
});

test('normalizes bridge length to 4, 8, or 16 bars', () => {
  assert.equal(buildBridgeEventPlan({ bars: 2, bpmFrom: 120, bpmTo: 120 }).bars, 4);
  assert.equal(buildBridgeEventPlan({ bars: 10, bpmFrom: 120, bpmTo: 120 }).bars, 8);
  assert.equal(buildBridgeEventPlan({ bars: 30, bpmFrom: 120, bpmTo: 120 }).bars, 16);
});

function fakeNode(kind, state) {
  return {
    kind,
    frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    Q: { value: 0 },
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() { return this; },
    disconnect() { state.disconnected += 1; },
    start() { state.started += 1; },
    stop() { state.stopped += 1; },
  };
}

function fakeContext() {
  const state = { started: 0, stopped: 0, disconnected: 0 };
  return {
    state,
    currentTime: 10,
    destination: {},
    sampleRate: 44100,
    createOscillator: () => fakeNode('oscillator', state),
    createGain: () => fakeNode('gain', state),
    createBiquadFilter: () => fakeNode('filter', state),
  };
}

test('starts on the supplied AudioContext and stop is idempotent', () => {
  const context = fakeContext();
  const engine = createCuefieldBridgeEngine();
  const started = engine.start({ template: 'drum-build', bars: 4, bpmFrom: 120, bpmTo: 126 }, { audioContext: context });

  assert.equal(started, true);
  assert.equal(context.state.started > 0, true);
  assert.equal(engine.snapshot().active, true);
  assert.equal(engine.stop('test'), true);
  assert.equal(engine.stop('again'), false);
  assert.equal(context.state.disconnected > 0, true);
  assert.equal(engine.snapshot().active, false);
});

test('fails closed when synthesis has no usable AudioContext', () => {
  const engine = createCuefieldBridgeEngine();
  assert.equal(engine.start({ template: 'drum-build', bars: 4 }, {}), false);
  assert.equal(engine.snapshot().active, false);
});

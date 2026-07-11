const assert = require('node:assert/strict');
const test = require('node:test');

const { createCuefieldSourceLoop } = require('../public/cuefield-source-loop');

function harness() {
  let now = 0;
  let callback = null;
  const runtime = createCuefieldSourceLoop({
    now: () => now,
    setInterval: (fn) => { callback = fn; return 7; },
    clearInterval: () => { callback = null; },
  });
  return {
    runtime,
    advance(ms) { now += ms; },
    tick() { if (callback) callback(); },
    hasTimer() { return !!callback; },
  };
}

test('repeats a real media region and slip-releases to the underlying timeline', () => {
  const h = harness();
  const media = { currentTime: 80, duration: 200, paused: false };

  assert.equal(h.runtime.apply({ enabled: true, startAt: 80, loopSeconds: 0.25, slip: true }, media, 'track:1'), true);
  media.currentTime = 80.27;
  h.tick();
  assert.equal(media.currentTime, 80);

  h.advance(2000);
  assert.equal(h.runtime.apply({ enabled: false, slip: true }, media, 'track:1'), true);
  assert.equal(media.currentTime, 82);
  assert.equal(h.hasTimer(), false);
});

test('tightens an active loop without resetting slip elapsed time', () => {
  const h = harness();
  const media = { currentTime: 40, duration: 180, paused: false };
  h.runtime.apply({ enabled: true, startAt: 40, loopSeconds: 1, slip: true }, media, 'track:2');
  h.advance(1000);
  h.runtime.apply({ enabled: true, startAt: 40, loopSeconds: 0.5, slip: true }, media, 'track:2');
  h.advance(1000);
  h.runtime.apply({ enabled: false, slip: true }, media, 'track:2');

  assert.equal(media.currentTime, 42);
});

test('resets stale sessions without seeking the replacement media', () => {
  const h = harness();
  const first = { currentTime: 20, duration: 120, paused: false };
  const second = { currentTime: 60, duration: 120, paused: false };
  h.runtime.apply({ enabled: true, startAt: 20, loopSeconds: 1, slip: true }, first, 'old');

  h.runtime.apply({ enabled: true, startAt: 60, loopSeconds: 1, slip: true }, second, 'new');
  h.runtime.stop('reset');

  assert.equal(first.currentTime, 20);
  assert.equal(second.currentTime, 60);
  assert.equal(h.runtime.snapshot().active, false);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readIndexHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
}

function extractAudioEndedHandler(html) {
  const start = html.indexOf('audio.onended = function(){');
  assert.notEqual(start, -1, 'audio.onended handler should exist');
  const end = html.indexOf('    };', start);
  assert.notEqual(end, -1, 'audio.onended handler should have a closing brace');
  return html.slice(start, end);
}

test('Cuefield handoff suppresses the normal ended next-track path', () => {
  const handler = extractAudioEndedHandler(readIndexHtml());

  const guardIndex = handler.indexOf('if (cuefieldAutoMixExecuting)');
  const nextTrackIndex = handler.indexOf('setTimeout(nextTrack, 0)');
  assert.notEqual(guardIndex, -1);
  assert.notEqual(nextTrackIndex, -1);
  assert.equal(guardIndex < nextTrackIndex, true);
  assert.match(handler.slice(guardIndex, nextTrackIndex), /return;/);
});

test('Cuefield transition keeps prepared B volume in its WebAudio graph', () => {
  const html = readIndexHtml();
  const start = html.indexOf('function ensureCuefieldBDeckGraph');
  const end = html.indexOf('function scheduleQueueBeatPrefetch', start);
  const cuefieldRuntime = html.slice(start, end);

  assert.match(cuefieldRuntime, /function primeCuefieldBDeckGain\(/);
  assert.match(cuefieldRuntime, /rampCuefieldGraphGain\(bGraph,/);
  assert.match(cuefieldRuntime, /nextMedia\.volume = 1/);
  assert.match(cuefieldRuntime, /pending\.runtimeDowngrade = 'volume-only'/);
  assert.match(html, /preparedAudio && preparedAudio\._cuefieldDeckGraph/);
});

test('Cuefield graph lifecycle and handoff timer remain owned by the active transition', () => {
  const html = readIndexHtml();
  const pauseStart = html.indexOf('function pauseCurrentAudioForTrackSwitch');
  const pauseEnd = html.indexOf('function syncPlaybackStateFromAudioEvent', pauseStart);
  const pauseBlock = html.slice(pauseStart, pauseEnd);
  const volumeStart = html.indexOf('function applyVolumeToAudio');
  const volumeEnd = html.indexOf('function updateVolumeUi', volumeStart);
  const volumeBlock = html.slice(volumeStart, volumeEnd);
  const executeStart = html.indexOf('async function executeCuefieldSoftHandoff');
  const executeEnd = html.indexOf('function scheduleQueueBeatPrefetch', executeStart);
  const executeBlock = html.slice(executeStart, executeEnd);

  assert.match(pauseBlock, /shouldReleaseCuefieldDeckGraph/);
  assert.match(volumeBlock, /audioGraphElement === audio/);
  assert.match(executeBlock, /cuefieldScheduleTimeline\(handoffDelayMs/);
  assert.doesNotMatch(executeBlock, /setTimeout\(function/);
});

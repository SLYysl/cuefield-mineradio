const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CuefieldTimelineExecutor = require('../public/cuefield-timeline-executor');

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

test('Cuefield prepared audio carries the target song key', () => {
  const html = readIndexHtml();
  const start = html.indexOf('function prepareCuefieldPendingAudio');
  const end = html.indexOf('function fadeCuefieldMediaVolume', start);
  const context = {
    Audio: function Audio() {
      this.src = '';
      this.load = function() {};
    },
    cuefieldAutoMixPreparedAudio: null,
    stopCuefieldPreparedAudio() {},
    cuefieldSetAudioTime() {},
    cuefieldStartTimeForPending() { return 0; },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);

  const media = context.prepareCuefieldPendingAudio({ audioUrl: '/audio/b', toKey: 'song:b' });

  assert.equal(media._cuefieldSongKey, 'song:b');
});

test('Cuefield prepared audio identity rejects B audio for C metadata', () => {
  const html = readIndexHtml();
  const start = html.indexOf('function cuefieldPreparedAudioMatchesSong');
  const end = html.indexOf('async function playQueueAt', start);
  assert.notEqual(start, -1, 'prepared audio identity helper should exist');
  assert.notEqual(end, -1, 'prepared audio identity helper should precede playback');
  const context = {
    beatMapSongKey: (song) => song && song.key || '',
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);

  const media = { _cuefieldSongKey: 'song:b' };
  assert.equal(context.cuefieldPreparedAudioMatchesSong(media, { key: 'song:b' }, 'song:b'), true);
  assert.equal(context.cuefieldPreparedAudioMatchesSong(media, { key: 'song:c' }, 'song:b'), false);
});

test('Cuefield deck graphs keep an echo tail outside the dry gain lifecycle', () => {
  const html = readIndexHtml();
  const start = html.indexOf('function configureCuefieldDeckGraph');
  const end = html.indexOf('function cuefieldVolumeOnlyExecution', start);
  const cuefieldRuntime = html.slice(start, end);

  assert.match(cuefieldRuntime, /createDelay\(/);
  assert.match(cuefieldRuntime, /echoSend/);
  assert.match(cuefieldRuntime, /echoDelay/);
  assert.match(cuefieldRuntime, /echoFeedback/);
  assert.match(cuefieldRuntime, /echoWet/);
  assert.match(cuefieldRuntime, /graph\.bass\.connect\(graph\.echoSend\)/);
  assert.match(cuefieldRuntime, /graph\.echoDelay\.connect\(graph\.echoFeedback\)/);
  assert.match(cuefieldRuntime, /graph\.echoFeedback\.connect\(graph\.echoDelay\)/);
  assert.match(cuefieldRuntime, /graph\.echoWet\.connect\(graph\.ctx\.destination\)/);
  assert.match(cuefieldRuntime, /graph\.echoSend\.disconnect\(\)/);
  assert.match(cuefieldRuntime, /graph\.echoDelay\.disconnect\(\)/);
  assert.match(cuefieldRuntime, /graph\.echoFeedback\.disconnect\(\)/);
  assert.match(cuefieldRuntime, /graph\.echoWet\.disconnect\(\)/);
  assert.match(cuefieldRuntime, /action\.op === 'echo'/);
  assert.match(cuefieldRuntime, /rampCuefieldGraphEcho\(/);
});

test('Cuefield bridge runtime starts on the shared context and stops on every reset', () => {
  const html = readIndexHtml();
  assert.match(html, /<script src="cuefield-bridge-engine\.js"><\/script>/);
  assert.match(html, /var cuefieldBridgeEngine = null;/);
  const initStart = html.indexOf('function initCuefieldBridgeEngine');
  const applyEnd = html.indexOf('function cuefieldVolumeOnlyExecution', initStart);
  const runtime = html.slice(initStart, applyEnd);
  const resetStart = html.indexOf('function resetCuefieldAutoMix');
  const resetEnd = html.indexOf('function cuefieldPlanFacts', resetStart);
  const reset = html.slice(resetStart, resetEnd);

  assert.match(runtime, /createCuefieldBridgeEngine/);
  assert.match(runtime, /audioContext: audioCtx/);
  assert.match(runtime, /action\.op === 'bridge'/);
  assert.match(runtime, /bridge-direct-fallback/);
  assert.match(runtime, /fallbackTimeline/);
  assert.match(reset, /stopCuefieldBridge/);
});

test('Cuefield source loops preflight a direct recipe fallback', () => {
  const html = readIndexHtml();
  const initStart = html.indexOf('function initCuefieldSourceLoopRuntime');
  const runEnd = html.indexOf('function prepareCuefieldPendingAudio', initStart);
  const runtime = html.slice(initStart, runEnd);

  assert.match(html, /<script src="cuefield-source-loop\.js"><\/script>/);
  assert.match(runtime, /execution\.requiresSourceLoop/);
  assert.match(runtime, /source-loop-direct-fallback/);
  assert.match(runtime, /cuefieldRecipeFallbackExecution\(pending\)/);
  assert.match(runtime, /candidate\.fallbackTimeline/);
  assert.match(runtime, /if \(nextMedia\) nextMedia\.pause\(\)/);
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

test('adopting a prepared B graph preserves effective output gain', () => {
  const html = readIndexHtml();
  const initStart = html.indexOf('function adoptAudioGraphGainOwnership');
  const initEnd = html.indexOf('function resumeAudioAnalysis', initStart);
  assert.notEqual(initStart, -1, 'gain ownership helper should exist');

  const audioParam = {
    value: 0.7,
    cancelScheduledValues() {},
    setValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  };
  const node = { disconnect() {} };
  const graph = {
    ctx: { currentTime: 12 },
    source: node,
    analyser: node,
    beatAnalyser: node,
    filter: node,
    bass: node,
    gain: { gain: audioParam },
  };
  const media = {
    volume: 1,
    muted: false,
    _cuefieldGainOwned: true,
    _cuefieldDeckGraph: graph,
  };
  const context = {
    window: { CuefieldTimelineExecutor },
    audio: media,
    audioCtx: graph.ctx,
    source: node,
    analyser: node,
    beatAnalyser: node,
    cuefieldFilterNode: node,
    cuefieldBassNode: node,
    cuefieldEchoSendNode: null,
    cuefieldEchoDelayNode: null,
    cuefieldEchoFeedbackNode: null,
    cuefieldEchoWetNode: null,
    gainNode: { gain: { value: 0.2 }, disconnect() {} },
    audioReady: false,
    audioGraphElement: {},
    cuefieldBDeckGraph: graph,
    targetVolume: 0.7,
    frequencyData: { fill() {} },
    beatFrequencyData: { fill() {} },
    beatTimeDomainData: { fill() {} },
    connectCuefieldDeckGraph(value) { return value; },
    resetCuefieldToneControls() {},
    resetRealtimeBeatEngine() {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(initStart, initEnd), context);

  const before = media.volume * audioParam.value;
  vm.runInContext('initAudio();', context);
  const after = media.volume * audioParam.value;

  assert.equal(Math.abs(after - before) <= 0.03, true, `effective gain changed from ${before} to ${after}`);
  assert.equal(media.volume, 1);
  assert.equal(context.audioGraphElement, media);
});

test('initializing an ordinary graph transfers media gain without changing output', () => {
  const html = readIndexHtml();
  const initStart = html.indexOf('function adoptAudioGraphGainOwnership');
  const initEnd = html.indexOf('function resumeAudioAnalysis', initStart);
  const makeParam = (value) => ({
    value,
    cancelScheduledValues() {},
    setValueAtTime(next) { this.value = next; },
  });
  const makeNode = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const media = { volume: 0.7, muted: false };
  const graphGain = makeParam(1);
  const audioContext = {
    state: 'running',
    currentTime: 4,
    destination: {},
    createMediaElementSource() { return makeNode(); },
    createAnalyser() { return makeNode(); },
    createBiquadFilter() {
      return makeNode({ frequency: makeParam(0), Q: makeParam(0), gain: makeParam(0) });
    },
    createGain() { return makeNode({ gain: graphGain }); },
  };
  const context = {
    window: { CuefieldTimelineExecutor },
    audio: media,
    audioCtx: audioContext,
    source: null,
    analyser: null,
    beatAnalyser: null,
    cuefieldFilterNode: null,
    cuefieldBassNode: null,
    cuefieldEchoSendNode: null,
    cuefieldEchoDelayNode: null,
    cuefieldEchoFeedbackNode: null,
    cuefieldEchoWetNode: null,
    gainNode: null,
    audioReady: false,
    audioGraphElement: null,
    cuefieldBDeckGraph: null,
    FFT_SIZE: 2048,
    BEAT_FFT_SIZE: 1024,
    frequencyData: { fill() {} },
    beatFrequencyData: { fill() {} },
    beatTimeDomainData: { fill() {} },
    resetRealtimeBeatEngine() {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(initStart, initEnd), context);

  const before = media.volume;
  vm.runInContext('initAudio();', context);
  const after = media.volume * graphGain.value;

  assert.equal(Math.abs(after - before) <= 0.03, true, `effective gain changed from ${before} to ${after}`);
  assert.equal(media.volume, 1);
  assert.equal(graphGain.value, 0.7);
  assert.equal(context.audioGraphElement, media);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CuefieldTimelineExecutor = require('../public/cuefield-timeline-executor');

function readIndexHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
}

test('Cuefield feedback stats panel can fetch and render feedback stats', () => {
  const html = readIndexHtml();

  assert.match(html, /id="cuefield-feedback-stats"/);
  assert.match(html, /toggleCuefieldFeedbackStats/);
  assert.match(html, /loadCuefieldFeedbackStats/);
  assert.match(html, /\/api\/cuefield\/feedback/);
  assert.match(html, /cuefield-feedback-stat-passrate/);
  assert.match(html, /cuefield-feedback-stat-failures/);
});

test('Cuefield feedback prompt captures a typed note with the rating', () => {
  const html = readIndexHtml();

  assert.match(html, /id="cuefield-feedback-note"/);
  assert.match(html, /maxlength="240"/);
  assert.match(html, /noteInput\.value\.trim\(\)/);
  assert.match(html, /setTimeout\(hideCuefieldFeedbackPrompt, 120000\)/);
});

test('Cuefield runtime executes source loop, low-band ducking, and release echo tails', () => {
  const html = readIndexHtml();

  assert.match(html, /<script src="cuefield-source-loop\.js"><\/script>/);
  assert.match(html, /function applyCuefieldSourceLoopAction/);
  assert.match(html, /function scheduleCuefieldLowBandDuck/);
  assert.match(html, /action\.tailMs/);
  assert.match(html, /action\.op === 'loop'/);
  assert.match(html, /action\.op === 'duck'/);
});

test('Cuefield AutoMix treats the active in-memory beatmap as ready before disk persistence', () => {
  const html = readIndexHtml();

  assert.match(html, /beatMapCache\[key\] = currentBeatMap;\s*writeBeatDiskCache\(key, currentBeatMap, song, 'mr'\)\.catch/);
  assert.match(html, /return true;\s*\}\s*var diskMap = await readBeatDiskCache\(key\);/);
});

test('Cuefield AutoMix fetches paired raw lyrics for transition planning', () => {
  const html = readIndexHtml();
  const pairStart = html.indexOf('async function planCuefieldSongPair');
  const initStart = html.indexOf('function initCuefieldAutoMix');
  const pairBlock = html.slice(pairStart, initStart);
  const initEnd = html.indexOf('function cuefieldFeedbackSongMeta', initStart);
  const initBlock = html.slice(initStart, initEnd);

  assert.match(html, /<script src="cuefield-lyric-source\.js"><\/script>/);
  assert.match(pairBlock, /CuefieldLyricSource/);
  assert.match(pairBlock, /fetchRawLrc\(fromSong/);
  assert.match(pairBlock, /fetchRawLrc\(toSong/);
  assert.match(pairBlock, /fromLrc:/);
  assert.match(pairBlock, /toLrc:/);
  assert.match(initBlock, /planCuefieldSongPair/);
  assert.doesNotMatch(pairBlock, /setOriginalLyricsState|applyPreferredLyricsForCurrent/);
});

test('Cuefield feedback captures adaptive planner and runtime diagnostics', () => {
  const html = readIndexHtml();
  const contextStart = html.indexOf('function cuefieldFeedbackContextFromPending');
  const contextEnd = html.indexOf('function hideCuefieldFeedbackPrompt', contextStart);
  const contextBlock = html.slice(contextStart, contextEnd);
  const executeStart = html.indexOf('async function executeCuefieldSoftHandoff');
  const executeEnd = html.indexOf('function scheduleQueueBeatPrefetch', executeStart);
  const executeBlock = html.slice(executeStart, executeEnd);

  assert.match(contextBlock, /plannerDiagnostics\.overlapClass/);
  assert.match(contextBlock, /plannerDiagnostics\.relativeTempoDelta/);
  assert.match(contextBlock, /plannerDiagnostics\.structureSource/);
  assert.match(contextBlock, /plannerDiagnostics\.protectedUntil/);
  assert.match(contextBlock, /plannerDiagnostics\.exitType/);
  assert.match(contextBlock, /plannerDiagnostics\.entryType/);
  assert.match(contextBlock, /plannerDiagnostics\.exitCandidateCount/);
  [
    'firstHookStart', 'firstHookEnd', 'hookConfidence', 'hookEvidence',
    'exitRatio', 'mixStart', 'handoffAt', 'landingAt',
    'audibleOverlap', 'preRollDuration', 'energyContinuity',
    'grooveContinuity', 'tempoCompatibility', 'windowRejectionReasons',
    'route', 'compatibilityClass', 'contrastDirection', 'preferredExitRange',
    'routeReasons', 'routeFallbackUsed',
    'localMusicalEvidence', 'localMusicalCompatibility', 'localHarmonicSimilarity',
    'localKeyCompatibility', 'localMelodySimilarity', 'localMusicalConfidence',
    'localAWindowStart', 'localBWindowStart', 'localAWindowDistance',
    'localBWindowDistance', 'localMusicalRisks',
  ].forEach((field) => assert.match(contextBlock, new RegExp('plannerDiagnostics\\.' + field)));
  assert.match(contextBlock, /pending\.runtimeDowngrade/);
  assert.match(contextBlock, /pending\.actualHandoffAt/);
  assert.match(contextBlock, /pending\.actualAudibleOverlap/);
  assert.match(contextBlock, /pending\.actualPreRollDuration/);
  assert.equal(executeBlock.indexOf('runCuefieldVolumeCurve') < executeBlock.indexOf('cuefieldFeedbackContextFromPending'), true);
});

test('Cuefield feedback context propagates local musical diagnostics at runtime', () => {
  const html = readIndexHtml();
  const contextStart = html.indexOf('function cuefieldFeedbackSongMeta');
  const contextEnd = html.indexOf('function hideCuefieldFeedbackPrompt', contextStart);
  const contextBlock = html.slice(contextStart, contextEnd);
  const context = {
    playQueue: [
      { id: 'song:a', name: 'A', artist: 'Artist A' },
      { id: 'song:b', name: 'B', artist: 'Artist B' },
    ],
    beatMapSongKey: (song) => song.id,
    cuefieldSetMode: 'smart',
  };
  vm.createContext(context);
  vm.runInContext(contextBlock, context);

  const result = context.cuefieldFeedbackContextFromPending({
    currentIndex: 0,
    nextIndex: 1,
    fromKey: 'song:a',
    toKey: 'song:b',
    executionMode: 'filtered-pickup',
    plan: {
      chosen: { recipe: 'section-jump', evaluation: { tier: 'usable', score: 0.81 } },
      diagnostics: {
        localMusicalEvidence: true,
        localMusicalCompatibility: 0.812,
        localHarmonicSimilarity: 0.901,
        localKeyCompatibility: 0.785,
        localMelodySimilarity: 0.668,
        localMusicalConfidence: 0.877,
        localAWindowStart: 12.346,
        localBWindowStart: 23.457,
        localAWindowDistance: 0.005,
        localBWindowDistance: 1.235,
        localMusicalRisks: ['harmonic-clash', 'late'],
      },
    },
  });

  assert.deepEqual(result.transition.localMusicalEvidence, true);
  assert.equal(result.transition.localMusicalCompatibility, 0.812);
  assert.equal(result.transition.localHarmonicSimilarity, 0.901);
  assert.equal(result.transition.localKeyCompatibility, 0.785);
  assert.equal(result.transition.localMelodySimilarity, 0.668);
  assert.equal(result.transition.localMusicalConfidence, 0.877);
  assert.equal(result.transition.localAWindowStart, 12.346);
  assert.equal(result.transition.localBWindowStart, 23.457);
  assert.equal(result.transition.localAWindowDistance, 0.005);
  assert.equal(result.transition.localBWindowDistance, 1.235);
  assert.deepEqual(result.transition.localMusicalRisks, ['harmonic-clash', 'late']);
});

test('Cuefield separates terminal fallback from musical rescue status', () => {
  const html = readIndexHtml();
  const statusStart = html.indexOf('function cuefieldAutoMixStatusText');
  const statusEnd = html.indexOf('function logCuefieldAutoMix', statusStart);
  const statusBlock = html.slice(statusStart, statusEnd);

  assert.match(statusBlock, /'terminal-rescue': '正在准备末尾保底过渡'/);
  assert.match(statusBlock, /'fallback': '未找到可执行过渡'/);
  assert.doesNotMatch(statusBlock, /这两首暂不适合自动切/);
  assert.match(statusBlock, /'waiting-beatmap': '等待节拍分析完成'/);
  assert.match(statusBlock, /'missing-audio': '下一首音频暂时不可用'/);
  assert.match(statusBlock, /'technical-error': '分析数据暂时不可用'/);
  assert.match(statusBlock, /'error': '准备失败'/);

  const context = {};
  vm.createContext(context);
  vm.runInContext(statusBlock, context);
  assert.equal(context.cuefieldAutoMixStatusText('terminal-rescue'), '正在准备末尾保底过渡');
  assert.equal(context.cuefieldAutoMixStatusText('fallback'), '未找到可执行过渡');
  assert.equal(context.cuefieldAutoMixStatusText('technical-error'), '分析数据暂时不可用');

  const prepareStart = html.indexOf('async function runCuefieldAutoMixPrepare');
  const prepareEnd = html.indexOf('function stopCuefieldPreparedAudio', prepareStart);
  const prepareBlock = html.slice(prepareStart, prepareEnd);
  assert.match(prepareBlock, /pending\.executionMode === 'terminal-rescue'/);
  assert.match(prepareBlock, /updateCuefieldAutoMixUi\(uiStatus\)/);
  assert.match(prepareBlock, /result\.status === 'technical-error'/);
});

test('Cuefield runtime records the executed window after a volume-only downgrade', () => {
  const html = readIndexHtml();
  const runtimeStart = html.indexOf('function cuefieldVolumeOnlyExecution');
  const runtimeEnd = html.indexOf('function prepareCuefieldPendingAudio', runtimeStart);
  const runtimeBlock = html.slice(runtimeStart, runtimeEnd);
  const pending = {
    mixStart: 48.25,
    triggerAt: 48.25,
    entryTime: 8,
    plan: { chosen: { recipeCandidate: { anchors: { bAnchor: 12 } } } },
  };
  const context = {
    window: { CuefieldTimelineExecutor },
    targetVolume: 0.7,
    gainNode: { gain: {} },
    audioCtx: {},
    cuefieldTimelineExecutionForPending: () => ({
      requiresBGraph: true,
      handoffDelayMs: 9015,
      audibleOverlap: 4.85,
      preRollDuration: 0.475,
      actions: [],
    }),
    clearCuefieldTimelineTimers() {},
    ensureCuefieldBDeckGraph: () => null,
    primeCuefieldBDeckGain() {},
    cuefieldScheduleTimeline() {},
    applyCuefieldTimelineAction() {},
  };
  vm.createContext(context);
  vm.runInContext(runtimeBlock, context);

  const handoffDelayMs = context.runCuefieldVolumeCurve(pending, {});
  assert.equal(pending.runtimeDowngrade, 'volume-only');
  assert.equal(handoffDelayMs, 2200);
  assert.equal(pending.actualHandoffAt, 50.45);
  assert.equal(pending.actualMixStart, 48.31);
  assert.equal(pending.actualAudibleOverlap, 1.964);
  assert.equal(pending.actualPreRollDuration, 0.06);
});

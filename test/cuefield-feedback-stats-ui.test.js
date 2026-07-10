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

test('Cuefield AutoMix treats the active in-memory beatmap as ready before disk persistence', () => {
  const html = readIndexHtml();

  assert.match(html, /beatMapCache\[key\] = currentBeatMap;\s*writeBeatDiskCache\(key, currentBeatMap, song, 'mr'\)\.catch/);
  assert.match(html, /return true;\s*\}\s*var diskMap = await readBeatDiskCache\(key\);/);
});

test('Cuefield AutoMix fetches paired raw lyrics for transition planning', () => {
  const html = readIndexHtml();
  const initStart = html.indexOf('function initCuefieldAutoMix');
  const initEnd = html.indexOf('function cuefieldFeedbackSongMeta', initStart);
  const initBlock = html.slice(initStart, initEnd);

  assert.match(html, /<script src="cuefield-lyric-source\.js"><\/script>/);
  assert.match(initBlock, /CuefieldLyricSource/);
  assert.match(initBlock, /fetchRawLrc\(fromSong/);
  assert.match(initBlock, /fetchRawLrc\(toSong/);
  assert.match(initBlock, /fromLrc:/);
  assert.match(initBlock, /toLrc:/);
  assert.doesNotMatch(initBlock, /setOriginalLyricsState|applyPreferredLyricsForCurrent/);
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
  ].forEach((field) => assert.match(contextBlock, new RegExp('plannerDiagnostics\\.' + field)));
  assert.match(contextBlock, /pending\.runtimeDowngrade/);
  assert.match(contextBlock, /pending\.actualHandoffAt/);
  assert.match(contextBlock, /pending\.actualAudibleOverlap/);
  assert.match(contextBlock, /pending\.actualPreRollDuration/);
  assert.equal(executeBlock.indexOf('runCuefieldVolumeCurve') < executeBlock.indexOf('cuefieldFeedbackContextFromPending'), true);
});

test('Cuefield uses musical rescue copy without changing technical statuses', () => {
  const html = readIndexHtml();
  const statusStart = html.indexOf('function cuefieldAutoMixStatusText');
  const statusEnd = html.indexOf('function logCuefieldAutoMix', statusStart);
  const statusBlock = html.slice(statusStart, statusEnd);

  assert.match(statusBlock, /'fallback': '正在准备末尾保底过渡'/);
  assert.doesNotMatch(statusBlock, /这两首暂不适合自动切/);
  assert.match(statusBlock, /'waiting-beatmap': '等待节拍分析完成'/);
  assert.match(statusBlock, /'missing-audio': '下一首音频暂时不可用'/);
  assert.match(statusBlock, /'error': '准备失败'/);
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

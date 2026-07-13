const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sourceBlock(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `missing ${from}`);
  assert.notEqual(end, -1, `missing ${to}`);
  return source.slice(start, end);
}

function createMusicalQueueHarness(options = {}) {
  const source = read('public/index.html');
  const lookupSource = sourceBlock(
    source,
    'async function fetchBeatPrefetchAudioUrl',
    'function readCuefieldSetModePreference',
  );
  const queueSource = sourceBlock(
    source,
    'var cuefieldMusicalAnalysisTasks = {};',
    'function clearCuefieldAutoMixPrepareTimer',
  );
  const decodeJobs = [];
  const audioUrlCalls = [];
  const fetchCalls = [];
  const fetchOptions = [];
  const analyzeCalls = [];
  const persistCalls = [];
  const closeCalls = [];
  const lookupCalls = [];
  const context = {
    beatMapCache: {},
    console: { log() {}, warn() {} },
    fetch: async (url, requestOptions) => {
      fetchCalls.push(url);
      fetchOptions.push(requestOptions);
      if (options.fetch) return options.fetch(url, requestOptions, fetchCalls.length);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    writeBeatDiskCache: async (...args) => {
      persistCalls.push(args);
      return true;
    },
    apiJson: async (url, requestOptions) => {
      lookupCalls.push({ url, options: requestOptions });
      if (options.lookup) return options.lookup(url, requestOptions, lookupCalls.length);
      return { url: `https://audio.test/${lookupCalls.length}` };
    },
    songProviderKey: (song) => song && song.provider || 'netease',
    normalizePlaybackQuality: (quality) => quality || 'hires',
    playbackQuality: 'hires',
    hasProviderSvip: () => true,
    loginStatus: {},
    qqPlaybackQualityCeiling: '',
  };
  if (!options.useRealAudioLookup) {
    context.fetchBeatPrefetchAudioUrl = async (song, lookupOptions) => {
      audioUrlCalls.push(song.key);
      assert.equal(lookupOptions.quality, 'standard');
      assert.ok(Number.isFinite(lookupOptions.timeoutMs));
      if (options.lookup) return options.lookup(song, lookupOptions, audioUrlCalls.length);
      return `/audio/${song.key}`;
    };
  }
  class AudioContextStub {
    decodeAudioData(bytes, resolve, reject) {
      const job = { bytes, resolve: () => resolve({ duration: 100 }), reject };
      decodeJobs.push(job);
      if (options.decode) return options.decode(job, decodeJobs.length);
      if (!options.holdDecode) job.resolve();
    }
    close() { closeCalls.push(true); }
  }
  context.window = {
    AudioContext: AudioContextStub,
    CuefieldMusicalSampler: {
      selectTransitionWindowStarts: (structureMap) => structureMap && structureMap.starts || [0, 20],
      sampleRepresentativeAudio: (buffer, sampleOptions) => ({
        buffer,
        windowStarts: sampleOptions.windowStarts,
      }),
    },
    desktopWindow: {
      analyzeCuefieldMusicalWindow: async (sampled) => {
        analyzeCalls.push(sampled.windowStarts);
        if (options.analyze) return options.analyze(sampled, analyzeCalls.length);
        return { ok: true, profile: { noteCount: 4, key: { name: 'C' } } };
      },
    },
  };
  context.AbortController = AbortController;
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  vm.createContext(context);
  vm.runInContext(`
    var CUEFIELD_MUSICAL_QUEUE_LIMIT = 4;
    var CUEFIELD_MUSICAL_FETCH_TIMEOUT_MS = ${options.fetchTimeoutMs || 20};
    var CUEFIELD_MUSICAL_DECODE_TIMEOUT_MS = ${options.decodeTimeoutMs || 20};
    var CUEFIELD_MUSICAL_URL_TIMEOUT_MS = ${options.lookupTimeoutMs || 20};
    var CUEFIELD_MUSICAL_MAX_AUDIO_BYTES = ${options.maxAudioBytes || 32 * 1024 * 1024};
    ${options.useRealAudioLookup ? lookupSource : ''}
    ${queueSource}
  `, context);
  return { context, decodeJobs, audioUrlCalls, fetchCalls, fetchOptions, analyzeCalls, persistCalls, closeCalls, lookupCalls };
}

function createEnsureBeatMapHarness(options = {}) {
  const source = read('public/index.html');
  const ensureSource = sourceBlock(
    source,
    'async function ensureCuefieldAutoMixBeatMap',
    'var cuefieldMusicalAnalysisTasks = {};',
  );
  const song = { key: 'selected', name: 'Selected' };
  const scheduleCalls = [];
  const diskReads = [];
  const diskWrites = [];
  const context = {
    beatMapCache: {},
    currentIdx: 0,
    playQueue: [song],
    currentBeatMap: options.currentBeatMap || null,
    beatMapSongKey: (value) => value && value.key || '',
    scheduleCuefieldMusicalProfile: (...args) => scheduleCalls.push(args),
    writeBeatDiskCache: async (...args) => {
      diskWrites.push(args);
      return true;
    },
    readBeatDiskCache: async (key) => {
      diskReads.push(key);
      return options.diskMap || null;
    },
    isBeatPrefetchCandidate: () => false,
    beatMapBusy: false,
  };
  vm.createContext(context);
  vm.runInContext(ensureSource, context);
  return { context, song, scheduleCalls, diskReads, diskWrites };
}

function createPairFlowHarness(responses, options = {}) {
  const source = read('public/index.html');
  const pairSource = sourceBlock(source, 'async function planCuefieldSongPair', 'function initCuefieldAutoMix');
  const initSource = sourceBlock(source, 'function initCuefieldAutoMix', 'function cuefieldFeedbackSongMeta');
  const ensureSource = sourceBlock(source, 'async function ensureCuefieldAutoMixBeatMap', 'var cuefieldMusicalAnalysisTasks = {};');
  const evaluateSource = sourceBlock(source, 'async function cuefieldEvaluatePair', 'function cuefieldEvaluateWithinBudget');
  const songs = {
    from: { key: 'selected-from', name: 'From' },
    to: { key: 'selected-to', name: 'To' },
  };
  const maps = {
    'selected-from': queueMap(),
    'selected-to': queueMap(),
    unrelated: queueMap(),
  };
  const apiCalls = [];
  const structuredJobs = [];
  let autoMixDeps = null;
  const context = {
    CUEFIELD_PAIR_PLAN_TTL_MS: 300000,
    cuefieldPairPlanCache: new Map(),
    cuefieldRecentRecipes: (options.recentRecipes || []).slice(),
    beatMapCache: maps,
    beatMapSongKey: (song) => song && song.key || '',
    songProviderKey: () => 'test',
    apiJson: async (url, options) => {
      apiCalls.push({ url, options });
      return responses.shift();
    },
    scheduleCuefieldMusicalProfile: async (song, key, map, decodedBuffer, profileOptions) => {
      structuredJobs.push({ song, key, map, decodedBuffer, options: profileOptions });
      if (options.schedule) return options.schedule(song, key, map, decodedBuffer, profileOptions);
      return { noteCount: 4 };
    },
    CUEFIELD_MUSICAL_REFINEMENT_TIMEOUT_MS: options.refinementTimeoutMs || 35000,
    setTimeout,
    clearTimeout,
    currentIdx: 0,
    currentBeatMap: null,
    playQueue: [songs.from, songs.to],
    trackSwitchToken: 17,
    cuefieldAutoMix: null,
    cuefieldAutoMixEnabled: true,
    updateCuefieldAutoMixUi() {},
    cuefieldPlanFacts: (plan) => ({ plan }),
    logCuefieldAutoMix() {},
    console: { warn() {} },
  };
  context.window = {
    CuefieldLyricSource: {
      fetchRawLrc: async () => '',
    },
    CuefieldAutoMix: {
      createCuefieldAutoMix: (deps) => {
        autoMixDeps = deps;
        return { setEnabled() {} };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext([pairSource, initSource, ensureSource, evaluateSource].join('\n'), context);
  return {
    context,
    songs,
    maps,
    apiCalls,
    structuredJobs,
    getAutoMixDeps: () => autoMixDeps,
  };
}

function pairPlanFixture(label) {
  return {
    ok: true,
    label,
    chosen: { timeline: [{ op: 'handoff' }] },
    from: { structureMap: { entryCandidates: [{ type: 'intro', role: 'entry', time: 0 }] } },
    to: { structureMap: { entryCandidates: [{ type: 'drop', role: 'entry', time: 8 }] } },
  };
}

function queueMap(starts = [0, 20]) {
  return { duration: 100, structureMap: { starts } };
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHandoffHistoryHarness(options = {}) {
  const source = read('public/index.html');
  const historySource = sourceBlock(
    source,
    'function rememberCuefieldRecipe',
    'function readCuefieldSetModePreference',
  );
  const handoffSource = sourceBlock(
    source,
    'async function executeCuefieldSoftHandoff',
    'function scheduleQueueBeatPrefetch',
  );
  const context = {
    cuefieldRecentRecipes: [],
    cuefieldAutoMixExecuting: false,
    trackSwitchToken: 17,
    currentIdx: 0,
    playQueue: [{ key: 'a' }, { key: 'b' }],
    audio: {},
    playToggleBusy: true,
    updateCuefieldAutoMixUi() {},
    showSourceFallbackNotice() {},
    cuefieldTierLabel: () => 'usable',
    startCuefieldPreparedAudio: async () => {
      if (options.cancelled) context.trackSwitchToken += 1;
      return options.preloadFailed ? null : {};
    },
    stopCuefieldPreparedAudio() {},
    restorePlaybackGain() {},
    showToast() {},
    runCuefieldVolumeCurve: () => 0,
    cuefieldFeedbackContextFromPending: () => ({}),
    cuefieldScheduleTimeline: (delay, callback) => callback(),
    playQueueAt: async () => {
      if (options.playFailed) throw new Error('handoff failed');
      return true;
    },
    showCuefieldFeedbackPrompt() {},
    console: { warn() {} },
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(`${historySource}\n${handoffSource}`, context);
  return context;
}

test('desktop bridge exposes the bounded musical analysis IPC', () => {
  assert.match(read('desktop/main.js'), /ipcMain\.handle\('cuefield-musical-analyze'/);
  assert.match(read('desktop/preload.js'), /analyzeCuefieldMusicalWindow/);
  assert.match(read('package.json'), /@spotify\/basic-pitch/);
});

test('renderer persists musical profiles in packed beat maps', () => {
  const source = read('public/index.html');
  assert.match(source, /musicalProfile:\s*map\.musicalProfile/);
  assert.match(source, /musicalProfile:\s*stored\.musicalProfile/);
  assert.match(source, /CuefieldMusicalSampler\.sampleRepresentativeAudio/);
  assert.match(source, /analyzeCuefieldMusicalWindow/);
});

test('renderer passes the structure map into bounded musical sampling', () => {
  const source = read('public/index.html');
  assert.match(source, /async function analyzeCuefieldMusicalBuffer\(buffer, map, structureMap, windowStarts\)/);
  assert.match(source, /structureMap:\s*structureMap\s*\|\|\s*map\s*&&\s*map\.structureMap\s*\|\|\s*null/);
  assert.match(source, /windowStarts:\s*windowStarts/);
  assert.match(source, /analyzeCuefieldMusicalBuffer\(buffer, map,/);
});

test('renderer queue has one active decode, four pending jobs, signature dedupe, and generic overflow skip', async () => {
  const harness = createMusicalQueueHarness({ holdDecode: true });
  const { context } = harness;
  const firstMap = queueMap();
  const first = context.scheduleCuefieldMusicalProfile({ key: 'a' }, 'a', firstMap);
  const duplicate = context.scheduleCuefieldMusicalProfile({ key: 'a' }, 'a', firstMap);
  assert.equal(first, duplicate);
  ['b', 'c', 'd', 'e'].forEach((key) => {
    context.scheduleCuefieldMusicalProfile({ key }, key, queueMap());
  });
  const overflow = context.scheduleCuefieldMusicalProfile({ key: 'f' }, 'f', queueMap());

  await flushTasks();
  assert.deepEqual(harness.audioUrlCalls, ['a']);
  assert.deepEqual(harness.fetchCalls, ['/audio/a']);
  assert.equal(harness.decodeJobs.length, 1);
  assert.equal(context.cuefieldMusicalAnalysisQueue.length, 4);
  assert.equal(await overflow, null);
  assert.equal(Object.hasOwn(context.cuefieldMusicalAnalysisTasks, 'f:transition-v1:100.000:0,20'), false);

  harness.decodeJobs[0].resolve();
  await first;
});

test('structured final-pair jobs run before pending generic jobs', async () => {
  let releaseFirst;
  const firstAnalysis = new Promise((resolve) => { releaseFirst = resolve; });
  const harness = createMusicalQueueHarness({
    analyze: async (sampled, callCount) => callCount === 1
      ? firstAnalysis
      : { ok: true, profile: { noteCount: 4 } },
  });
  const { context } = harness;
  const first = context.scheduleCuefieldMusicalProfile({ key: 'a' }, 'a', queueMap());
  context.scheduleCuefieldMusicalProfile({ key: 'b' }, 'b', queueMap());
  context.scheduleCuefieldMusicalProfile({ key: 'final' }, 'final', queueMap([5, 40]), null, {
    structured: true,
    structureMap: { starts: [5, 40] },
  });

  await flushTasks();
  assert.deepEqual(harness.audioUrlCalls, ['a']);
  releaseFirst({ ok: true, profile: { noteCount: 4 } });
  await first;
  await flushTasks();
  assert.deepEqual(harness.audioUrlCalls.slice(0, 2), ['a', 'final']);
});

test('structured request prevents a stale active generic profile from overwriting the same song', async () => {
  let releaseGeneric;
  const genericAnalysis = new Promise((resolve) => { releaseGeneric = resolve; });
  const harness = createMusicalQueueHarness({
    analyze: async (sampled, callCount) => callCount === 1
      ? genericAnalysis
      : { ok: true, profile: { noteCount: 4, marker: 'structured' } },
  });
  const { context } = harness;
  const map = queueMap([5, 40]);
  const generic = context.scheduleCuefieldMusicalProfile({ key: 'same' }, 'same', map);

  await flushTasks();
  const structured = context.scheduleCuefieldMusicalProfile({ key: 'same' }, 'same', map, null, {
    structured: true,
    structureMap: { starts: [5, 40] },
  });
  releaseGeneric({ ok: true, profile: { noteCount: 4, marker: 'generic' } });

  assert.equal(await generic, null);
  const profile = await structured;
  assert.equal(profile.marker, 'structured');
  assert.equal(map.musicalProfile.windowStrategy, 'structure-v1');
  assert.equal(map.musicalProfile.windowSignature, 'transition-v1:100.000:5,40');
  assert.equal(harness.persistCalls.length, 1);
  assert.equal(harness.persistCalls[0][1].musicalProfile.marker, 'structured');
});

test('structured request removes a queued generic task for the same song', async () => {
  const harness = createMusicalQueueHarness({ holdDecode: true });
  const { context } = harness;
  const blocker = context.scheduleCuefieldMusicalProfile({ key: 'blocker' }, 'blocker', queueMap());
  const generic = context.scheduleCuefieldMusicalProfile({ key: 'same' }, 'same', queueMap());
  const structured = context.scheduleCuefieldMusicalProfile({ key: 'same' }, 'same', queueMap([5, 40]), null, {
    structured: true,
    structureMap: { starts: [5, 40] },
  });

  assert.equal(await generic, null);
  assert.equal(context.cuefieldMusicalAnalysisQueue.length, 1);
  assert.equal(context.cuefieldMusicalAnalysisQueue[0].structured, true);
  await flushTasks();
  harness.decodeJobs[0].resolve();
  await blocker;
  await flushTasks();
  harness.decodeJobs[1].resolve();
  assert.equal((await structured).windowStrategy, 'structure-v1');
});

test('musical fetch aborts on timeout and rejects oversized responses before decode', async () => {
  let timeoutSignal;
  const timedOut = createMusicalQueueHarness({
    fetchTimeoutMs: 5,
    fetch: async (url, requestOptions) => {
      timeoutSignal = requestOptions.signal;
      return new Promise(() => {});
    },
  });

  assert.equal(await timedOut.context.scheduleCuefieldMusicalProfile({ key: 'timeout' }, 'timeout', queueMap()), null);
  assert.equal(timeoutSignal.aborted, true);
  assert.equal(timedOut.decodeJobs.length, 0);

  let bodyRead = false;
  const oversized = createMusicalQueueHarness({
    fetch: async () => ({
      ok: true,
      headers: { get: () => String(32 * 1024 * 1024 + 1) },
      arrayBuffer: async () => {
        bodyRead = true;
        return new ArrayBuffer(1);
      },
    }),
  });

  assert.equal(await oversized.context.scheduleCuefieldMusicalProfile({ key: 'large' }, 'large', queueMap()), null);
  assert.equal(bodyRead, false);
  assert.equal(oversized.decodeJobs.length, 0);
});

test('musical fetch rejects a body that exceeds the byte cap without a content length', async () => {
  const harness = createMusicalQueueHarness({
    fetch: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => ({ byteLength: 32 * 1024 * 1024 + 1 }),
    }),
  });

  assert.equal(await harness.context.scheduleCuefieldMusicalProfile({ key: 'large-body' }, 'large-body', queueMap()), null);
  assert.equal(harness.decodeJobs.length, 0);
});

test('musical URL lookup passes a finite timeout for NetEase and QQ requests', async () => {
  const harness = createMusicalQueueHarness({ useRealAudioLookup: true });

  await harness.context.fetchBeatPrefetchAudioUrl(
    { id: 1, key: 'netease', provider: 'netease' },
    { quality: 'standard', timeoutMs: 17 },
  );
  await harness.context.fetchBeatPrefetchAudioUrl(
    { id: 2, mid: 'qq-mid', key: 'qq', provider: 'qq' },
    { quality: 'standard', timeoutMs: 19 },
  );
  await harness.context.fetchBeatPrefetchAudioUrl(
    { id: 3, key: 'legacy', provider: 'netease' },
    'standard',
  );

  assert.match(harness.lookupCalls[0].url, /^\/api\/song\/url/);
  assert.equal(harness.lookupCalls[0].options.timeoutMs, 17);
  assert.match(harness.lookupCalls[1].url, /^\/api\/qq\/song\/url/);
  assert.equal(harness.lookupCalls[1].options.timeoutMs, 19);
  assert.equal(harness.lookupCalls[2].options, undefined);
});

test('hung musical URL lookup times out and releases the next queue job', async () => {
  const harness = createMusicalQueueHarness({
    useRealAudioLookup: true,
    lookupTimeoutMs: 5,
    lookup: async (url, requestOptions, callCount) => callCount === 1
      ? new Promise(() => {})
      : { url: 'https://audio.test/recovered' },
  });
  const failed = harness.context.scheduleCuefieldMusicalProfile(
    { id: 1, key: 'hung' },
    'hung',
    queueMap(),
  );
  const recovered = harness.context.scheduleCuefieldMusicalProfile(
    { id: 2, key: 'next' },
    'next',
    queueMap(),
  );

  assert.equal(await failed, null);
  assert.equal((await recovered).noteCount, 4);
  assert.equal(harness.lookupCalls[0].options.timeoutMs, 5);
  assert.equal(harness.context.cuefieldMusicalAnalysisActive, false);
});

test('unknown-length musical stream aborts and cancels as soon as chunks cross the cap', async () => {
  let signal;
  let reads = 0;
  let cancels = 0;
  const chunks = [new Uint8Array(5), new Uint8Array(5), new Uint8Array(5)];
  const harness = createMusicalQueueHarness({
    maxAudioBytes: 8,
    fetch: async (url, requestOptions) => {
      signal = requestOptions.signal;
      return {
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: chunks[reads++] }),
            cancel: async () => { cancels += 1; },
          }),
        },
        arrayBuffer: async () => { throw new Error('stream fallback should not run'); },
      };
    },
  });

  assert.equal(await harness.context.scheduleCuefieldMusicalProfile({ key: 'stream-large' }, 'stream-large', queueMap()), null);
  assert.equal(reads, 2);
  assert.equal(cancels, 1);
  assert.equal(signal.aborted, true);
  assert.equal(harness.decodeJobs.length, 0);
});

test('bounded musical stream assembles chunks before decode', async () => {
  let index = 0;
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const harness = createMusicalQueueHarness({
    maxAudioBytes: 8,
    fetch: async () => ({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true },
          cancel: async () => {},
        }),
      },
      arrayBuffer: async () => { throw new Error('stream fallback should not run'); },
    }),
  });

  assert.equal((await harness.context.scheduleCuefieldMusicalProfile({ key: 'stream-ok' }, 'stream-ok', queueMap())).noteCount, 4);
  assert.equal(harness.decodeJobs[0].bytes.byteLength, 5);
});

test('musical stream timeout aborts and cancels the reader', async () => {
  let signal;
  let cancels = 0;
  const harness = createMusicalQueueHarness({
    fetchTimeoutMs: 5,
    fetch: async (url, requestOptions) => {
      signal = requestOptions.signal;
      return {
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => new Promise(() => {}),
            cancel: () => {
              cancels += 1;
              return new Promise(() => {});
            },
          }),
        },
      };
    },
  });

  assert.equal(await harness.context.scheduleCuefieldMusicalProfile({ key: 'stream-timeout' }, 'stream-timeout', queueMap()), null);
  assert.equal(signal.aborted, true);
  assert.equal(cancels, 1);
  assert.equal(harness.context.cuefieldMusicalAnalysisActive, false);
});

test('decode timeout closes its context and pumps the next musical job', async () => {
  const harness = createMusicalQueueHarness({
    decodeTimeoutMs: 5,
    decode: (job, callCount) => {
      if (callCount > 1) job.resolve();
    },
  });
  const failed = harness.context.scheduleCuefieldMusicalProfile({ key: 'stalled' }, 'stalled', queueMap());
  const recovered = harness.context.scheduleCuefieldMusicalProfile({ key: 'next' }, 'next', queueMap());

  assert.equal(await failed, null);
  assert.equal((await recovered).noteCount, 4);
  assert.equal(harness.closeCalls.length, 2);
  assert.equal(harness.context.cuefieldMusicalAnalysisActive, false);
  assert.deepEqual(Object.keys(harness.context.cuefieldMusicalAnalysisTasks), []);
  assert.deepEqual(Object.keys(harness.context.cuefieldMusicalDesiredTasks), []);
});

test('rejected musical analysis clears active state and task registry before draining the next job', async () => {
  const harness = createMusicalQueueHarness({
    analyze: async (sampled, callCount) => {
      if (callCount === 1) throw new Error('analysis failed');
      return { ok: true, profile: { noteCount: 4 } };
    },
  });
  const { context } = harness;
  const failed = context.scheduleCuefieldMusicalProfile({ key: 'a' }, 'a', queueMap());
  const recovered = context.scheduleCuefieldMusicalProfile({ key: 'b' }, 'b', queueMap());

  assert.equal(await failed, null);
  assert.equal((await recovered).noteCount, 4);
  assert.equal(context.cuefieldMusicalAnalysisActive, false);
  assert.equal(context.cuefieldMusicalAnalysisQueue.length, 0);
  assert.deepEqual(Object.keys(context.cuefieldMusicalAnalysisTasks), []);
  assert.deepEqual(Object.keys(context.cuefieldMusicalDesiredTasks), []);
});

test('matching musical window signature resolves without fetch, decode, or analysis', async () => {
  const harness = createMusicalQueueHarness();
  const { context } = harness;
  const existing = {
    noteCount: 4,
    windowSignature: 'transition-v1:100.000:0,20',
  };
  const map = { ...queueMap(), musicalProfile: existing };

  const result = await context.scheduleCuefieldMusicalProfile({ key: 'a' }, 'a', map, null, {
    structured: true,
    structureMap: map.structureMap,
  });

  assert.equal(result, existing);
  assert.deepEqual(harness.audioUrlCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(harness.decodeJobs.length, 0);
  assert.deepEqual(harness.analyzeCalls, []);
});

test('skipMusicalProfile avoids scheduling when ensure adopts currentBeatMap', async () => {
  const currentMap = queueMap();
  const harness = createEnsureBeatMapHarness({ currentBeatMap: currentMap });

  const ready = await harness.context.ensureCuefieldAutoMixBeatMap(
    harness.song,
    'selected',
    { currentIndex: 0, skipMusicalProfile: true },
  );

  assert.equal(ready, true);
  assert.equal(harness.context.beatMapCache.selected, currentMap);
  assert.deepEqual(harness.scheduleCalls, []);
  assert.equal(harness.diskWrites.length, 1);
});

test('skipMusicalProfile avoids scheduling when ensure reads a disk map', async () => {
  const diskMap = queueMap();
  const harness = createEnsureBeatMapHarness({ diskMap });

  const ready = await harness.context.ensureCuefieldAutoMixBeatMap(
    harness.song,
    'selected',
    { currentIndex: 1, skipMusicalProfile: true },
  );

  assert.equal(ready, true);
  assert.deepEqual(harness.diskReads, ['selected']);
  assert.deepEqual(harness.scheduleCalls, []);
});

test('beat analysis scheduling guard rejects prefetch musical profiling', () => {
  const source = read('public/index.html');
  const guardSource = sourceBlock(
    source,
    'function shouldScheduleCuefieldMusicalProfile',
    'async function analyzeAudioBeats',
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(guardSource, context);

  assert.equal(context.shouldScheduleCuefieldMusicalProfile('song:a', { prefetch: true }), false);
  assert.equal(context.shouldScheduleCuefieldMusicalProfile('song:a', { skipMusicalProfile: true }), false);
  assert.equal(context.shouldScheduleCuefieldMusicalProfile('', {}), false);
  assert.equal(context.shouldScheduleCuefieldMusicalProfile('song:a', {}), true);
});

test('successful structured analysis stores deterministic strategy and persists the updated map', async () => {
  const harness = createMusicalQueueHarness();
  const map = queueMap([5, 40]);

  const profile = await harness.context.scheduleCuefieldMusicalProfile(
    { key: 'selected', name: 'Selected' },
    'selected',
    map,
    null,
    { structured: true, structureMap: map.structureMap },
  );

  assert.equal(map.musicalProfile, profile);
  assert.equal(profile.windowStrategy, 'structure-v1');
  assert.equal(profile.windowSignature, 'transition-v1:100.000:5,40');
  assert.equal(harness.persistCalls.length, 1);
  assert.equal(harness.persistCalls[0][0], 'selected');
  assert.equal(harness.persistCalls[0][1], map);
  assert.equal(harness.persistCalls[0][1].musicalProfile, profile);
});

test('failed refined transition response returns and caches the initial usable plan', async () => {
  const source = read('public/index.html');
  const pairSource = sourceBlock(source, 'async function planCuefieldSongPair', 'function initCuefieldAutoMix');
  const initialPlan = {
    ok: true,
    chosen: { timeline: [{ op: 'handoff' }] },
    from: { structureMap: { entryCandidates: [{ time: 0 }] } },
    to: { structureMap: { entryCandidates: [{ time: 4 }] } },
  };
  const coarsePlan = { ok: true, coarse: true };
  const responses = [initialPlan, { ok: false, error: 'x' }];
  const context = {
    CUEFIELD_PAIR_PLAN_TTL_MS: 300000,
    CUEFIELD_MUSICAL_REFINEMENT_TIMEOUT_MS: 35000,
    cuefieldPairPlanCache: new Map([['a->b:coarse', { createdAt: Date.now(), plan: coarsePlan }]]),
    cuefieldRecentRecipes: [],
    beatMapCache: { a: queueMap(), b: queueMap() },
    beatMapSongKey: (song) => song.key,
    songProviderKey: () => 'test',
    apiJson: async () => responses.shift(),
    scheduleCuefieldMusicalProfile: async () => ({ noteCount: 4 }),
    window: {
      CuefieldLyricSource: {
        fetchRawLrc: async () => '',
      },
    },
    console: { warn() {} },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(pairSource, context);

  const result = await context.planCuefieldSongPair({ key: 'a' }, { key: 'b' }, { refineMusical: true });

  assert.equal(result, initialPlan);
  assert.equal(context.cuefieldPairPlanCache.get('a->b:refined:impact-open').plan, initialPlan);
  assert.equal(context.cuefieldPairPlanCache.get('a->b:coarse').plan, coarsePlan);
});

test('transition requests snapshot and bound recent recipes across refinement', async () => {
  const initialPlan = pairPlanFixture('initial-history');
  const refinedPlan = pairPlanFixture('refined-history');
  const harness = createPairFlowHarness([initialPlan, refinedPlan], {
    recentRecipes: ['older', 'tease-roll-double-drop'],
    schedule: async () => {
      harness.context.cuefieldRecentRecipes.splice(0, 2, 'normal-a', 'normal-b');
      return { noteCount: 4 };
    },
  });

  await harness.context.planCuefieldSongPair(
    harness.songs.from,
    harness.songs.to,
    { refineMusical: true },
  );

  assert.equal(harness.apiCalls.length, 2);
  harness.apiCalls.forEach((call) => {
    const body = JSON.parse(call.options.body);
    assert.deepEqual(body.recentRecipes, ['older', 'tease-roll-double-drop']);
    assert.equal(body.recentRecipes.length <= 2, true);
  });
  assert.equal(
    harness.context.cuefieldPairPlanCache.has('selected-from->selected-to:refined:impact-blocked'),
    true,
  );
});

test('pair plan cache separates impact-open and impact-blocked results', async () => {
  const harness = createPairFlowHarness([
    pairPlanFixture('impact-open'),
    pairPlanFixture('impact-blocked'),
  ]);

  await harness.context.planCuefieldSongPair(harness.songs.from, harness.songs.to, { refineMusical: false });
  harness.context.cuefieldRecentRecipes.push('tease-roll-double-drop');
  await harness.context.planCuefieldSongPair(harness.songs.from, harness.songs.to, { refineMusical: false });

  assert.equal(harness.apiCalls.length, 2);
  assert.equal(harness.context.cuefieldPairPlanCache.has('selected-from->selected-to:coarse:impact-open'), true);
  assert.equal(harness.context.cuefieldPairPlanCache.has('selected-from->selected-to:coarse:impact-blocked'), true);
});

test('successful handoff records the selected recipe while failed paths do not', async () => {
  const pending = {
    token: 17,
    currentIndex: 0,
    nextIndex: 1,
    executionMode: 'filtered-pickup',
    plan: {
      chosen: {
        transitionRecipe: 'tease-roll-double-drop',
        recipeCandidate: { recipe: 'fallback-recipe' },
        evaluation: { tier: 'usable' },
      },
    },
  };
  const successful = createHandoffHistoryHarness();
  await successful.executeCuefieldSoftHandoff(pending);
  await flushTasks();
  assert.deepEqual(successful.cuefieldRecentRecipes, ['tease-roll-double-drop']);

  for (const options of [{ playFailed: true }, { cancelled: true }, { preloadFailed: true }]) {
    const failed = createHandoffHistoryHarness(options);
    await failed.executeCuefieldSoftHandoff(pending);
    await flushTasks();
    assert.deepEqual(failed.cuefieldRecentRecipes, []);
  }
});

test('renderer recipe history is bounded and releases impact after two later successes', () => {
  const context = createHandoffHistoryHarness();

  context.rememberCuefieldRecipe('tease-roll-double-drop');
  assert.equal(context.cuefieldRecentRecipes.includes('tease-roll-double-drop'), true);
  context.rememberCuefieldRecipe('normal-a');
  assert.equal(context.cuefieldRecentRecipes.includes('tease-roll-double-drop'), true);
  context.rememberCuefieldRecipe('x'.repeat(120));

  assert.deepEqual(context.cuefieldRecentRecipes, ['normal-a', 'x'.repeat(80)]);
  assert.equal(context.cuefieldRecentRecipes.includes('tease-roll-double-drop'), false);
});

test('server bounds recent recipe identifiers before the bridge call', () => {
  const source = read('server.js');
  const route = sourceBlock(
    source,
    "if (pn === '/api/cuefield/transition')",
    "if (pn === '/api/cuefield/feedback')",
  );

  assert.match(route, /recentRecipes:\s*Array\.isArray\(body\.recentRecipes\)/);
  assert.match(route, /typeof recipe === 'string'/);
  assert.match(route, /slice\(0, 80\)/);
  assert.match(route, /slice\(-2\)/);
});

test('thrown refined transition request returns and caches the initial usable plan', async () => {
  const initialPlan = pairPlanFixture('initial-before-refine-error');
  let responseCount = 0;
  const harness = createPairFlowHarness({
    shift() {
      responseCount += 1;
      if (responseCount === 1) return initialPlan;
      throw new Error('refined transition failed');
    },
  });
  let result;

  await assert.doesNotReject(async () => {
    result = await harness.context.planCuefieldSongPair(
      harness.songs.from,
      harness.songs.to,
      { refineMusical: true },
    );
  });

  assert.equal(result, initialPlan);
  assert.equal(harness.apiCalls.length, 2);
  assert.equal(
    harness.context.cuefieldPairPlanCache.get('selected-from->selected-to:refined:impact-open').plan,
    initialPlan,
  );
});

test('refinement timeout returns the initial plan without populating refined cache', async () => {
  const initialPlan = pairPlanFixture('initial-before-refine-timeout');
  const harness = createPairFlowHarness([initialPlan], {
    refinementTimeoutMs: 5,
    recentRecipes: ['tease-roll-double-drop'],
    schedule: async () => new Promise(() => {}),
  });

  const result = await harness.context.planCuefieldSongPair(
    harness.songs.from,
    harness.songs.to,
    { refineMusical: true },
  );

  assert.equal(result, initialPlan);
  assert.equal(harness.apiCalls.length, 1);
  assert.equal(harness.context.cuefieldPairPlanCache.has('selected-from->selected-to:refined:impact-blocked'), false);
  assert.equal(
    harness.context.cuefieldPairPlanCache.get('selected-from->selected-to:coarse:impact-blocked').plan,
    initialPlan,
  );
});

test('smart candidate evaluation executes ensure with musical profiling skipped and plans only once', async () => {
  const initialPlan = pairPlanFixture('smart-coarse');
  const harness = createPairFlowHarness([initialPlan]);

  const result = await harness.context.cuefieldEvaluatePair(
    harness.songs.from,
    harness.songs.to,
    0,
    17,
  );

  assert.equal(result.plan, initialPlan);
  assert.equal(harness.apiCalls.length, 1);
  assert.equal(harness.apiCalls[0].url, '/api/cuefield/transition');
  assert.deepEqual(harness.structuredJobs, []);
  assert.equal(harness.context.cuefieldPairPlanCache.get('selected-from->selected-to:coarse:impact-open').plan, initialPlan);
});

test('final AutoMix plan schedules only selected structured pair and replans exactly once', async () => {
  const initialPlan = pairPlanFixture('initial');
  const refinedPlan = pairPlanFixture('refined');
  const harness = createPairFlowHarness([initialPlan, refinedPlan]);
  harness.context.initCuefieldAutoMix();

  const result = await harness.getAutoMixDeps().planTransition('ignored-from', 'ignored-to', {
    currentSong: harness.songs.from,
    nextSong: harness.songs.to,
  });

  assert.equal(result, refinedPlan);
  assert.equal(harness.apiCalls.length, 2);
  harness.apiCalls.forEach((call) => assert.equal(call.url, '/api/cuefield/transition'));
  assert.equal(harness.structuredJobs.length, 2);
  assert.deepEqual(harness.structuredJobs.map((job) => job.key), ['selected-from', 'selected-to']);
  assert.equal(harness.structuredJobs[0].song, harness.songs.from);
  assert.equal(harness.structuredJobs[1].song, harness.songs.to);
  assert.equal(harness.structuredJobs[0].map, harness.maps['selected-from']);
  assert.equal(harness.structuredJobs[1].map, harness.maps['selected-to']);
  assert.equal(harness.structuredJobs[0].options.structured, true);
  assert.equal(harness.structuredJobs[1].options.structured, true);
  assert.equal(harness.structuredJobs[0].options.structureMap, initialPlan.from.structureMap);
  assert.equal(harness.structuredJobs[1].options.structureMap, initialPlan.to.structureMap);
  assert.equal(harness.structuredJobs.some((job) => job.key === 'unrelated'), false);
});

test('renderer uses structure signatures and only profiles final pairs after the server plan', () => {
  const source = read('public/index.html');
  const profiles = source.slice(source.indexOf('function cuefieldMusicalSamplingPlan'), source.indexOf('function clearCuefieldAutoMixPrepareTimer'));
  assert.match(profiles, /CuefieldMusicalSampler\.selectTransitionWindowStarts\(structureMap, map\.duration, 4\)/);
  assert.match(profiles, /windowSignature/);
  assert.match(profiles, /windowStrategy/);
  assert.match(profiles, /existing\.windowSignature === sampling\.signature/);

  const analysis = source.slice(source.indexOf('async function analyzeAudioBeats'), source.indexOf('function localBeatRound'));
  assert.match(analysis, /shouldScheduleCuefieldMusicalProfile\(musicalKey, options\)/);

  const pairPlan = source.slice(source.indexOf('async function planCuefieldSongPair'), source.indexOf('function initCuefieldAutoMix'));
  assert.match(pairPlan, /refineMusical/);
  assert.match(pairPlan, /cacheKind/);
  assert.match(pairPlan, /applyCuefieldPlanStructure/);
  assert.match(pairPlan, /await Promise\.all\(\[/);
  assert.match(pairPlan, /postCuefieldTransition/);
  assert.equal((pairPlan.match(/postCuefieldTransition\(\)/g) || []).length, 2);

  const evaluate = source.slice(source.indexOf('async function cuefieldEvaluatePair'), source.indexOf('function cuefieldEvaluateWithinBudget'));
  assert.match(evaluate, /skipMusicalProfile:\s*true/);
  assert.match(evaluate, /refineMusical:\s*false/);

  const init = source.slice(source.indexOf('function initCuefieldAutoMix'), source.indexOf('function cuefieldFeedbackSongMeta'));
  assert.match(init, /refineMusical:\s*true/);
});

test('worker exposes bounded musical fields for each analyzed window', () => {
  const source = read('desktop/cuefield-musical-worker.js');
  assert.match(source, /noteDensity:\s*profile\.noteDensity/);
  assert.match(source, /pitchRange:\s*profile\.pitchRange/);
  assert.match(source, /start:\s*Number\(starts\[index\]\)\s*\|\|\s*0/);
  assert.match(source, /duration:\s*segment\.length\s*\/\s*payload\.sampleRate/);
  assert.match(source, /confidence:\s*profile\.confidence/);
  assert.match(source, /noteCount:\s*profile\.noteCount/);
  assert.match(source, /pitchClassProfile:\s*profile\.pitchClassProfile/);
  assert.match(source, /key:\s*profile\.key/);
  assert.match(source, /intervalProfile:\s*profile\.intervalProfile/);
  assert.doesNotMatch(source, /windows\.push\(\{[\s\S]*?notes\s*:/);
});

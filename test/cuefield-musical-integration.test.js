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
  const queueSource = sourceBlock(
    source,
    'var cuefieldMusicalAnalysisTasks = {};',
    'function clearCuefieldAutoMixPrepareTimer',
  );
  const decodeJobs = [];
  const audioUrlCalls = [];
  const fetchCalls = [];
  const analyzeCalls = [];
  const context = {
    beatMapCache: {},
    console: { log() {}, warn() {} },
    fetchBeatPrefetchAudioUrl: async (song) => {
      audioUrlCalls.push(song.key);
      return `/audio/${song.key}`;
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    writeBeatDiskCache: async () => true,
  };
  class AudioContextStub {
    decodeAudioData(bytes, resolve, reject) {
      const job = { resolve: () => resolve({ duration: 100 }), reject };
      decodeJobs.push(job);
      if (!options.holdDecode) job.resolve();
    }
    close() {}
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
  vm.createContext(context);
  vm.runInContext(`var CUEFIELD_MUSICAL_QUEUE_LIMIT = 4;\n${queueSource}`, context);
  return { context, decodeJobs, audioUrlCalls, fetchCalls, analyzeCalls };
}

function createPairFlowHarness(responses) {
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
    beatMapCache: maps,
    beatMapSongKey: (song) => song && song.key || '',
    songProviderKey: () => 'test',
    apiJson: async (url, options) => {
      apiCalls.push({ url, options });
      return responses.shift();
    },
    scheduleCuefieldMusicalProfile: async (song, key, map, decodedBuffer, options) => {
      structuredJobs.push({ song, key, map, decodedBuffer, options });
      return { noteCount: 4 };
    },
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
    cuefieldPairPlanCache: new Map([['a->b:coarse', { createdAt: Date.now(), plan: coarsePlan }]]),
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
  };
  vm.createContext(context);
  vm.runInContext(pairSource, context);

  const result = await context.planCuefieldSongPair({ key: 'a' }, { key: 'b' }, { refineMusical: true });

  assert.equal(result, initialPlan);
  assert.equal(context.cuefieldPairPlanCache.get('a->b:refined').plan, initialPlan);
  assert.equal(context.cuefieldPairPlanCache.get('a->b:coarse').plan, coarsePlan);
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
  assert.equal(harness.context.cuefieldPairPlanCache.get('selected-from->selected-to:coarse').plan, initialPlan);
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
  assert.match(analysis, /!options\.prefetch/);
  assert.match(analysis, /skipMusicalProfile/);

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

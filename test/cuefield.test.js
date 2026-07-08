const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeMineradioBeatMap } = require('../cuefield/adapter-mineradio');
const { planTransition } = require('../cuefield/plan-transition');
const { planTransitionFromPayload } = require('../cuefield/api');
const {
  discoverAudioFiles,
  analyzeAudioFileToFixture,
  evaluateFixturePairs,
} = require('../cuefield/fixtures');
const {
  decodeNcmFile,
  inferAudioExtension,
} = require('../cuefield/decode-ncm');
const {
  buildFullSimulationPlan,
  buildPreviewPlan,
  buildFfmpegArgs,
  parseEvalRow,
} = require('../cuefield/render-preview');
const { buildSectionContext } = require('../cuefield/render-preview-inputs');
const {
  findHookEntry,
  findOutgoingPhrase,
  findSectionEntry,
  findSectionEntries,
  parseLrc,
} = require('../cuefield/lrc-anchors');
const {
  analyzeSectionCandidates,
  chooseTransitionCandidates,
} = require('../cuefield/section-candidates');
const { evaluateTransitionPair } = require('../cuefield/transition-evaluator');

function makeBeatMap(opts = {}) {
  const gridStep = opts.gridStep || 0.5;
  const duration = opts.duration || 96;
  const phraseEveryBeats = opts.phraseEveryBeats || 16;
  const beats = [];
  for (let i = 0, t = 0; t < duration - 0.001; i++, t += gridStep) {
    const phrase = i % phraseEveryBeats === 0;
    const low = typeof opts.low === 'function' ? opts.low(t, i) : (opts.low ?? 0.32);
    const body = typeof opts.body === 'function' ? opts.body(t, i) : (opts.body ?? 0.34);
    const snap = typeof opts.snap === 'function' ? opts.snap(t, i) : (opts.snap ?? 0.24);
    beats.push({
      time: Number(t.toFixed(3)),
      strength: phrase ? 0.92 : 0.68,
      confidence: 0.95,
      impact: phrase ? 0.62 : 0.36,
      camera: true,
      pulse: phrase || i % 4 === 0,
      low,
      body,
      snap,
      combo: phrase ? 'downbeat' : (i % 4 === 0 ? 'accent' : 'push'),
      step: gridStep,
    });
  }
  return {
    duration,
    gridStep,
    beats,
    cameraBeats: beats,
    pulseBeats: beats.filter((b) => b.pulse),
    visualBeatCount: beats.length,
    tempoSource: 'test',
  };
}

function normalize(title, map, extra = {}) {
  return normalizeMineradioBeatMap(
    { title, artist: 'Fixture Artist', duration: map.duration },
    map,
    extra,
  );
}

test('normalizes Mineradio beatmap into Cuefield analysis', () => {
  const analysis = normalize('Track A', makeBeatMap(), { camelot: '8A', vocalWindows: [] });

  assert.equal(analysis.track.title, 'Track A');
  assert.equal(analysis.analysis.source, 'mineradio');
  assert.equal(analysis.analysis.beats.length > 20, true);
  assert.equal(analysis.analysis.downbeats.length > 4, true);
  assert.equal(Math.round(analysis.analysis.bpm), 120);
  assert.equal(analysis.analysis.hasVocalData, true);
  assert.equal(analysis.analysis.hasKeyData, true);
});

test('scores a clean phrase-aligned compatible transition above 0.95', () => {
  const from = normalize('Warm Track', makeBeatMap({
    low: (t) => (t >= 60 && t <= 72 ? 0.22 : 0.34),
    body: 0.34,
    snap: 0.24,
  }), { camelot: '8A', vocalWindows: [] });
  const to = normalize('Incoming Track', makeBeatMap({
    low: (t) => (t >= 16 && t <= 28 ? 0.26 : 0.30),
    body: 0.35,
    snap: 0.25,
  }), { camelot: '8A', vocalWindows: [] });

  const plan = planTransition(from, to);

  assert.equal(plan.grade, 'high-confidence');
  assert.equal(plan.score >= 0.95, true, JSON.stringify(plan));
  assert.equal([8, 16, 32].includes(plan.transitionBars), true);
  assert.equal(plan.exitPoint >= 56, true);
  assert.equal(plan.entryPoint <= 32, true);
  assert.equal(plan.risks.length, 0);
});

test('caps score when key or vocal data is missing', () => {
  const from = normalize('Unknown A', makeBeatMap());
  const to = normalize('Unknown B', makeBeatMap());

  const plan = planTransition(from, to);

  assert.equal(plan.score <= 0.85, true, JSON.stringify(plan));
  assert.equal(plan.grade, 'usable');
  assert.equal(plan.risks.includes('key data unavailable'), true);
  assert.equal(plan.risks.includes('vocal density unavailable'), true);
});

test('rejects transitions with vocal collision', () => {
  const from = normalize('Vocal A', makeBeatMap(), {
    camelot: '8A',
    vocalWindows: [{ start: 56, end: 88 }],
  });
  const to = normalize('Vocal B', makeBeatMap(), {
    camelot: '8A',
    vocalWindows: [{ start: 0, end: 40 }],
  });

  const plan = planTransition(from, to);

  assert.equal(plan.grade, 'rejected');
  assert.equal(plan.score, 0);
  assert.equal(plan.vetoes.includes('vocal collision'), true);
});

test('rejects transitions with bass clash', () => {
  const from = normalize('Bass A', makeBeatMap({ low: (t) => (t >= 56 && t <= 88 ? 0.92 : 0.32) }), {
    camelot: '8A',
    vocalWindows: [],
  });
  const to = normalize('Bass B', makeBeatMap({ low: (t) => (t >= 0 && t <= 40 ? 0.95 : 0.30) }), {
    camelot: '8A',
    vocalWindows: [],
  });

  const plan = planTransition(from, to);

  assert.equal(plan.grade, 'rejected');
  assert.equal(plan.score, 0);
  assert.equal(plan.vetoes.includes('bass clash'), true);
});

test('plans a transition from Mineradio API payload', () => {
  const fromMap = makeBeatMap({
    low: (t) => (t >= 60 && t <= 72 ? 0.22 : 0.34),
  });
  const toMap = makeBeatMap({
    low: (t) => (t >= 16 && t <= 28 ? 0.26 : 0.30),
  });

  const response = planTransitionFromPayload({
    from: {
      track: { id: 'a', title: 'Warm Track', artist: 'Fixture Artist', duration: fromMap.duration },
      map: fromMap,
      extra: { camelot: '8A', vocalWindows: [] },
    },
    to: {
      track: { id: 'b', title: 'Incoming Track', artist: 'Fixture Artist', duration: toMap.duration },
      map: toMap,
      extra: { camelot: '8A', vocalWindows: [] },
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.plan.grade, 'high-confidence');
  assert.equal(response.plan.score >= 0.95, true, JSON.stringify(response.plan));
  assert.equal(response.plan.from.title, 'Warm Track');
  assert.equal(response.plan.to.title, 'Incoming Track');
});

test('discovers mp3 files for local fixture analysis', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-audio-'));
  fs.writeFileSync(path.join(dir, 'A Song.mp3'), '');
  fs.writeFileSync(path.join(dir, 'ignore.m4a'), '');
  fs.mkdirSync(path.join(dir, 'nested'));
  fs.writeFileSync(path.join(dir, 'nested', 'B Song.MP3'), '');

  const files = discoverAudioFiles(dir).map((file) => path.basename(file));

  assert.deepEqual(files, ['A Song.mp3', 'B Song.MP3']);
});

test('writes a fixture from a local audio file using an injected analyzer', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-fixture-'));
  const audio = path.join(root, 'Warm Track.mp3');
  const outDir = path.join(root, 'fixtures');
  fs.writeFileSync(audio, 'fake mp3 bytes');

  const result = await analyzeAudioFileToFixture(audio, outDir, {
    analyzer: async (url) => {
      assert.equal(url.startsWith('http://127.0.0.1:'), true);
      return makeBeatMap();
    },
  });

  assert.equal(result.fixture.track.title, 'Warm Track');
  assert.equal(result.fixture.map.visualBeatCount > 20, true);
  assert.equal(fs.existsSync(result.file), true);
});

test('evaluates ordered fixture pairs and sorts by score', () => {
  const fixtures = [
    { track: { id: 'a', title: 'A', duration: 96 }, map: makeBeatMap(), extra: { camelot: '8A', vocalWindows: [] } },
    { track: { id: 'b', title: 'B', duration: 96 }, map: makeBeatMap(), extra: { camelot: '8A', vocalWindows: [] } },
    { track: { id: 'c', title: 'C', duration: 96 }, map: makeBeatMap(), extra: { camelot: '2B', vocalWindows: [] } },
  ];

  const rows = evaluateFixturePairs(fixtures);

  assert.equal(rows.length, 6);
  assert.equal(rows[0].from !== rows[0].to, true);
  assert.equal(rows[0].score >= rows[rows.length - 1].score, true);
  assert.equal(rows.some((row) => row.grade === 'high-confidence'), true);
});

test('packages Cuefield modules with the Electron app', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.files.includes('cuefield/**/*'), true);
});

test('infers decoded ncm audio extension from magic bytes', () => {
  assert.equal(inferAudioExtension(Buffer.from('ID3\u0004\u0000\u0000')), '.mp3');
  assert.equal(inferAudioExtension(Buffer.from([0xff, 0xfb, 0x90, 0x64])), '.mp3');
  assert.equal(inferAudioExtension(Buffer.from('fLaC\u0000\u0000')), '.flac');
  assert.equal(inferAudioExtension(Buffer.from('????')), '.bin');
});

test('rejects non-ncm files before decoding', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-ncm-'));
  const file = path.join(dir, 'not-ncm.ncm');
  fs.writeFileSync(file, 'not an ncm file');

  assert.throws(() => decodeNcmFile(file, dir), /INVALID_NCM_MAGIC/);
});

test('parses an eval row for preview rendering', () => {
  const row = parseEvalRow('0.850\tusable\tA Song\tB Song\t157.4\t12.15\t16\tkey data unavailable|vocal density unavailable\t');

  assert.equal(row.score, 0.85);
  assert.equal(row.from, 'A Song');
  assert.equal(row.to, 'B Song');
  assert.equal(row.exitPoint, 157.4);
  assert.equal(row.entryPoint, 12.15);
  assert.equal(row.transitionBars, 16);
  assert.deepEqual(row.risks, ['key data unavailable', 'vocal density unavailable']);
});

test('builds auto section choice context from fixtures and lrc files', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const lrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuefield-lrc-'));
  fs.writeFileSync(path.join(lrcDir, 'A.lrc'), `
[01:20.000] peak line
[01:50.000] final release
`);
  fs.writeFileSync(path.join(lrcDir, 'B.lrc'), `
[00:36.000] hands up
[00:44.000] turn the bass up
[01:20.000] turn the bass up
`);

  const context = buildSectionContext({
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8 },
    fromFixture: {
      track: { title: 'A', duration: 128 },
      map: makeBeatMap({
        duration: 128,
        low: (t) => (t >= 80 && t < 96 ? 0.86 : (t >= 112 ? 0.34 : 0.42)),
        body: (t) => (t >= 80 && t < 96 ? 0.80 : (t >= 112 ? 0.3 : 0.38)),
        snap: (t) => (t >= 80 && t < 96 ? 0.72 : (t >= 112 ? 0.24 : 0.32)),
      }),
    },
    toFixture: {
      track: { title: 'B', duration: 128 },
      map: makeBeatMap({
        duration: 128,
        low: (t) => (t >= 44 && t < 64 ? 0.84 : 0.36),
        body: (t) => (t >= 44 && t < 64 ? 0.78 : 0.34),
        snap: (t) => (t >= 44 && t < 64 ? 0.7 : 0.28),
      }),
    },
    lrcDir,
    autoSections: true,
  });

  assert.equal(context.sectionChoice.recipe, 'outro-to-chorus');
  assert.equal(context.sectionChoice.exit.role, 'exit');
  assert.equal(context.sectionChoice.entry.type, 'pre-section');
  assert.equal(context.sectionChoice.entry.resolvesTo.text, 'turn the bass up');
});

test('can bias transition candidate choice toward a late outro exit', () => {
  const fromAnalysis = {
    duration: 284,
    candidates: [
      { type: 'release', role: 'exit', time: 168, confidence: 0.58, energyBefore: 0.57, energyAfter: 0.52 },
      { type: 'outro', role: 'exit', time: 250.657, confidence: 0.62, energyBefore: 0.58, energyAfter: 0.59 },
      { type: 'outro', role: 'exit', time: 268.604, confidence: 0.58, energyBefore: 0.57, energyAfter: 0.57 },
      { type: 'peak', role: 'avoid-exit', time: 0, confidence: 0.81 },
    ],
  };
  const toAnalysis = {
    duration: 140,
    candidates: [
      {
        type: 'pre-section',
        role: 'entry',
        time: 1.725,
        confidence: 0.85,
        resolvesTo: { type: 'hook', time: 3.538, text: 'falling in love is too easy' },
      },
    ],
  };

  const balanced = chooseTransitionCandidates(fromAnalysis, toAnalysis);
  const late = chooseTransitionCandidates(fromAnalysis, toAnalysis, { exitBias: 'late' });

  assert.equal(balanced.exit.time, 168);
  assert.equal(late.exit.type, 'outro');
  assert.equal(late.exit.time >= 250, true, JSON.stringify(late));
});

test('recognizes lyric handoff when an outgoing phrase answers into the next pickup', () => {
  const evaluation = evaluateTransitionPair({
    exit: {
      type: 'outro',
      role: 'exit',
      time: 217.6,
      confidence: 0.62,
      text: 'Help me to break through',
      energyAfter: 0.543,
      lowDensity: 0.543,
    },
    entry: {
      type: 'pre-section',
      role: 'entry',
      time: 2.82,
      confidence: 0.64,
      text: 'Take me to...',
      resolvesTo: { type: 'chorus', time: 6.035, text: 'the moon where we both fell in love...' },
      energyAfter: 0.538,
      lowDensity: 0.538,
    },
  });

  assert.equal(evaluation.recipe, 'lyric-handoff');
  assert.equal(evaluation.dimensions.lyricHandoff >= 0.75, true, JSON.stringify(evaluation));
  assert.equal(evaluation.dimensions.pairCompatibility >= 0.8, true, JSON.stringify(evaluation));
  assert.equal(evaluation.reasons.includes('lyric handoff'), true);
});

test('prefers lyric handoff exits over nearby anonymous release points', () => {
  const fromAnalysis = {
    duration: 236,
    candidates: [
      {
        type: 'release',
        role: 'exit',
        time: 220,
        confidence: 0.571,
        energyBefore: 0.578,
        energyAfter: 0.53,
        lowDensity: 0.53,
      },
      {
        type: 'outro',
        role: 'exit',
        time: 217.6,
        confidence: 0.62,
        text: 'Help me to break through',
        energyBefore: 0.587,
        energyAfter: 0.543,
        lowDensity: 0.543,
      },
    ],
  };
  const toAnalysis = {
    duration: 129,
    candidates: [
      {
        type: 'pre-section',
        role: 'entry',
        time: 2.82,
        confidence: 0.64,
        text: 'Take me to...',
        resolvesTo: { type: 'chorus', time: 6.035, text: 'the moon where we both fell in love...' },
        energyAfter: 0.538,
        lowDensity: 0.538,
      },
    ],
  };

  const chosen = chooseTransitionCandidates(fromAnalysis, toAnalysis);

  assert.equal(chosen.recipe, 'lyric-handoff');
  assert.equal(chosen.exit.text, 'Help me to break through');
  assert.equal(chosen.evaluation.reasons.includes('lyric handoff'), true);
});

test('penalizes closed outgoing catchphrases even when they are late outro candidates', () => {
  const evaluation = evaluateTransitionPair({
    exit: {
      type: 'outro',
      role: 'exit',
      time: 193.48,
      confidence: 0.62,
      text: "I said hey, what's going on",
      energyAfter: 0.524,
      lowDensity: 0.524,
    },
    entry: {
      type: 'pre-section',
      role: 'entry',
      time: 21.01,
      confidence: 0.85,
      text: "Yeah, I'm built different",
      resolvesTo: { type: 'chorus', time: 22.515, text: 'I just took a turn' },
      energyAfter: 0.674,
      lowDensity: 0.674,
    },
  });

  assert.equal(evaluation.dimensions.exitSuitability < 0.5, true, JSON.stringify(evaluation));
  assert.equal(evaluation.score < 0.75, true, JSON.stringify(evaluation));
  assert.equal(evaluation.risks.includes('closed outgoing phrase'), true);
});

test('does not bypass a closed outgoing phrase by choosing a nearby anonymous outro', () => {
  const fromAnalysis = {
    duration: 204,
    candidates: [
      {
        type: 'outro',
        role: 'exit',
        time: 188.384,
        confidence: 0.58,
        energyBefore: 0.573,
        energyAfter: 0.521,
        lowDensity: 0.521,
      },
      {
        type: 'outro',
        role: 'exit',
        time: 193.48,
        confidence: 0.62,
        text: "I said hey, what's going on",
        energyBefore: 0.527,
        energyAfter: 0.524,
        lowDensity: 0.524,
      },
    ],
  };
  const toAnalysis = {
    duration: 169,
    candidates: [
      {
        type: 'pre-section',
        role: 'entry',
        time: 21.01,
        confidence: 0.85,
        text: "Yeah, I'm built different",
        resolvesTo: { type: 'chorus', time: 22.515, text: 'I just took a turn' },
        energyAfter: 0.674,
        lowDensity: 0.674,
      },
    ],
  };

  const chosen = chooseTransitionCandidates(fromAnalysis, toAnalysis);

  assert.equal(chosen.score <= 0.74, true, JSON.stringify(chosen));
  assert.equal(
    chosen.evaluation.risks.includes('closed outgoing phrase')
      || chosen.evaluation.risks.includes('near closed outgoing phrase'),
    true,
    JSON.stringify(chosen),
  );
});

test('classifies instrumental outro into vocal hook as a stable recipe', () => {
  const evaluation = evaluateTransitionPair({
    exit: {
      type: 'outro',
      role: 'exit',
      time: 252.251,
      confidence: 0.58,
      energyAfter: 0.522,
      lowDensity: 0.522,
    },
    entry: {
      type: 'pre-section',
      role: 'entry',
      time: 50.2,
      confidence: 0.78,
      text: '好一朵美丽的茉莉花',
      resolvesTo: { type: 'hook', time: 56.08, text: '好一朵美丽的茉莉花' },
      energyAfter: 0.546,
      lowDensity: 0.546,
    },
  });

  assert.equal(evaluation.recipe, 'instrumental-outro-to-vocal-hook');
  assert.equal(evaluation.dimensions.entryPromise >= 0.75, true, JSON.stringify(evaluation));
  assert.equal(evaluation.score >= 0.8, true, JSON.stringify(evaluation));
});

test('finds repeated hook entries from lrc instead of defaulting to intro', () => {
  const lines = parseLrc(`
{"t":-1000,"c":[{"tx":"作词: someone"}]}
[00:00.000] falling in love is too easy
[00:12.000] verse line one
[00:28.000] verse line two
[00:58.373] falling in love is too easy
[01:53.176] falling in love is too easy
`);

  const hook = findHookEntry(lines, { preferAfter: 30 });

  assert.equal(hook.text, 'falling in love is too easy');
  assert.equal(hook.time, 58.373);
  assert.equal(hook.kind, 'hook');
});

test('finds a repeated section entry without assuming it must be a hook', () => {
  const lines = parseLrc(`
[00:00.000] intro
[00:20.000] build line
[00:43.000] tonight
[00:44.000] tonight
[01:30.000] tonight
`);

  const entry = findSectionEntry(lines, { preferAfter: 30 });

  assert.equal(entry.text, 'tonight');
  assert.equal(entry.time, 43);
  assert.equal(entry.kind, 'section-entry');
  assert.equal(entry.sectionType, 'repeated-vocal');
});

test('lists repeated vocal and pre-section candidates for the next track', () => {
  const lines = parseLrc(`
[00:00.000] intro
[00:20.000] build line
[00:31.000] hands up
[00:43.000] tonight
[01:30.000] tonight
`);

  const candidates = findSectionEntries(lines, { preferAfter: 30 });

  assert.equal(candidates.some((candidate) => candidate.sectionType === 'repeated-vocal' && candidate.time === 43), true);
  assert.equal(candidates.some((candidate) => candidate.sectionType === 'pre-section' && candidate.time === 31), true);
});

test('finds outgoing phrase before the planned exit point', () => {
  const lines = parseLrc(`
[03:54.463] Call me mystery
[03:57.997] I mystify
[04:01.358] Don't be feel die
[04:04.756] I mystify
[04:08.636] Call me mystery
`);

  const phrase = findOutgoingPhrase(lines, { before: 248, maxLookback: 18 });

  assert.equal(phrase.text, 'I mystify');
  assert.equal(phrase.time, 244.756);
  assert.equal(phrase.kind, 'outgoing-phrase');
});

test('builds a bass-swap preview plan that prevents full bass overlap', () => {
  const plan = buildPreviewPlan({
    mode: 'bass-swap',
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8, transitionBars: 16 },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  assert.equal(plan.mode, 'bass-swap');
  assert.equal(plan.recipe.style, 'Bass Swap / Downbeat Cut');
  assert.equal(plan.recipe.layer, 'transition-engine-preview');
  assert.equal(plan.segments.length, 4);
  assert.equal(plan.segments[1].from.filter, 'full');
  assert.equal(plan.segments[1].to.filter, 'highpass');
  assert.equal(plan.segments[2].from.filter, 'full');
  assert.equal(plan.segments[2].to.filter, 'full');
  assert.equal(plan.segments.every((segment) => (
    !(segment.from && segment.to && segment.from.filter === 'full' && segment.to.filter === 'full')
    || segment.duration <= plan.gridStep
  )), true);
});

test('keeps bass-swap teaser and outgoing tail clean', () => {
  const plan = buildPreviewPlan({
    mode: 'bass-swap',
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8, transitionBars: 16 },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  assert.equal(plan.segments[1].from.volume >= 0.94, true);
  assert.equal(plan.segments[1].to.volume <= 0.32, true);
  assert.equal(plan.segments[1].to.highpassHz >= 320, true);
  assert.equal(plan.segments[2].from.filter, 'full');
  assert.equal(plan.segments[2].from.volume <= 0.45, true);
  assert.equal(plan.segments[2].from.fadeOut <= plan.gridStep, true);
  assert.equal(plan.segments[2].duration <= plan.gridStep, true);
});

test('builds a section-jump preview that jumps B into a high-value section anchor', () => {
  const plan = buildPreviewPlan({
    mode: 'section-jump',
    row: { from: 'A', to: 'B', exitPoint: 244, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      fromExitPhrase: { time: 236, text: 'last phrase' },
      toSectionEntry: { time: 58.373, text: 'falling in love is too easy', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  assert.equal(plan.mode, 'section-jump');
  assert.equal(plan.recipe.style, 'Section Jump');
  const pickup = plan.segments.find((segment) => segment.label === 'A outgoing phrase bridge under B section pickup');
  const cleanPickup = plan.segments.find((segment) => segment.label === 'B clean section pickup');
  const cut = plan.segments.find((segment) => segment.label === 'B section downbeat cut');
  const takeover = plan.segments.find((segment) => segment.label === 'B section takes over');
  assert.equal(Boolean(pickup && cleanPickup && cut && takeover), true);
  assert.equal(pickup.to.start, 58.373);
  assert.equal(cleanPickup.from, null);
  assert.equal(cleanPickup.to.start, 58.373 + pickup.duration);
  assert.equal(takeover.to.start, 58.373 + pickup.duration + cleanPickup.duration + cut.duration);
  assert.equal(pickup.from.filter, 'full');
  assert.equal(pickup.from.fadeOut > 0, true);
  assert.equal(cut.from, null);
  assert.equal(takeover.to.role, 'section-entry');
});

test('builds a section preview from chosen section candidates without manual anchors', () => {
  const plan = buildPreviewPlan({
    mode: 'section-jump',
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8, transitionBars: 16 },
    sectionChoice: {
      recipe: 'outro-to-chorus',
      score: 0.96,
      exit: { type: 'outro', role: 'exit', time: 110.096, text: 'so alive' },
      entry: {
        type: 'pre-section',
        role: 'entry',
        time: 43.626,
        text: '[Chorus]',
        resolvesTo: { type: 'chorus', time: 44.823, text: 'Turn the bass up' },
      },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5, duration: 128 }), track: { title: 'A', duration: 128 } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5, duration: 128 }), track: { title: 'B', duration: 128 } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const pickup = plan.segments.find((segment) => segment.label === 'A outgoing phrase bridge under B section pickup');
  const cut = plan.segments.find((segment) => segment.label === 'B section downbeat cut');

  assert.equal(plan.recipe.style, 'Outro to Chorus');
  assert.equal(plan.sectionChoice.recipe, 'outro-to-chorus');
  assert.equal(pickup.from.start, 110.096);
  assert.equal(pickup.to.start, 40.823);
  assert.equal(cut.to.start, 44.823);
});

test('delays section-jump exit when the planned point would cut off an upcoming A peak', () => {
  const fromMap = makeBeatMap({
    duration: 128,
    gridStep: 0.5,
    low: (t) => (t >= 80 && t <= 88 ? 0.95 : 0.32),
    body: (t) => (t >= 80 && t <= 88 ? 0.82 : 0.26),
    snap: (t) => (t >= 80 && t <= 88 ? 0.72 : 0.22),
  });
  const plan = buildPreviewPlan({
    mode: 'section-jump',
    row: { from: 'A', to: 'B', exitPoint: 68, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      toSectionEntry: { time: 42, text: 'incoming section', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: fromMap, track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const pickup = plan.segments.find((segment) => segment.label === 'A outgoing phrase bridge under B section pickup');
  const leadIn = plan.segments.find((segment) => segment.label === 'A phrase before section jump');
  assert.equal(pickup.from.start > 88, true, JSON.stringify(plan.segments));
  assert.equal(leadIn.from.start + leadIn.duration, pickup.from.start);
});

test('builds a section-filter-push preview with stronger filtered pickup', () => {
  const plan = buildPreviewPlan({
    mode: 'section-filter-push',
    row: { from: 'A', to: 'B', exitPoint: 96, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      toSectionEntry: { time: 42, text: 'incoming section', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const pickup = plan.segments.find((segment) => segment.label === 'A outgoing phrase bridge under B section pickup');
  const cleanPickup = plan.segments.find((segment) => segment.label === 'B clean section pickup');
  const cut = plan.segments.find((segment) => segment.label === 'B section downbeat cut');

  assert.equal(plan.recipe.style, 'Section Filter Push');
  assert.equal(pickup.from.volume < 0.58, true);
  assert.equal(pickup.to.highpassHz >= 320, true);
  assert.equal(cleanPickup.to.highpassHz >= 240, true);
  assert.equal(cut.to.effect, undefined);
});

test('builds a section-stutter-pickup preview with repeated B-only pickup slices', () => {
  const plan = buildPreviewPlan({
    mode: 'section-stutter-pickup',
    row: { from: 'A', to: 'B', exitPoint: 96, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      toSectionEntry: { time: 42, text: 'incoming section', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const stutters = plan.segments.filter((segment) => segment.label === 'B stutter pickup');
  const cut = plan.segments.find((segment) => segment.label === 'B section downbeat cut');

  assert.equal(plan.recipe.style, 'Section Stutter Pickup');
  assert.equal(stutters.length, 2);
  assert.equal(stutters.every((segment) => !segment.from && segment.to.role === 'section-stutter'), true);
  assert.equal(stutters[0].to.start, stutters[1].to.start);
  assert.equal(cut.to.start > stutters[1].to.start, true);
});

test('builds a section-hard-stutter preview with four short repeated B cue taps', () => {
  const plan = buildPreviewPlan({
    mode: 'section-hard-stutter',
    row: { from: 'A', to: 'B', exitPoint: 96, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      toSectionEntry: { time: 42, text: 'incoming section', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const bridge = plan.segments.find((segment) => segment.label === 'A outgoing phrase bridge under B section pickup');
  const stutters = plan.segments.filter((segment) => segment.label === 'B hard stutter cue tap');
  const cut = plan.segments.find((segment) => segment.label === 'B section downbeat cut');

  assert.equal(plan.recipe.style, 'Section Hard Stutter');
  assert.equal(stutters.length, 4);
  assert.equal(stutters.every((segment) => segment.duration < plan.gridStep), true);
  assert.equal(stutters.every((segment) => !segment.from && segment.to.role === 'section-hard-stutter'), true);
  assert.equal(stutters.every((segment) => segment.to.start === stutters[0].to.start), true);
  assert.equal(stutters[0].to.volume < stutters[3].to.volume, true);
  assert.equal(stutters[0].to.highpassHz > stutters[3].to.highpassHz, true);
  assert.equal(cut.to.start, 42 + bridge.duration + stutters.reduce((sum, segment) => sum + segment.duration, 0));
});

test('builds a full simulation plan from the start of A to the end of B', () => {
  const plan = buildFullSimulationPlan({
    mode: 'section-jump',
    row: { from: 'A', to: 'B', exitPoint: 96, entryPoint: 8, transitionBars: 16 },
    sectionAnchors: {
      fromExitPhrase: { time: 88, text: 'last outgoing phrase' },
      toSectionEntry: { time: 42, text: 'incoming section', sectionType: 'repeated-vocal' },
    },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5, duration: 128 }), track: { title: 'A', duration: 128 } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5, duration: 140 }), track: { title: 'B', duration: 140 } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const first = plan.segments[0];
  const last = plan.segments[plan.segments.length - 1];

  assert.equal(plan.fullSimulation, true);
  assert.equal(first.label, 'A plays from start before transition');
  assert.equal(first.from.start, 0);
  assert.equal(first.duration, 80);
  assert.equal(last.label, 'B section takes over and plays to end');
  assert.equal(last.to.start + last.duration, 140);
  assert.equal(plan.recipe.style, 'Section Jump Full Simulation');
});

test('analyzes peak and release candidates without treating the peak as an exit', () => {
  const map = makeBeatMap({
    duration: 128,
    gridStep: 0.5,
    low: (t) => (t >= 80 && t < 96 ? 0.88 : (t >= 108 ? 0.34 : 0.42)),
    body: (t) => (t >= 80 && t < 96 ? 0.82 : (t >= 108 ? 0.30 : 0.38)),
    snap: (t) => (t >= 80 && t < 96 ? 0.72 : (t >= 108 ? 0.24 : 0.32)),
  });

  const result = analyzeSectionCandidates({
    fixture: { track: { title: 'A', duration: 128 }, map },
    lrcLines: parseLrc(`
[01:20.000] chorus line
[01:28.000] chorus line
[01:49.000] outro word
`),
  });

  const peak = result.candidates.find((candidate) => candidate.type === 'peak');
  const release = result.candidates.find((candidate) => candidate.type === 'release');
  const outro = result.candidates.find((candidate) => candidate.type === 'outro');

  assert.equal(Boolean(peak), true, JSON.stringify(result.candidates));
  assert.equal(Boolean(release), true, JSON.stringify(result.candidates));
  assert.equal(Boolean(outro), true, JSON.stringify(result.candidates));
  assert.equal(peak.role, 'avoid-exit');
  assert.equal(release.role, 'exit');
  assert.equal(outro.role, 'exit');
  assert.equal(release.time > peak.time, true);
});

test('chooses outro-to-chorus transition candidates from release and pre-section nodes', () => {
  const fromMap = makeBeatMap({
    duration: 128,
    gridStep: 0.5,
    low: (t) => (t >= 80 && t < 96 ? 0.86 : (t >= 112 ? 0.34 : 0.42)),
    body: (t) => (t >= 80 && t < 96 ? 0.80 : (t >= 112 ? 0.3 : 0.38)),
    snap: (t) => (t >= 80 && t < 96 ? 0.72 : (t >= 112 ? 0.24 : 0.32)),
  });
  const toMap = makeBeatMap({
    duration: 128,
    gridStep: 0.5,
    low: (t) => (t >= 44 && t < 64 ? 0.84 : 0.36),
    body: (t) => (t >= 44 && t < 64 ? 0.78 : 0.34),
    snap: (t) => (t >= 44 && t < 64 ? 0.7 : 0.28),
  });
  const from = analyzeSectionCandidates({
    fixture: { track: { title: 'A', duration: 128 }, map: fromMap },
    lrcLines: parseLrc('[01:50.000] final release'),
  });
  const to = analyzeSectionCandidates({
    fixture: { track: { title: 'B', duration: 128 }, map: toMap },
    lrcLines: parseLrc(`
[00:36.000] hands up
[00:44.000] turn the bass up
[01:20.000] turn the bass up
`),
  });

  const chosen = chooseTransitionCandidates(from, to);

  assert.equal(chosen.recipe, 'outro-to-chorus');
  assert.equal(chosen.exit.type === 'release' || chosen.exit.type === 'outro', true, JSON.stringify(chosen));
  assert.equal(chosen.entry.type, 'pre-section');
  assert.equal(chosen.entry.resolvesTo.type === 'chorus' || chosen.entry.resolvesTo.type === 'hook', true);
  assert.equal(chosen.score > 0.6, true, JSON.stringify(chosen));
});

test('builds an echo-out preview plan with a vocal tail bridge', () => {
  const plan = buildPreviewPlan({
    mode: 'echo-out',
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8, transitionBars: 16 },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  assert.equal(plan.mode, 'echo-out');
  assert.equal(plan.segments.some((segment) => segment.from && segment.from.effect === 'echo-out'), true);
  assert.equal(plan.segments.some((segment) => segment.to && segment.to.role === 'pickup-loop'), true);
});

test('builds ffmpeg args from a bass-swap plan without using acrossfade', () => {
  const plan = buildPreviewPlan({
    mode: 'bass-swap',
    row: { from: 'A', to: 'B', exitPoint: 64, entryPoint: 8, transitionBars: 16 },
    fromFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'A' } },
    toFixture: { map: makeBeatMap({ gridStep: 0.5 }), track: { title: 'B' } },
    fromAudio: '/tmp/a.mp3',
    toAudio: '/tmp/b.mp3',
    output: '/tmp/out.mp3',
  });

  const args = buildFfmpegArgs(plan);
  const joined = args.join(' ');

  assert.equal(joined.includes('acrossfade'), false);
  assert.equal(joined.includes('highpass=f='), true);
  assert.equal(joined.includes('amix=inputs=2'), true);
  assert.equal(args.includes('/tmp/out.mp3'), true);
});

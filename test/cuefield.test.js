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

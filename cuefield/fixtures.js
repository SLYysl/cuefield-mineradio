const fs = require('fs');
const http = require('http');
const path = require('path');
const { once } = require('events');
const { analyzePodcastDjStream } = require('../dj-analyzer');
const { planTransitionFromPayload } = require('./api');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mpeg', '.mpga']);

function safeSlug(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'track';
}

function discoverAudioFiles(rootDir) {
  const root = path.resolve(rootDir || '');
  if (!fs.existsSync(root)) return [];
  const out = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  }

  walk(root);
  return out;
}

async function serveAudioFile(filePath, fn) {
  const fullPath = path.resolve(filePath);
  const server = http.createServer((req, res) => {
    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-length': stat.size,
    });
    fs.createReadStream(fullPath).pipe(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/${encodeURIComponent(path.basename(fullPath))}`;
  try {
    return await fn(url);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function fixturePathForAudio(filePath, outDir) {
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(outDir, `${safeSlug(base)}.json`);
}

async function analyzeAudioFileToFixture(filePath, outDir, opts = {}) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) throw new Error('AUDIO_FILE_NOT_FOUND');
  if (!AUDIO_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) throw new Error('UNSUPPORTED_AUDIO_FORMAT');

  const analyzer = opts.analyzer || ((url) => analyzePodcastDjStream(url, {
    durationSec: Number(opts.durationSec) || 0,
  }));
  const map = await serveAudioFile(fullPath, analyzer);
  const title = path.basename(fullPath, path.extname(fullPath));
  const fixture = {
    track: {
      id: safeSlug(title),
      title,
      artist: '',
      duration: map.duration || 0,
    },
    map,
    extra: {
      camelot: opts.camelot || '',
    },
    source: {
      kind: 'local-audio',
      fileName: path.basename(fullPath),
      analyzedAt: Date.now(),
    },
  };
  if (opts.assumeNoVocals) fixture.extra.vocalWindows = [];

  fs.mkdirSync(outDir, { recursive: true });
  const file = fixturePathForAudio(fullPath, outDir);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
  return { file, fixture };
}

function loadFixture(file) {
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!fixture || !fixture.track || !fixture.map) throw new Error('INVALID_FIXTURE');
  return fixture;
}

function loadFixtures(dir) {
  const root = path.resolve(dir || '');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => loadFixture(path.join(root, name)));
}

function evaluateFixturePairs(fixtures, opts = {}) {
  const rows = [];
  for (const from of fixtures) {
    for (const to of fixtures) {
      if ((from.track && from.track.id) === (to.track && to.track.id)) continue;
      const response = planTransitionFromPayload({ from, to, options: opts.options || {} });
      const plan = response.plan;
      rows.push({
        from: from.track.title || from.track.id || '',
        to: to.track.title || to.track.id || '',
        score: plan.score,
        grade: plan.grade,
        type: plan.type,
        exitPoint: plan.exitPoint,
        entryPoint: plan.entryPoint,
        transitionBars: plan.transitionBars,
        risks: plan.risks,
        vetoes: plan.vetoes,
      });
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function formatRows(rows, limit = 40) {
  const visible = rows.slice(0, limit);
  const header = ['score', 'grade', 'from', 'to', 'exit', 'entry', 'bars', 'risks', 'vetoes'].join('\t');
  const lines = visible.map((row) => [
    row.score.toFixed(3),
    row.grade,
    row.from,
    row.to,
    row.exitPoint,
    row.entryPoint,
    row.transitionBars,
    (row.risks || []).join('|'),
    (row.vetoes || []).join('|'),
  ].join('\t'));
  return [header, ...lines].join('\n');
}

module.exports = {
  AUDIO_EXTENSIONS,
  discoverAudioFiles,
  analyzeAudioFileToFixture,
  loadFixtures,
  evaluateFixturePairs,
  formatRows,
};

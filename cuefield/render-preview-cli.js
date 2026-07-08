#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadFixtures } = require('./fixtures');
const {
  findOutgoingPhrase,
  findSectionEntry,
  parseLrc,
} = require('./lrc-anchors');
const {
  audioFileForTitle,
  buildFullSimulationPlan,
  buildPreviewPlan,
  fixtureForTitle,
  parseEvalRow,
  renderPreview,
  safeOutputName,
} = require('./render-preview');

function parseArgs(argv) {
  const args = { row: 1, mode: 'bass-swap' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--report') args.report = argv[++i];
    else if (arg === '--row') args.row = Number(argv[++i]) || 1;
    else if (arg === '--mode') args.mode = argv[++i] || args.mode;
    else if (arg === '--audio-dir') args.audioDir = argv[++i];
    else if (arg === '--fixtures-dir') args.fixturesDir = argv[++i];
    else if (arg === '--lrc-dir') args.lrcDir = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--full') args.full = true;
  }
  return args;
}

function lrcFileForTitle(lrcDir, title) {
  if (!lrcDir) return null;
  const exact = path.join(lrcDir, `${title}.lrc`);
  if (fs.existsSync(exact)) return exact;
  const normalized = String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const match = fs.readdirSync(lrcDir)
    .find((name) => name.toLowerCase().endsWith('.lrc')
      && path.basename(name, path.extname(name)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === normalized);
  return match ? path.join(lrcDir, match) : null;
}

function buildSectionAnchors(args, row) {
  if (!args.lrcDir) return {};
  const lrcDir = path.resolve(args.lrcDir);
  const fromLrc = lrcFileForTitle(lrcDir, row.from);
  const toLrc = lrcFileForTitle(lrcDir, row.to);
  return {
    fromExitPhrase: fromLrc
      ? findOutgoingPhrase(parseLrc(fs.readFileSync(fromLrc, 'utf8')), { before: row.exitPoint, maxLookback: 24 })
      : null,
    toSectionEntry: toLrc
      ? findSectionEntry(parseLrc(fs.readFileSync(toLrc, 'utf8')), { preferAfter: 30 })
      : null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const report = path.resolve(args.report || path.join(root, '..', 'reports', 'cuefield-eval-23tracks.tsv'));
  const audioDir = path.resolve(args.audioDir || path.join(__dirname, 'fixtures', 'audio'));
  const fixturesDir = path.resolve(args.fixturesDir || path.join(__dirname, 'fixtures', 'tracks'));
  const outDir = path.resolve(args.out || path.join('/tmp', 'cuefield-previews'));

  const lines = fs.readFileSync(report, 'utf8').trim().split(/\n/).filter(Boolean);
  const dataLines = lines[0] && lines[0].startsWith('score\t') ? lines.slice(1) : lines;
  const row = parseEvalRow(dataLines[Math.max(0, args.row - 1)]);
  const fixtures = loadFixtures(fixturesDir);
  const buildPlan = args.full ? buildFullSimulationPlan : buildPreviewPlan;
  const plan = buildPlan({
    mode: args.mode,
    row,
    sectionAnchors: buildSectionAnchors(args, row),
    fromFixture: fixtureForTitle(fixtures, row.from),
    toFixture: fixtureForTitle(fixtures, row.to),
    fromAudio: audioFileForTitle(audioDir, row.from),
    toAudio: audioFileForTitle(audioDir, row.to),
    output: path.join(outDir, safeOutputName(row, args.mode)),
  });
  const output = renderPreview(plan);
  console.log(JSON.stringify({
    output,
    mode: plan.mode,
    from: row.from,
    to: row.to,
    recipe: plan.recipe,
    segments: plan.segments.map((segment) => ({
      label: segment.label,
      duration: segment.duration,
    })),
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadFixtures } = require('./fixtures');
const { parseLrc } = require('./lrc-anchors');
const {
  analyzeSectionCandidates,
  chooseTransitionCandidates,
} = require('./section-candidates');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fixtures-dir') args.fixturesDir = argv[++i];
    else if (arg === '--lrc-dir') args.lrcDir = argv[++i];
    else if (arg === '--track') args.track = argv[++i];
    else if (arg === '--from') args.from = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
  }
  return args;
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function fixtureForTitle(fixtures, title) {
  const target = normalizeTitle(title);
  const fixture = fixtures.find((item) => normalizeTitle(item && item.track && item.track.title) === target);
  if (!fixture) throw new Error(`FIXTURE_NOT_FOUND:${title}`);
  return fixture;
}

function lrcFileForTitle(lrcDir, title) {
  if (!lrcDir) return null;
  const exact = path.join(lrcDir, `${title}.lrc`);
  if (fs.existsSync(exact)) return exact;
  const target = normalizeTitle(title);
  const match = fs.readdirSync(lrcDir)
    .find((name) => name.toLowerCase().endsWith('.lrc') && normalizeTitle(path.basename(name, path.extname(name))) === target);
  return match ? path.join(lrcDir, match) : null;
}

function analyzeFixture(fixture, lrcDir) {
  const file = lrcFileForTitle(lrcDir, fixture.track.title);
  return analyzeSectionCandidates({
    fixture,
    lrcLines: file ? parseLrc(fs.readFileSync(file, 'utf8')) : [],
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturesDir = path.resolve(args.fixturesDir || path.join(__dirname, 'fixtures', 'tracks'));
  const lrcDir = args.lrcDir ? path.resolve(args.lrcDir) : '';
  const fixtures = loadFixtures(fixturesDir);

  if (args.from && args.to) {
    const from = analyzeFixture(fixtureForTitle(fixtures, args.from), lrcDir);
    const to = analyzeFixture(fixtureForTitle(fixtures, args.to), lrcDir);
    console.log(JSON.stringify({ from, to, chosen: chooseTransitionCandidates(from, to) }, null, 2));
    return;
  }

  if (!args.track) throw new Error('TRACK_REQUIRED');
  console.log(JSON.stringify(analyzeFixture(fixtureForTitle(fixtures, args.track), lrcDir), null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadFixtures } = require('./fixtures');
const { buildSectionContext } = require('./render-preview-inputs');
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
    else if (arg === '--auto-sections') args.autoSections = true;
    else if (arg === '--exit-bias') args.exitBias = argv[++i];
  }
  return args;
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
  const fromFixture = fixtureForTitle(fixtures, row.from);
  const toFixture = fixtureForTitle(fixtures, row.to);
  const sectionContext = buildSectionContext({
    row,
    fromFixture,
    toFixture,
    lrcDir: args.lrcDir,
    autoSections: args.autoSections,
    exitBias: args.exitBias,
  });
  const buildPlan = args.full ? buildFullSimulationPlan : buildPreviewPlan;
  const plan = buildPlan({
    mode: args.mode,
    row,
    sectionAnchors: sectionContext.sectionAnchors,
    sectionChoice: sectionContext.sectionChoice,
    fromFixture,
    toFixture,
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
    sectionChoice: plan.sectionChoice,
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

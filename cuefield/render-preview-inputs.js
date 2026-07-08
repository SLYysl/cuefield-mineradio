const fs = require('fs');
const path = require('path');
const {
  findOutgoingPhrase,
  findSectionEntry,
  parseLrc,
} = require('./lrc-anchors');
const {
  analyzeSectionCandidates,
  chooseTransitionCandidates,
} = require('./section-candidates');

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
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

function readLrcLines(lrcDir, title) {
  const file = lrcFileForTitle(lrcDir, title);
  return file ? parseLrc(fs.readFileSync(file, 'utf8')) : [];
}

function buildSectionAnchors(opts = {}) {
  const row = opts.row || {};
  const lrcDir = opts.lrcDir ? path.resolve(opts.lrcDir) : '';
  if (!lrcDir) return {};
  const fromLines = readLrcLines(lrcDir, row.from);
  const toLines = readLrcLines(lrcDir, row.to);
  return {
    fromExitPhrase: fromLines.length
      ? findOutgoingPhrase(fromLines, { before: row.exitPoint, maxLookback: 24 })
      : null,
    toSectionEntry: toLines.length
      ? findSectionEntry(toLines, { preferAfter: 30 })
      : null,
  };
}

function buildAutoSectionChoice(opts = {}) {
  const lrcDir = opts.lrcDir ? path.resolve(opts.lrcDir) : '';
  if (!lrcDir || !opts.fromFixture || !opts.toFixture) return null;
  const from = analyzeSectionCandidates({
    fixture: opts.fromFixture,
    lrcLines: readLrcLines(lrcDir, opts.fromFixture.track && opts.fromFixture.track.title),
  });
  const to = analyzeSectionCandidates({
    fixture: opts.toFixture,
    lrcLines: readLrcLines(lrcDir, opts.toFixture.track && opts.toFixture.track.title),
  });
  return chooseTransitionCandidates(from, to);
}

function buildSectionContext(opts = {}) {
  return {
    sectionAnchors: buildSectionAnchors(opts),
    sectionChoice: opts.autoSections ? buildAutoSectionChoice(opts) : null,
  };
}

module.exports = {
  buildAutoSectionChoice,
  buildSectionAnchors,
  buildSectionContext,
  lrcFileForTitle,
};

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
  assert.match(contextBlock, /pending\.runtimeDowngrade/);
  assert.equal(executeBlock.indexOf('runCuefieldVolumeCurve') < executeBlock.indexOf('cuefieldFeedbackContextFromPending'), true);
});

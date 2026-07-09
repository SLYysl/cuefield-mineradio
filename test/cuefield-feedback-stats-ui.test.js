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

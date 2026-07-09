const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readIndexHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
}

function extractAudioEndedHandler(html) {
  const start = html.indexOf('audio.onended = function(){');
  assert.notEqual(start, -1, 'audio.onended handler should exist');
  const end = html.indexOf('    };', start);
  assert.notEqual(end, -1, 'audio.onended handler should have a closing brace');
  return html.slice(start, end);
}

test('Cuefield handoff suppresses the normal ended next-track path', () => {
  const handler = extractAudioEndedHandler(readIndexHtml());

  const guardIndex = handler.indexOf('if (cuefieldAutoMixExecuting)');
  const nextTrackIndex = handler.indexOf('setTimeout(nextTrack, 0)');
  assert.notEqual(guardIndex, -1);
  assert.notEqual(nextTrackIndex, -1);
  assert.equal(guardIndex < nextTrackIndex, true);
  assert.match(handler.slice(guardIndex, nextTrackIndex), /return;/);
});

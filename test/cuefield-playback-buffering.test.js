const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('background analysis waits for enough buffered playback headroom', () => {
  const start = source.indexOf('function cuefieldBufferedPlaybackAhead');
  const end = source.indexOf('function scheduleBeatAnalysis', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const media = {
    currentTime: 10,
    readyState: 4,
    paused: false,
    ended: false,
    buffered: { length: 1, start: () => 0, end: () => 18 },
  };

  assert.equal(context.cuefieldCanRunBackgroundAnalysis(media, 24), false);
  media.buffered.end = () => 38;
  assert.equal(context.cuefieldCanRunBackgroundAnalysis(media, 24), true);
  media.readyState = 2;
  assert.equal(context.cuefieldCanRunBackgroundAnalysis(media, 24), false);
});

test('remote beat analysis uses standard quality instead of the playback stream', () => {
  const ensure = source.slice(
    source.indexOf('async function ensureCuefieldAutoMixBeatMap'),
    source.indexOf('var cuefieldMusicalAnalysisTasks'),
  );
  const scheduled = source.slice(
    source.indexOf('function scheduleBeatAnalysis'),
    source.indexOf('function beatMapSongKey'),
  );
  const prefetch = source.slice(
    source.indexOf('async function runQueueBeatPrefetch'),
    source.indexOf('function shouldScheduleCuefieldMusicalProfile'),
  );

  assert.match(ensure, /fetchBeatPrefetchAudioUrl\(song,\s*\{\s*quality:\s*'standard'/);
  assert.match(scheduled, /fetchBeatPrefetchAudioUrl\(song,\s*\{\s*quality:\s*'standard'/);
  assert.match(prefetch, /fetchBeatPrefetchAudioUrl\(song,\s*\{\s*quality:\s*'standard'/);
});

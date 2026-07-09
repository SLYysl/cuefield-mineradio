const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  WINDOWS_DEFAULT_BEATMAP_CACHE_DIR,
  defaultBeatMapCacheDir,
} = require('../cuefield/beatmap-cache-path');

test('keeps the Windows default beatmap cache path on Windows', () => {
  assert.equal(defaultBeatMapCacheDir({
    platform: 'win32',
    projectDir: '/repo',
    envDir: '',
  }), WINDOWS_DEFAULT_BEATMAP_CACHE_DIR);
});

test('anchors the Windows-style default beatmap cache path inside the project on macOS/Linux', () => {
  assert.equal(defaultBeatMapCacheDir({
    platform: 'darwin',
    projectDir: '/repo',
    envDir: '',
  }), path.join('/repo', WINDOWS_DEFAULT_BEATMAP_CACHE_DIR));
});

test('allows an explicit beatmap cache directory override', () => {
  assert.equal(defaultBeatMapCacheDir({
    platform: 'darwin',
    projectDir: '/repo',
    envDir: '/tmp/mineradio-beats',
  }), '/tmp/mineradio-beats');
});

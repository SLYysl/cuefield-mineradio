const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop bridge exposes the bounded musical analysis IPC', () => {
  assert.match(read('desktop/main.js'), /ipcMain\.handle\('cuefield-musical-analyze'/);
  assert.match(read('desktop/preload.js'), /analyzeCuefieldMusicalWindow/);
  assert.match(read('package.json'), /@spotify\/basic-pitch/);
});

test('renderer persists musical profiles in packed beat maps', () => {
  const source = read('public/index.html');
  assert.match(source, /musicalProfile:\s*map\.musicalProfile/);
  assert.match(source, /musicalProfile:\s*stored\.musicalProfile/);
  assert.match(source, /CuefieldMusicalSampler\.sampleRepresentativeAudio/);
  assert.match(source, /analyzeCuefieldMusicalWindow/);
});

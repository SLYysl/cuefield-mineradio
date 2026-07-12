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

test('renderer passes the structure map into bounded musical sampling', () => {
  const source = read('public/index.html');
  assert.match(source, /async function analyzeCuefieldMusicalBuffer\(buffer, map\)/);
  assert.match(source, /sampleRepresentativeAudio\(buffer,\s*\{\s*structureMap:\s*map\s*&&\s*map\.structureMap\s*\|\|\s*null,\s*beatMap:\s*map\s*\}\)/);
  assert.match(source, /analyzeCuefieldMusicalBuffer\(buffer, map\)/);
});

test('worker exposes bounded musical fields for each analyzed window', () => {
  const source = read('desktop/cuefield-musical-worker.js');
  assert.match(source, /noteDensity:\s*profile\.noteDensity/);
  assert.match(source, /pitchRange:\s*profile\.pitchRange/);
  assert.match(source, /start:\s*Number\(starts\[index\]\)\s*\|\|\s*0/);
  assert.match(source, /duration:\s*segment\.length\s*\/\s*payload\.sampleRate/);
  assert.match(source, /confidence:\s*profile\.confidence/);
  assert.match(source, /noteCount:\s*profile\.noteCount/);
  assert.match(source, /pitchClassProfile:\s*profile\.pitchClassProfile/);
  assert.match(source, /key:\s*profile\.key/);
  assert.match(source, /intervalProfile:\s*profile\.intervalProfile/);
  assert.doesNotMatch(source, /windows\.push\(\{[\s\S]*?notes\s*:/);
});

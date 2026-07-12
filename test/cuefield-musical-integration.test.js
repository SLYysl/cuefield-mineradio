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
  assert.match(source, /async function analyzeCuefieldMusicalBuffer\(buffer, map, structureMap, windowStarts\)/);
  assert.match(source, /structureMap:\s*structureMap\s*\|\|\s*map\s*&&\s*map\.structureMap\s*\|\|\s*null/);
  assert.match(source, /windowStarts:\s*windowStarts/);
  assert.match(source, /analyzeCuefieldMusicalBuffer\(buffer, map,/);
});

test('renderer queues musical fetch and decode behind one active bounded worker', () => {
  const source = read('public/index.html');
  assert.match(source, /CUEFIELD_MUSICAL_QUEUE_LIMIT\s*=\s*4/);
  assert.match(source, /var cuefieldMusicalAnalysisActive\s*=\s*false/);
  const queue = source.slice(source.indexOf('async function runCuefieldMusicalAnalysisTask'), source.indexOf('function clearCuefieldAutoMixPrepareTimer'));
  assert.match(queue, /function enqueueCuefieldMusicalAnalysis/);
  assert.match(queue, /function drainCuefieldMusicalAnalysisQueue/);
  assert.match(queue, /cuefieldMusicalAnalysisQueue\.length\s*>=\s*CUEFIELD_MUSICAL_QUEUE_LIMIT/);
  assert.match(queue, /task\.structured/);
  assert.match(queue, /fetchBeatPrefetchAudioUrl\(task\.song\)/);
  assert.match(queue, /decodeCuefieldMusicalAudio\(audioUrl\)/);
  assert.match(queue, /cuefieldMusicalAnalysisActive\s*=\s*false/);
  assert.match(source, /function settleCuefieldMusicalTask\(task, profile\)\s*\{\s*delete cuefieldMusicalAnalysisTasks\[task\.taskKey\]/);
});

test('renderer uses structure signatures and only profiles final pairs after the server plan', () => {
  const source = read('public/index.html');
  const profiles = source.slice(source.indexOf('function cuefieldMusicalSamplingPlan'), source.indexOf('function clearCuefieldAutoMixPrepareTimer'));
  assert.match(profiles, /CuefieldMusicalSampler\.selectTransitionWindowStarts\(structureMap, map\.duration, 4\)/);
  assert.match(profiles, /windowSignature/);
  assert.match(profiles, /windowStrategy/);
  assert.match(profiles, /existing\.windowSignature === sampling\.signature/);

  const analysis = source.slice(source.indexOf('async function analyzeAudioBeats'), source.indexOf('function localBeatRound'));
  assert.match(analysis, /!options\.prefetch/);
  assert.match(analysis, /skipMusicalProfile/);

  const pairPlan = source.slice(source.indexOf('async function planCuefieldSongPair'), source.indexOf('function initCuefieldAutoMix'));
  assert.match(pairPlan, /refineMusical/);
  assert.match(pairPlan, /cacheKind/);
  assert.match(pairPlan, /applyCuefieldPlanStructure/);
  assert.match(pairPlan, /await Promise\.all\(\[/);
  assert.match(pairPlan, /postCuefieldTransition/);
  assert.equal((pairPlan.match(/postCuefieldTransition\(\)/g) || []).length, 2);

  const evaluate = source.slice(source.indexOf('async function cuefieldEvaluatePair'), source.indexOf('function cuefieldEvaluateWithinBudget'));
  assert.match(evaluate, /skipMusicalProfile:\s*true/);
  assert.match(evaluate, /refineMusical:\s*false/);

  const init = source.slice(source.indexOf('function initCuefieldAutoMix'), source.indexOf('function cuefieldFeedbackSongMeta'));
  assert.match(init, /refineMusical:\s*true/);
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

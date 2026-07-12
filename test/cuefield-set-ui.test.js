const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function block(from, to) {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start);
  assert.notEqual(start, -1, `missing ${from}`);
  assert.notEqual(end, -1, `missing ${to}`);
  return html.slice(start, end);
}

test('loads the set planner before Cuefield AutoMix', () => {
  const planner = html.indexOf('<script src="cuefield-set-planner.js"></script>');
  const automix = html.indexOf('<script src="cuefield-automix.js"></script>');
  assert.notEqual(planner, -1);
  assert.equal(planner < automix, true);
});

test('persists off, sequential, and smart modes while migrating the old enabled preference', () => {
  assert.match(html, /CUEFIELD_SET_MODE_STORE_KEY/);
  const preference = block('function readCuefieldSetModePreference', 'function saveCuefieldAutoMixPreference');
  assert.match(preference, /mode === 'sequential' \|\| mode === 'smart'/);
  assert.match(preference, /CUEFIELD_AUTOMIX_STORE_KEY/);
  assert.match(preference, /return 'sequential'/);

  const toggle = block('function toggleCuefieldAutoMix', 'async function ensureCuefieldAutoMixBeatMap');
  assert.match(toggle, /off.*sequential.*smart.*off/s);
  assert.match(toggle, /cuefieldAutoMixEnabled = cuefieldSetMode !== 'off'/);
});

test('Cuefield next selection is independent from ordinary shuffle mode', () => {
  const nextIndex = block('function cuefieldNextQueueIndex', 'function cuefieldTierLabel');
  assert.doesNotMatch(nextIndex, /playMode === 'shuffle'/);
  assert.match(nextIndex, /idx \+ 1/);
});

test('every manual play-next action records an ephemeral priority key', () => {
  assert.match(html, /var cuefieldManualNextKey = '';/);
  const queueNext = block('function queueSongNext', 'function queueSearchResult');
  assert.match(queueNext, /cuefieldManualNextKey = queueItemKey/);
  assert.match(queueNext, /return insertAt/);

  const playback = block('async function playQueueAt', 'async function attemptAudioPlay');
  assert.match(playback, /cuefieldManualNextKey === queueItemKey\(song\)/);
  assert.match(playback, /cuefieldManualNextKey = ''/);
});

test('smart next resolves before AutoMix prepares the selected pair', () => {
  const schedule = block('function scheduleCuefieldAutoMixPrepare', 'async function runCuefieldAutoMixPrepare');
  assert.match(schedule, /resolveCuefieldNextIndex/);
  assert.match(schedule, /runCuefieldAutoMixPrepare/);
  assert.equal(schedule.indexOf('resolveCuefieldNextIndex') < schedule.indexOf('runCuefieldAutoMixPrepare'), true);

  const resolver = block('async function resolveCuefieldNextIndex', 'function scheduleCuefieldAutoMixPrepare');
  assert.match(resolver, /CuefieldSetPlanner/);
  assert.match(resolver, /cuefieldManualNextKey/);
  assert.match(resolver, /finalists\.slice\(0, 4\)/);
  assert.match(resolver, /onwardCandidates\.slice\(0, 3\)/);
  assert.match(resolver, /token !== trackSwitchToken/);
  assert.match(resolver, /promoteCandidate/);
  assert.match(resolver, /safeRenderQueuePanel/);
});

test('smart selection has a hard planning budget and falls back to sequential playback', () => {
  assert.match(html, /CUEFIELD_SMART_PLAN_BUDGET_MS/);
  const budget = block('function cuefieldEvaluateWithinBudget', 'async function resolveCuefieldNextIndex');
  assert.match(budget, /Promise\.race/);
  assert.match(budget, /clearTimeout/);

  const resolver = block('async function resolveCuefieldNextIndex', 'function scheduleCuefieldAutoMixPrepare');
  assert.match(resolver, /smartDeadline/);
  assert.match(resolver, /cuefieldEvaluateWithinBudget/);
  assert.match(resolver, /return sequentialIndex/);
});

test('pair planning is shared and cached with a bounded TTL', () => {
  assert.match(html, /CUEFIELD_PAIR_PLAN_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(html, /var cuefieldPairPlanCache = new Map\(\)/);
  const pairPlan = block('async function planCuefieldSongPair', 'function initCuefieldAutoMix');
  assert.match(pairPlan, /cuefieldPairPlanCache\.get/);
  assert.match(pairPlan, /Date\.now\(\) - cached\.createdAt < CUEFIELD_PAIR_PLAN_TTL_MS/);
  assert.match(pairPlan, /cacheKey = fromKey \+ '->' \+ toKey \+ ':' \+ cacheKind/);
  assert.match(pairPlan, /cacheKind = ctx\.refineMusical \? 'refined' : 'coarse'/);
  assert.match(pairPlan, /fromLrc:/);
  assert.match(pairPlan, /toLrc:/);

  const init = block('function initCuefieldAutoMix', 'function cuefieldFeedbackSongMeta');
  assert.match(init, /return planCuefieldSongPair\(fromSong, toSong/);
});

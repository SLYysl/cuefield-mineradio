const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectCandidates,
  scoreCandidate,
  chooseTopCandidate,
  resolveManualNext,
  promoteCandidate,
} = require('../public/cuefield-set-planner');

function songs(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Song ${index + 1}` }));
}

const keyOf = (song) => song && `song:${song.id}`;

test('collects at most twenty unique future candidates and targets sixteen by default', () => {
  const queue = songs(28);
  queue.splice(6, 0, { ...queue[3] });
  const candidates = collectCandidates(queue, 1, {
    getKey: keyOf,
    recentKeys: ['song:4'],
  });

  assert.equal(candidates.length, 16);
  assert.equal(candidates.some((candidate) => candidate.key === 'song:4'), false);
  assert.equal(new Set(candidates.map((candidate) => candidate.key)).size, candidates.length);
  assert.equal(Math.max(...candidates.map((candidate) => candidate.index)) < queue.length, true);
});

test('supports a bounded candidate target between ten and twenty', () => {
  const queue = songs(30);
  assert.equal(collectCandidates(queue, 0, { getKey: keyOf, target: 50 }).length, 20);
  assert.equal(collectCandidates(queue, 0, { getKey: keyOf, target: 2 }).length, 10);
});

test('scores immediate quality most heavily and applies repetition penalties', () => {
  const clean = scoreCandidate({
    immediate: 0.9,
    onward: 0.7,
    surprise: 0.6,
    energyShape: 0.8,
  });
  const repeated = scoreCandidate({
    immediate: 0.9,
    onward: 0.7,
    surprise: 0.6,
    energyShape: 0.8,
    repeatedArtist: true,
    repeatedStyle: true,
    bpmMonotony: true,
  });

  assert.equal(clean, 0.805);
  assert.equal(repeated, 0.655);
});

test('forces the best candidate when its lead exceeds 0.12', () => {
  const candidates = [
    { key: 'a', score: 0.91, safe: true, executable: true },
    { key: 'b', score: 0.78, safe: true, executable: true },
    { key: 'c', score: 0.77, safe: true, executable: true },
  ];
  assert.equal(chooseTopCandidate(candidates, { random: () => 0.99 }).key, 'a');
});

test('forces the best candidate when a top-three alternative is unsafe or technical-only', () => {
  const unsafe = [
    { key: 'a', score: 0.84, safe: true, executable: true },
    { key: 'b', score: 0.83, safe: false, executable: true },
    { key: 'c', score: 0.82, safe: true, executable: true },
  ];
  const technical = unsafe.map((candidate) => ({ ...candidate, safe: true }));
  technical[2].technicalFallback = true;

  assert.equal(chooseTopCandidate(unsafe, { random: () => 0.7 }).key, 'a');
  assert.equal(chooseTopCandidate(technical, { random: () => 0.99 }).key, 'a');
});

test('uses deterministic 60/27/13 weighted choice among close safe top three', () => {
  const candidates = [
    { key: 'a', score: 0.84, safe: true, executable: true },
    { key: 'b', score: 0.82, safe: true, executable: true },
    { key: 'c', score: 0.80, safe: true, executable: true },
  ];

  assert.equal(chooseTopCandidate(candidates, { random: () => 0.59 }).key, 'a');
  assert.equal(chooseTopCandidate(candidates, { random: () => 0.60 }).key, 'b');
  assert.equal(chooseTopCandidate(candidates, { random: () => 0.869 }).key, 'b');
  assert.equal(chooseTopCandidate(candidates, { random: () => 0.87 }).key, 'c');
});

test('manual next resolves only while the marked song remains directly next', () => {
  const queue = songs(4);
  assert.deepEqual(resolveManualNext(queue, 1, 'song:3', keyOf), {
    index: 2,
    key: 'song:3',
    manual: true,
  });
  assert.equal(resolveManualNext(queue, 1, 'song:4', keyOf), null);
});

test('promotes only the winner and preserves skipped relative order', () => {
  const queue = songs(6);
  const promoted = promoteCandidate(queue, 1, 'song:6', keyOf);

  assert.deepEqual(promoted.queue.map((song) => song.id), [1, 2, 6, 3, 4, 5]);
  assert.equal(promoted.nextIndex, 2);
  assert.equal(promoted.moved, true);
  assert.deepEqual(queue.map((song) => song.id), [1, 2, 3, 4, 5, 6]);
});

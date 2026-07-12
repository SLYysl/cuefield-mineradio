const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildMusicalProfile,
  compareMusicalProfiles,
  compareLocalMusicalWindows,
  keyCompatibility,
  nearestReliableWindow,
} = require('../cuefield/musical-profile');

function notes(pitches, offset = 0) {
  return pitches.map((pitch, index) => ({
    pitchMidi: pitch,
    startTimeSeconds: index * 0.4,
    durationSeconds: 0.32,
    amplitude: 0.8,
  })).map((note) => ({ ...note, pitchMidi: note.pitchMidi + offset }));
}

test('builds a normalized harmonic and melody profile from Basic Pitch note events', () => {
  const profile = buildMusicalProfile(notes([60, 64, 67, 72, 71, 67]));

  assert.equal(profile.source, 'basic-pitch');
  assert.equal(profile.noteCount, 6);
  assert.equal(Math.abs(profile.pitchClassProfile.reduce((sum, value) => sum + value, 0) - 1) < 0.00001, true);
  assert.equal(profile.melodyContour.length > 2, true);
  assert.equal(profile.key.name.length > 0, true);
});

test('ignores short low-confidence events that commonly come from drum harmonics', () => {
  const profile = buildMusicalProfile([
    ...notes([60, 64, 67]),
    { pitchMidi: 91, startTimeSeconds: 0.1, durationSeconds: 0.02, amplitude: 0.95 },
    { pitchMidi: 35, startTimeSeconds: 0.2, durationSeconds: 0.3, amplitude: 0.1 },
  ]);

  assert.equal(profile.noteCount, 3);
});

test('treats relative major and minor keys as compatible and tritones as risky', () => {
  assert.equal(keyCompatibility({ root: 0, mode: 'major' }, { root: 9, mode: 'minor' }) > 0.9, true);
  assert.equal(keyCompatibility({ root: 0, mode: 'major' }, { root: 6, mode: 'major' }) < 0.25, true);
});

test('recognizes a transposed melody contour without requiring identical notes', () => {
  const first = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64]));
  const transposed = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64], 5));
  const unrelated = buildMusicalProfile(notes([60, 71, 61, 70, 62, 69]));

  assert.equal(compareMusicalProfiles(first, transposed).melodySimilarity > 0.95, true);
  assert.equal(compareMusicalProfiles(first, unrelated).melodySimilarity < 0.5, true);
});

test('compares reliable musical windows nearest to candidate times', () => {
  const first = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64]));
  const second = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64], 12));
  first.windows = [{ ...first, start: 96, duration: 4, confidence: 0.9, noteCount: 30 }];
  second.windows = [{ ...second, start: 8, duration: 4, confidence: 0.9, noteCount: 30 }];

  const local = compareLocalMusicalWindows(first, second, 100, 8);
  assert.equal(local.score > 0.8, true);
  assert.equal(local.aWindowStart, 96);
  assert.equal(local.bWindowStart, 8);
  assert.equal(local.aDistance, 0);
  assert.equal(local.bDistance, 0);
  assert.equal('notes' in local, false);
});

test('returns no local evidence for weak or distant windows', () => {
  const profile = buildMusicalProfile(notes([60, 62, 64, 67, 65, 64]));
  profile.windows = [{ ...profile, start: 0, duration: 4, confidence: 0.2, noteCount: 4 }];
  assert.equal(compareLocalMusicalWindows(profile, profile, 90, 90), null);
  assert.equal(compareLocalMusicalWindows({}, profile, 0, 0), null);
});

test('selects the nearest reliable window, then higher confidence', () => {
  const profile = {
    windows: [
      { start: 0, duration: 4, confidence: 0.6, noteCount: 12 },
      { start: 8, duration: 4, confidence: 0.9, noteCount: 12 },
      { start: 4, duration: 4, confidence: 0.7, noteCount: 12 },
    ],
  };

  assert.equal(nearestReliableWindow(profile, 9).window.start, 8);
  assert.equal(nearestReliableWindow(profile, 4).window.confidence, 0.7);
});

test('treats both window edges as inclusive', () => {
  const profile = {
    windows: [{ start: 8, duration: 4, confidence: 0.7, noteCount: 12 }],
  };

  assert.equal(nearestReliableWindow(profile, 8).distance, 0);
  assert.equal(nearestReliableWindow(profile, 12).distance, 0);
});

test('returns infinite distance for invalid window inputs', () => {
  const { distanceToWindow } = require('../cuefield/musical-profile');

  assert.equal(distanceToWindow(1, { start: 0 }), Infinity);
  assert.equal(distanceToWindow(1, { start: 0, duration: -1 }), Infinity);
  assert.equal(distanceToWindow(Number.NaN, { start: 0, duration: 4 }), Infinity);
});

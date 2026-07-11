const assert = require('node:assert/strict');
const test = require('node:test');

const { buildMusicalProfile, compareMusicalProfiles, keyCompatibility } = require('../cuefield/musical-profile');

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

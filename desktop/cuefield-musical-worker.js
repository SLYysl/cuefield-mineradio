const fs = require('fs');
const path = require('path');
const { parentPort } = require('worker_threads');
const tf = require('@tensorflow/tfjs');
const {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} = require('@spotify/basic-pitch');
const { buildMusicalProfile } = require('../cuefield/musical-profile');

let basicPitchPromise = null;

function loadBasicPitch() {
  if (basicPitchPromise) return basicPitchPromise;
  basicPitchPromise = (async () => {
    const modelPath = require.resolve('@spotify/basic-pitch/model/model.json');
    const modelJson = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const manifest = modelJson.weightsManifest || [];
    const weightSpecs = manifest.flatMap((group) => group.weights || []);
    const buffers = manifest.flatMap((group) => (group.paths || []).map((file) => (
      fs.readFileSync(path.join(path.dirname(modelPath), file))
    )));
    const weightBuffer = Buffer.concat(buffers);
    const weightData = weightBuffer.buffer.slice(weightBuffer.byteOffset, weightBuffer.byteOffset + weightBuffer.byteLength);
    const model = tf.loadGraphModel(tf.io.fromMemory({
      modelTopology: modelJson.modelTopology,
      weightSpecs,
      weightData,
    }));
    return new BasicPitch(model);
  })();
  return basicPitchPromise;
}

async function notesFromSamples(samples) {
  const basicPitch = await loadBasicPitch();
  const frames = [];
  const onsets = [];
  await basicPitch.evaluateModel(samples, (nextFrames, nextOnsets) => {
    frames.push(...nextFrames);
    onsets.push(...nextOnsets);
  }, () => {});
  return noteFramesToTime(outputToNotesPoly(frames, onsets, 0.35, 0.3, 5));
}

async function analyze(payload) {
  const samples = payload.samples;
  const windowSeconds = Number(payload.windowSeconds) || 0;
  const windowSize = windowSeconds > 0 ? Math.round(windowSeconds * payload.sampleRate) : samples.length;
  const starts = Array.isArray(payload.windowStarts) && payload.windowStarts.length
    ? payload.windowStarts
    : [0];
  const allNotes = [];
  const windows = [];
  for (let index = 0; index < starts.length; index += 1) {
    const segment = samples.slice(index * windowSize, Math.min(samples.length, (index + 1) * windowSize));
    if (!segment.length) continue;
    const notes = await notesFromSamples(segment);
    const profile = buildMusicalProfile(notes);
    windows.push({
      start: Number(starts[index]) || 0,
      duration: segment.length / payload.sampleRate,
      confidence: profile.confidence,
      noteCount: profile.noteCount,
      noteDensity: profile.noteDensity,
      pitchClassProfile: profile.pitchClassProfile,
      key: profile.key,
      intervalProfile: profile.intervalProfile,
      pitchRange: profile.pitchRange,
    });
    notes.forEach((note) => allNotes.push({
      ...note,
      startTimeSeconds: note.startTimeSeconds + index * windowSeconds,
    }));
  }
  return { ...buildMusicalProfile(allNotes), windows };
}

parentPort.on('message', async (payload) => {
  try {
    const profile = await analyze(payload || {});
    parentPort.postMessage({ id: payload.id, ok: true, profile });
  } catch (error) {
    parentPort.postMessage({ id: payload && payload.id, ok: false, error: error.message || String(error) });
  }
});

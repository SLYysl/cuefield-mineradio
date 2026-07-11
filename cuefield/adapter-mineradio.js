function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBeatEvent(raw, index, gridStep) {
  if (Array.isArray(raw)) {
    const time = toNumber(raw[0], 0);
    return {
      time,
      index,
      strength: toNumber(raw[1], 0.5),
      confidence: toNumber(raw[2], 0.5),
      impact: toNumber(raw[3], toNumber(raw[1], 0.25)),
      low: toNumber(raw[4], toNumber(raw[9], 0)),
      body: toNumber(raw[5], 0),
      snap: toNumber(raw[6], toNumber(raw[10], 0)),
      combo: toNumber(raw[7], 0) === 1 || toNumber(raw[8], 0) >= 7 ? 'downbeat' : '',
      step: gridStep || 0,
    };
  }
  const time = typeof raw === 'number' ? raw : toNumber(raw && raw.time, 0);
  return {
    time,
    index,
    strength: toNumber(raw && raw.strength, 0.5),
    confidence: toNumber(raw && raw.confidence, 0.5),
    impact: toNumber(raw && raw.impact, 0.25),
    low: toNumber(raw && raw.low, 0),
    body: toNumber(raw && raw.body, 0),
    snap: toNumber(raw && raw.snap, 0),
    combo: String(raw && raw.combo || ''),
    step: toNumber(raw && raw.step, gridStep || 0),
  };
}

function normalizeWindows(windows) {
  if (!Array.isArray(windows)) return [];
  return windows
    .map((w) => ({
      start: Math.max(0, toNumber(w && w.start, 0)),
      end: Math.max(0, toNumber(w && w.end, 0)),
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

function normalizeMineradioBeatMap(track, map, extra = {}) {
  const gridStep = toNumber(map && map.gridStep, 0);
  const rawBeats = (map && (map.cameraBeats || map.beats || map.kicks)) || [];
  const beats = rawBeats
    .map((beat, index) => normalizeBeatEvent(beat, index, gridStep))
    .filter((beat) => Number.isFinite(beat.time))
    .sort((a, b) => a.time - b.time);
  const duration = toNumber(track && track.duration, toNumber(map && map.duration, beats.length ? beats[beats.length - 1].time : 0));
  const downbeats = beats.filter((beat, index) => {
    if (beat.combo === 'downbeat') return true;
    return gridStep > 0 && index % 16 === 0 && beat.impact >= 0.4;
  });
  const phraseBoundaries = downbeats.map((beat) => ({
    time: beat.time,
    confidence: Math.max(beat.confidence, beat.strength),
  }));
  const hasKeyData = !!extra.camelot || !!extra.key;
  const hasVocalData = Array.isArray(extra.vocalWindows);

  return {
    track: {
      id: track && track.id || '',
      title: track && (track.title || track.name) || '',
      artist: track && track.artist || '',
      duration,
    },
    analysis: {
      source: 'mineradio',
      beats,
      downbeats,
      phraseBoundaries,
      energyCurve: beats.map((beat) => ({ time: beat.time, value: Math.max(0, Math.min(1, beat.impact || beat.strength || 0)) })),
      lowBand: beats.map((beat) => ({ time: beat.time, value: beat.low })),
      bodyBand: beats.map((beat) => ({ time: beat.time, value: beat.body })),
      snapBand: beats.map((beat) => ({ time: beat.time, value: beat.snap })),
      sections: [],
      gridStep,
      bpm: gridStep > 0 ? 60 / gridStep : 0,
      camelot: extra.camelot || '',
      key: extra.key || '',
      vocalWindows: normalizeWindows(extra.vocalWindows),
      hasKeyData,
      hasVocalData,
      dataConfidence: beats.length >= 16 && gridStep > 0 ? 1 : 0,
      musicalProfile: map && map.musicalProfile || extra.musicalProfile || null,
    },
  };
}

module.exports = {
  normalizeMineradioBeatMap,
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function beatEnergy(beat) {
  if (!beat) return 0;
  return Math.max(
    toNumber(beat.low),
    toNumber(beat.body),
    toNumber(beat.snap),
    toNumber(beat.impact),
    toNumber(beat.strength),
  );
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function windowBeats(beats, start, duration) {
  return beats.filter((beat) => beat.time >= start && beat.time < start + duration);
}

function windowStats(beats, start, duration) {
  const window = windowBeats(beats, start, duration);
  const energy = average(window.map(beatEnergy));
  return {
    energy: round(energy),
    lowDensity: round(average(window.map((beat) => toNumber(beat.low)))),
    vocalDensity: 0,
    beatStability: round(window.length ? window.filter((beat) => toNumber(beat.confidence, 0.8) >= 0.75).length / window.length : 0),
  };
}

function candidateMetric(beats, time) {
  const before = windowStats(beats, Math.max(0, time - 8), 8);
  const after = windowStats(beats, time, 8);
  return {
    energyBefore: before.energy,
    energyAfter: after.energy,
    vocalDensity: 0,
    lowDensity: after.lowDensity,
    beatStability: after.beatStability,
  };
}

function uniqueCandidates(candidates) {
  const out = [];
  candidates
    .filter((candidate) => Number.isFinite(candidate.time))
    .sort((a, b) => {
      const roleOrder = { exit: 0, entry: 1, 'avoid-exit': 2 };
      return (roleOrder[a.role] ?? 5) - (roleOrder[b.role] ?? 5)
        || b.confidence - a.confidence
        || a.time - b.time;
    })
    .forEach((candidate) => {
      const duplicate = out.find((item) => item.type === candidate.type && Math.abs(item.time - candidate.time) < 1.5);
      if (!duplicate) out.push(candidate);
    });
  return out;
}

function repeatedLyricGroups(lines) {
  const groups = new Map();
  (lines || []).forEach((line) => {
    if (!line.normalized || line.normalized.length < 4) return;
    if (!groups.has(line.normalized)) groups.set(line.normalized, []);
    groups.get(line.normalized).push(line);
  });
  return Array.from(groups.values()).filter((group) => group.length >= 2);
}

function addLyricCandidates(candidates, lines, beats) {
  repeatedLyricGroups(lines).forEach((group) => {
    group.forEach((line) => {
      const metrics = candidateMetric(beats, line.time);
      const type = metrics.energyAfter >= metrics.energyBefore ? 'chorus' : 'hook';
      candidates.push({
        type,
        role: 'entry',
        time: round(line.time),
        confidence: round(Math.min(0.95, 0.56 + group.length * 0.08 + Math.max(0, metrics.energyAfter - metrics.energyBefore) * 0.5)),
        text: line.text,
        repeats: group.length,
        ...metrics,
      });

      const before = (lines || []).filter((item) => item.time < line.time && item.time >= line.time - 10).at(-1);
      if (before) {
        candidates.push({
          type: 'pre-section',
          role: 'entry',
          time: round(before.time),
          confidence: round(Math.min(0.9, 0.5 + group.length * 0.07)),
          text: before.text,
          resolvesTo: {
            type,
            time: round(line.time),
            text: line.text,
          },
          ...candidateMetric(beats, before.time),
        });
      }
    });
  });

  const lastLyric = (lines || []).at(-1);
  if (lastLyric) {
    candidates.push({
      type: 'outro',
      role: 'exit',
      time: round(lastLyric.time),
      confidence: 0.62,
      text: lastLyric.text,
      ...candidateMetric(beats, lastLyric.time),
    });
  }
}

function addEnergyCandidates(candidates, beats, duration) {
  if (!beats.length) return;
  const step = Math.max(toNumber(beats[0].step, 0), 0.5);
  const scanStep = Math.max(step * 8, 4);
  const windows = [];
  for (let time = 0; time < duration - 8; time += scanStep) {
    windows.push({
      time: round(time),
      energy: windowStats(beats, time, 8).energy,
    });
  }
  if (!windows.length) return;

  const sorted = windows.slice().sort((a, b) => b.energy - a.energy);
  const peak = sorted[0];
  candidates.push({
    type: 'peak',
    role: 'avoid-exit',
    time: peak.time,
    confidence: round(Math.min(0.95, 0.55 + peak.energy * 0.4)),
    ...candidateMetric(beats, peak.time),
  });

  const release = windows
    .filter((window) => window.time > peak.time + 8 && window.energy <= peak.energy * 0.82)
    .sort((a, b) => a.time - b.time)[0];
  if (release) {
    candidates.push({
      type: 'release',
      role: 'exit',
      time: release.time,
      confidence: round(Math.min(0.92, 0.5 + Math.max(0, peak.energy - release.energy) * 0.6)),
      ...candidateMetric(beats, release.time),
    });
  }

  const tailStart = Math.max(0, duration - 16);
  candidates.push({
    type: 'outro',
    role: 'exit',
    time: round(tailStart),
    confidence: 0.58,
    ...candidateMetric(beats, tailStart),
  });
}

function analyzeSectionCandidates(opts = {}) {
  const fixture = opts.fixture || {};
  const map = fixture.map || {};
  const beats = (map.beats || []).slice().sort((a, b) => a.time - b.time);
  const duration = Math.max(
    toNumber(fixture.track && fixture.track.duration),
    toNumber(map.duration),
    beats.length ? beats[beats.length - 1].time : 0,
  );
  const candidates = [];

  addEnergyCandidates(candidates, beats, duration);
  addLyricCandidates(candidates, opts.lrcLines || [], beats);

  return {
    track: fixture.track || {},
    duration: round(duration),
    candidates: uniqueCandidates(candidates),
  };
}

function scoreExit(candidate) {
  if (!candidate || candidate.role !== 'exit') return 0;
  let score = candidate.confidence || 0;
  if (candidate.type === 'release') score += 0.18;
  if (candidate.type === 'outro') score += 0.12;
  if (candidate.energyAfter < candidate.energyBefore) score += 0.08;
  return score;
}

function scoreLateExit(candidate, duration) {
  if (!candidate || candidate.role !== 'exit') return 0;
  const lateRatio = duration > 0 ? Math.max(0, Math.min(1, candidate.time / duration)) : 0;
  let score = scoreExit(candidate) + lateRatio * 0.42;
  if (candidate.type === 'outro') score += 0.26;
  return score;
}

function scoreEntry(candidate) {
  if (!candidate || candidate.role !== 'entry') return 0;
  let score = candidate.confidence || 0;
  if (candidate.type === 'pre-section') score += 0.2;
  if (candidate.type === 'chorus' || candidate.type === 'hook') score += 0.1;
  if (candidate.resolvesTo && (candidate.resolvesTo.type === 'chorus' || candidate.resolvesTo.type === 'hook')) score += 0.08;
  return score;
}

function chooseTransitionCandidates(fromAnalysis, toAnalysis, opts = {}) {
  const exitScore = opts.exitBias === 'late'
    ? (candidate) => scoreLateExit(candidate, toNumber(fromAnalysis && fromAnalysis.duration))
    : scoreExit;
  const exits = (fromAnalysis.candidates || []).filter((candidate) => candidate.role === 'exit')
    .sort((a, b) => exitScore(b) - exitScore(a) || (opts.exitBias === 'late' ? b.time - a.time : a.time - b.time));
  const entries = (toAnalysis.candidates || []).filter((candidate) => candidate.role === 'entry')
    .sort((a, b) => scoreEntry(b) - scoreEntry(a) || a.time - b.time);
  const exit = exits[0] || null;
  const entry = entries[0] || null;
  const recipe = entry && entry.type === 'pre-section' ? 'outro-to-chorus' : 'section-jump';
  return {
    recipe,
    exit,
    entry,
    score: round(Math.min(0.99, (exitScore(exit) * 0.5) + (scoreEntry(entry) * 0.5))),
  };
}

module.exports = {
  analyzeSectionCandidates,
  chooseTransitionCandidates,
};

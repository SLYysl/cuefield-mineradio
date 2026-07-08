function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function camelotParts(camelot) {
  const m = String(camelot || '').trim().toUpperCase().match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return null;
  return { n, mode: m[2] };
}

function circularDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 12 - raw);
}

function keyCompatibility(from, to) {
  const a = camelotParts(from.analysis.camelot);
  const b = camelotParts(to.analysis.camelot);
  if (!a || !b) return { score: 0.55, known: false };
  if (a.n === b.n && a.mode === b.mode) return { score: 1, known: true };
  if (a.n === b.n && a.mode !== b.mode) return { score: 0.9, known: true };
  if (a.mode === b.mode && circularDistance(a.n, b.n) === 1) return { score: 0.8, known: true };
  if (circularDistance(a.n, b.n) <= 2) return { score: 0.45, known: true };
  return { score: 0, known: true };
}

function nearestBoundaryScore(time, boundaries, gridStep) {
  if (!boundaries || !boundaries.length || !gridStep) return 0;
  let best = Infinity;
  for (const boundary of boundaries) best = Math.min(best, Math.abs(boundary.time - time));
  return clamp01(1 - best / Math.max(0.001, gridStep * 0.5));
}

function sampleBeats(track, start, end) {
  return track.analysis.beats.filter((beat) => beat.time >= start && beat.time <= end);
}

function average(beats, field, fallback = 0) {
  if (!beats.length) return fallback;
  return beats.reduce((sum, beat) => sum + Number(beat[field] || 0), 0) / beats.length;
}

function maxValue(beats, field) {
  if (!beats.length) return 0;
  return beats.reduce((max, beat) => Math.max(max, Number(beat[field] || 0)), 0);
}

function overlaps(windows, start, end) {
  return (windows || []).some((w) => w.start < end && w.end > start);
}

function hasBassClash(from, to, exitPoint, entryPoint, transitionSec) {
  const safetyTail = from.analysis.gridStep || 0;
  const fromBeats = sampleBeats(from, Math.max(0, exitPoint - transitionSec), exitPoint + safetyTail);
  const toBeats = sampleBeats(to, entryPoint, entryPoint + transitionSec);
  const cueTail = Math.max((from.analysis.gridStep || 0.5) * 4, 1.5);
  const fromCueTail = sampleBeats(from, exitPoint, exitPoint + cueTail);
  const toCueHead = sampleBeats(to, entryPoint, entryPoint + cueTail);
  if (maxValue(fromCueTail, 'low') >= 0.78 && average(toCueHead, 'low', 0) >= 0.78) return true;
  const count = Math.min(fromBeats.length, toBeats.length);
  if (!count) return false;
  let clashing = 0;
  for (let i = 0; i < count; i++) {
    if ((fromBeats[i].low || 0) >= 0.78 && (toBeats[i].low || 0) >= 0.78) clashing++;
  }
  return clashing / count >= 0.25;
}

function energyContinuity(from, to, exitPoint, entryPoint, transitionSec) {
  const fromEnd = sampleBeats(from, Math.max(0, exitPoint - transitionSec * 0.5), exitPoint);
  const toStart = sampleBeats(to, entryPoint, entryPoint + transitionSec * 0.5);
  const a = average(fromEnd, 'impact', 0.4);
  const b = average(toStart, 'impact', 0.4);
  return clamp01(1 - Math.abs(a - b) / 0.45);
}

function beatAlignment(from, to) {
  const a = from.analysis.gridStep || 0;
  const b = to.analysis.gridStep || 0;
  if (!a || !b) return 0;
  return clamp01(1 - Math.abs(a - b) / Math.max(a, b, 0.001));
}

function bpmTolerance(from, to) {
  const a = from.analysis.bpm || 0;
  const b = to.analysis.bpm || 0;
  if (!a || !b) return 0;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff <= 0.005) return 1;
  if (diff >= 0.02) return 0;
  return clamp01(1 - (diff - 0.005) / 0.015);
}

function transitionLengthScore(bars) {
  if (bars === 8 || bars === 16) return 1;
  if (bars === 32) return 0.85;
  return 0.4;
}

function candidateTimes(track, role) {
  const duration = track.track.duration || track.analysis.duration || 0;
  const boundaries = track.analysis.phraseBoundaries || [];
  const min = role === 'exit' ? duration * 0.55 : duration * 0.08;
  const max = role === 'exit' ? duration * 0.90 : duration * 0.36;
  const candidates = boundaries
    .map((b) => b.time)
    .filter((time) => time >= min && time <= max);
  if (candidates.length) return candidates;
  const beats = track.analysis.downbeats.length ? track.analysis.downbeats : track.analysis.beats;
  return beats.map((b) => b.time).filter((time) => time >= min && time <= max);
}

function gradeFor(score) {
  if (score >= 0.95) return 'high-confidence';
  if (score >= 0.7) return 'usable';
  if (score > 0) return 'risky';
  return 'rejected';
}

function scoreCandidate(from, to, exitPoint, entryPoint, transitionBars) {
  const gridStep = Math.max(from.analysis.gridStep || 0, to.analysis.gridStep || 0, 0.5);
  const transitionSec = transitionBars * 4 * gridStep;
  const vetoes = [];
  const risks = [];

  if (!from.analysis.dataConfidence || !to.analysis.dataConfidence) vetoes.push('low data confidence');
  if (from.analysis.hasVocalData && to.analysis.hasVocalData) {
    const safetyTail = from.analysis.gridStep || 0;
    const fromVocal = overlaps(from.analysis.vocalWindows, Math.max(0, exitPoint - transitionSec), exitPoint + safetyTail);
    const toVocal = overlaps(to.analysis.vocalWindows, entryPoint, entryPoint + transitionSec);
    if (fromVocal && toVocal) vetoes.push('vocal collision');
  }
  if (hasBassClash(from, to, exitPoint, entryPoint, transitionSec)) vetoes.push('bass clash');
  if (vetoes.length) {
    return { score: 0, vetoes, risks, components: {}, transitionSec };
  }

  const key = keyCompatibility(from, to);
  const components = {
    keyCompatibility: key.score,
    beatAlignment: beatAlignment(from, to),
    downbeatAlignment: Math.min(
      nearestBoundaryScore(exitPoint, from.analysis.downbeats, from.analysis.gridStep),
      nearestBoundaryScore(entryPoint, to.analysis.downbeats, to.analysis.gridStep),
    ),
    energyContinuity: energyContinuity(from, to, exitPoint, entryPoint, transitionSec),
    bpmTolerance: bpmTolerance(from, to),
    phraseAlignment: Math.min(
      nearestBoundaryScore(exitPoint, from.analysis.phraseBoundaries, from.analysis.gridStep),
      nearestBoundaryScore(entryPoint, to.analysis.phraseBoundaries, to.analysis.gridStep),
    ),
    transitionLength: transitionLengthScore(transitionBars),
  };

  let score =
    components.keyCompatibility * 0.25 +
    components.beatAlignment * 0.20 +
    components.downbeatAlignment * 0.15 +
    components.energyContinuity * 0.15 +
    components.bpmTolerance * 0.10 +
    components.phraseAlignment * 0.10 +
    components.transitionLength * 0.05;

  if (!key.known) risks.push('key data unavailable');
  if (!from.analysis.hasVocalData || !to.analysis.hasVocalData) risks.push('vocal density unavailable');
  if (!key.known || !from.analysis.hasVocalData || !to.analysis.hasVocalData) score = Math.min(score, 0.85);

  return { score: clamp01(score), vetoes, risks, components, transitionSec };
}

function transitionType(from, to, exitPoint, entryPoint, transitionSec) {
  const fromLow = average(sampleBeats(from, exitPoint, exitPoint + transitionSec * 0.5), 'low', 0);
  const toSnap = average(sampleBeats(to, entryPoint, entryPoint + transitionSec * 0.5), 'snap', 0);
  if (fromLow < 0.35 && toSnap >= 0.2) return 'bass-to-hook handoff';
  return 'phrase-aligned blend';
}

function whyFor(plan) {
  if (plan.grade === 'rejected') return 'Cuefield rejected this transition because a hard veto was triggered.';
  return 'Cuefield found phrase-aligned cue points with compatible timing and a controlled energy handoff.';
}

function planTransition(from, to, opts = {}) {
  const exits = candidateTimes(from, 'exit');
  const entries = candidateTimes(to, 'entry');
  const transitionBarsList = opts.transitionBars || [16, 8, 32];
  let best = null;

  for (const exitPoint of exits) {
    for (const entryPoint of entries) {
      for (const transitionBars of transitionBarsList) {
        const result = scoreCandidate(from, to, exitPoint, entryPoint, transitionBars);
        const candidate = {
          score: result.score,
          exitPoint,
          entryPoint,
          transitionBars,
          transitionSec: result.transitionSec,
          risks: result.risks,
          vetoes: result.vetoes,
          components: result.components,
        };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
  }

  if (!best) {
    best = { score: 0, exitPoint: 0, entryPoint: 0, transitionBars: 0, risks: ['no transition candidates'], vetoes: ['low data confidence'], components: {} };
  }

  const grade = gradeFor(best.score);
  return {
    score: round(best.score),
    grade,
    type: transitionType(from, to, best.exitPoint, best.entryPoint, best.transitionSec || 0),
    exitPoint: round(best.exitPoint, 2),
    entryPoint: round(best.entryPoint, 2),
    transitionBars: best.transitionBars,
    risks: best.risks || [],
    vetoes: best.vetoes || [],
    components: best.components || {},
    why: whyFor({ grade }),
  };
}

module.exports = {
  planTransition,
};

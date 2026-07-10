function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nearestBar(profile, target) {
  const bars = Array.isArray(profile && profile.bars) ? profile.bars : [];
  if (!bars.length) return {};
  const time = finiteNumber(target);
  return bars.reduce((nearest, bar) => {
    const distance = Math.abs(finiteNumber(bar && (bar.start ?? bar.time)) - time);
    const nearestDistance = Math.abs(finiteNumber(nearest && (nearest.start ?? nearest.time)) - time);
    return distance < nearestDistance ? bar : nearest;
  }, bars[0]);
}

function classifyTransitionRoute(opts = {}) {
  const fromProfile = opts.fromProfile || {};
  const toProfile = opts.toProfile || {};
  const exits = Array.isArray(opts.exits) ? opts.exits : [];
  const entries = Array.isArray(opts.entries) ? opts.entries : [];
  const risks = Array.isArray(opts.risks) ? opts.risks : [];
  const directionalityMismatch = risks.includes('directionality mismatch') ? 1 : 0;
  const hasStructure = exits.length > 0 && entries.length > 0;

  if (!hasStructure) {
    return {
      route: 'terminal-rescue',
      compatibilityClass: 'uncertain',
      contrastDirection: 'unknown',
      preferredExitRange: [0.88, 0.96],
      entryPolicy: 'start-or-downbeat',
      overlapClass: 'short',
      recipe: 'terminal-rescue',
      reasons: ['missing-structure'].concat(directionalityMismatch ? ['directionality-mismatch'] : []),
      metrics: {
        snapDelta: 0,
        energyDelta: 0,
        tempoDelta: 0,
        directionalityMismatch,
      },
    };
  }

  const exit = exits[0];
  const entry = entries[0];
  const fromBar = nearestBar(fromProfile, exit.time);
  const toBar = nearestBar(toProfile, entry.landingAt);
  const fromSnap = finiteNumber(fromBar.snapDensity ?? fromBar.snap);
  const toSnap = finiteNumber(toBar.snapDensity ?? toBar.snap);
  const fromEnergy = finiteNumber(fromBar.energy);
  const toEnergy = finiteNumber(toBar.energy);
  const snapDelta = toSnap - fromSnap;
  const energyDelta = toEnergy - fromEnergy;
  const bpmA = finiteNumber(fromProfile.bpm);
  const bpmB = finiteNumber(toProfile.bpm);
  const tempoDelta = Math.abs(bpmA - bpmB) / Math.max(1, bpmA, bpmB);
  const protectedRatio = clamp(
    finiteNumber(opts.protectedUntil) / Math.max(1, finiteNumber(fromProfile.duration)),
    0,
    1,
  );
  const urgentRise = toSnap >= 0.42 && snapDelta >= 0.18;
  const urgentRelease = fromSnap >= 0.42 && snapDelta <= -0.18;

  if (urgentRise) {
    return {
      route: 'late-contrast-rise',
      compatibilityClass: 'contrast',
      contrastDirection: 'rising',
      preferredExitRange: [0.75, 0.9],
      entryPolicy: 'filtered-runway',
      overlapClass: 'short',
      recipe: 'late-contrast-rise',
      reasons: ['snap-rise'].concat(directionalityMismatch ? ['directionality-mismatch'] : []),
      metrics: { snapDelta, energyDelta, tempoDelta, directionalityMismatch, fromSnap, toSnap },
    };
  }

  if (urgentRelease) {
    return {
      route: 'late-contrast-release',
      compatibilityClass: 'contrast',
      contrastDirection: 'falling',
      preferredExitRange: [0.72, 0.9],
      entryPolicy: 'quiet-runway',
      overlapClass: 'short-or-medium',
      recipe: 'late-contrast-release',
      reasons: ['snap-release'].concat(directionalityMismatch ? ['directionality-mismatch'] : []),
      metrics: { snapDelta, energyDelta, tempoDelta, directionalityMismatch, fromSnap, toSnap },
    };
  }

  return {
    route: 'structure-mix',
    compatibilityClass: 'compatible',
    contrastDirection: 'balanced',
    preferredExitRange: [protectedRatio, Math.max(0.78, protectedRatio)],
    entryPolicy: 'best-supported',
    overlapClass: 'adaptive',
    recipe: 'structure-window',
    reasons: directionalityMismatch ? ['directionality-mismatch'] : [],
    metrics: { snapDelta, energyDelta, tempoDelta, directionalityMismatch, fromSnap, toSnap },
  };
}

module.exports = { classifyTransitionRoute };

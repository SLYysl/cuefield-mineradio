function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
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
      reasons: ['missing-structure'],
      metrics: {
        snapDelta: 0,
        energyDelta: 0,
        tempoDelta: 0,
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
  const tempoDelta = finiteNumber(toProfile.tempo) - finiteNumber(fromProfile.tempo);
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
      reasons: ['snap-rise'],
      metrics: { snapDelta, energyDelta, tempoDelta, fromSnap, toSnap },
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
      reasons: ['snap-release'],
      metrics: { snapDelta, energyDelta, tempoDelta, fromSnap, toSnap },
    };
  }

  return {
    route: 'structure-mix',
    compatibilityClass: 'compatible',
    contrastDirection: 'balanced',
    preferredExitRange: [0.32, 0.78],
    entryPolicy: 'best-supported',
    overlapClass: 'adaptive',
    recipe: 'structure-window',
    reasons: [],
    metrics: { snapDelta, energyDelta, tempoDelta, fromSnap, toSnap },
  };
}

module.exports = { classifyTransitionRoute };

const { normalizeMineradioBeatMap } = require('./adapter-mineradio');
const { planTransition } = require('./plan-transition');

function normalizeSide(name, value) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${name.toUpperCase()}_MISSING`);
  }
  if (!value.map || typeof value.map !== 'object') {
    throw new Error(`${name.toUpperCase()}_BEATMAP_MISSING`);
  }
  return normalizeMineradioBeatMap(value.track || {}, value.map, value.extra || {});
}

function publicTrack(analysis) {
  return {
    id: analysis.track.id || '',
    title: analysis.track.title || '',
    artist: analysis.track.artist || '',
    duration: analysis.track.duration || 0,
  };
}

function planTransitionFromPayload(payload) {
  const body = payload || {};
  const from = normalizeSide('from', body.from);
  const to = normalizeSide('to', body.to);
  const plan = planTransition(from, to, body.options || {});

  return {
    ok: true,
    plan: {
      ...plan,
      from: publicTrack(from),
      to: publicTrack(to),
    },
  };
}

module.exports = {
  planTransitionFromPayload,
};

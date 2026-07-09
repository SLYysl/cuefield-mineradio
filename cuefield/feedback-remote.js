function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function remoteFeedbackConfig(env = process.env) {
  const url = String(env.CUEFIELD_FEEDBACK_REMOTE_URL || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    token: String(env.CUEFIELD_FEEDBACK_REMOTE_TOKEN || '').trim(),
    source: String(env.CUEFIELD_FEEDBACK_SOURCE || 'mineradio-cuefield-mvp').trim(),
    timeoutMs: toPositiveInt(env.CUEFIELD_FEEDBACK_REMOTE_TIMEOUT_MS, 2500),
  };
}

function buildRemoteFeedbackPayload(record, opts = {}) {
  const pair = record && record.pair || {};
  const transition = record && record.transition || {};
  return {
    source: opts.source || 'mineradio-cuefield-mvp',
    schema: 'cuefield-feedback-v1',
    sentAt: new Date().toISOString(),
    record: {
      createdAt: record && record.createdAt,
      rating: record && record.rating,
      note: record && record.note || '',
      pair: {
        fromKey: pair.fromKey || '',
        toKey: pair.toKey || '',
        fromTitle: pair.fromTitle || '',
        fromArtist: pair.fromArtist || '',
        toTitle: pair.toTitle || '',
        toArtist: pair.toArtist || '',
      },
      transition: {
        recipe: transition.recipe || '',
        transitionRecipe: transition.transitionRecipe || '',
        executionMode: transition.executionMode || '',
        tier: transition.tier || '',
        score: transition.score,
        evalScore: transition.evalScore,
        exitTime: transition.exitTime,
        entryTime: transition.entryTime,
        risks: Array.isArray(transition.risks) ? transition.risks.slice(0, 8) : [],
      },
    },
  };
}

async function forwardCuefieldFeedback(record, opts = {}) {
  const config = opts.config || remoteFeedbackConfig(opts.env);
  if (!config || !config.url) return { ok: false, skipped: true, reason: 'REMOTE_FEEDBACK_DISABLED' };
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, skipped: true, reason: 'FETCH_UNAVAILABLE' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), config.timeoutMs || 2500) : null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const resp = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRemoteFeedbackPayload(record, config)),
      signal: controller && controller.signal,
    });
    return { ok: !!(resp && resp.ok), status: resp && resp.status };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  buildRemoteFeedbackPayload,
  forwardCuefieldFeedback,
  remoteFeedbackConfig,
};

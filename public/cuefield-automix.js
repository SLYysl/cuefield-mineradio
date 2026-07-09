(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldAutoMix = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var EXECUTABLE_TIERS = { magic: true, usable: true, usable_but_not_magic: true };
  var HARD_RISKS = {
    'closed outgoing phrase': true,
    'near closed outgoing phrase': true,
  };
  var SAFETY_FALLBACK_TIERS = { weak: true, reject: true };

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function tierOf(plan) {
    return plan && plan.chosen && plan.chosen.evaluation && plan.chosen.evaluation.tier || '';
  }

  function scoreOf(plan) {
    var chosen = plan && plan.chosen || {};
    var evaluation = chosen.evaluation || {};
    var score = Number(evaluation.score);
    if (isFinite(score)) return score;
    score = Number(chosen.score);
    return isFinite(score) ? score : 0;
  }

  function hasHardRisk(plan) {
    var risks = plan && plan.chosen && plan.chosen.evaluation && plan.chosen.evaluation.risks || [];
    for (var i = 0; i < risks.length; i++) {
      if (HARD_RISKS[risks[i]]) return true;
    }
    return false;
  }

  function recipeOf(plan) {
    var chosen = plan && plan.chosen || {};
    return chosen.transitionRecipe || chosen.recipeCandidate && chosen.recipeCandidate.recipe || '';
  }

  function shouldUseSafetyFallback(plan, deps) {
    if (!deps || !deps.allowSafetyFallback) return false;
    if (recipeOf(plan) === 'safety-long-blend') return true;
    return !!SAFETY_FALLBACK_TIERS[tierOf(plan)] && !hasHardRisk(plan);
  }

  function isExecutablePlan(plan, deps) {
    var tier = tierOf(plan);
    var recipe = recipeOf(plan);
    if (EXECUTABLE_TIERS[tier]) return true;
    if (shouldUseSafetyFallback(plan, deps)) return true;
    if (tier !== 'weak' || !deps.allowWeak) return false;
    if (hasHardRisk(plan)) return false;
    return scoreOf(plan) >= toNumber(deps.minWeakScore, 0.58);
  }

  function executionModeFor(plan, deps) {
    var recipe = recipeOf(plan);
    if (recipe) return recipe;
    if (shouldUseSafetyFallback(plan, deps)) return 'safety-long-blend';
    return tierOf(plan) === 'weak' ? 'intro-bed' : 'filtered-pickup';
  }

  function safetyFallbackTimeline() {
    return [
      { t: -12, deck: 'B', op: 'play', at: 0, volume: 0 },
      { t: -12, deck: 'B', op: 'bass', value: 0.08, duration: 0 },
      { t: -12, deck: 'B', op: 'filter', type: 'highpass', value: 1200, duration: 0 },
      { t: -12, deck: 'B', op: 'volume', value: 0.24, duration: 2600 },
      { t: -9.2, deck: 'A', op: 'filter', type: 'highpass', value: 420, duration: 3200 },
      { t: -8.2, deck: 'A', op: 'bass', value: 0.55, duration: 2800 },
      { t: -6.4, deck: 'B', op: 'volume', value: 0.46, duration: 3600 },
      { t: -4.2, deck: 'B', op: 'filter', type: 'highpass', value: 520, duration: 2600 },
      { t: -3.4, deck: 'A', op: 'bass', value: 0.18, duration: 2400 },
      { t: -2.4, deck: 'B', op: 'volume', value: 0.74, duration: 2200 },
      { t: -1.1, deck: 'B', op: 'bass', value: 0.72, duration: 1800 },
      { t: 0, deck: 'B', op: 'filter', type: 'none', value: 0, duration: 1600 },
      { t: 0.4, deck: 'A', op: 'volume', value: 0.16, duration: 2400 },
      { t: 2.9, deck: 'A', op: 'volume', value: 0, duration: 900 },
      { t: 3.8, deck: 'B', op: 'bass', value: 1, duration: 1600 },
      { t: 4.8, deck: 'B', op: 'handoff' },
    ];
  }

  function timelineOf(plan, deps) {
    var chosen = plan && plan.chosen || {};
    if (Array.isArray(chosen.timeline) && chosen.timeline.length) return chosen.timeline;
    return shouldUseSafetyFallback(plan, deps) ? safetyFallbackTimeline() : [];
  }

  function timelineLeadSec(timeline, fallback) {
    var lead = 0;
    for (var i = 0; i < timeline.length; i++) {
      var t = toNumber(timeline[i] && timeline[i].t, 0);
      if (t < 0) lead = Math.max(lead, Math.abs(t));
    }
    return lead > 0 ? lead : fallback;
  }

  function timelineBStart(timeline, fallback) {
    for (var i = 0; i < timeline.length; i++) {
      var action = timeline[i] || {};
      if (action.deck === 'B' && action.op === 'play') {
        return Math.max(0, toNumber(action.at, fallback));
      }
    }
    return fallback;
  }

  function createCuefieldAutoMix(deps) {
    deps = deps || {};
    var state = {
      enabled: false,
      preparing: false,
      pending: null,
      lastStatus: 'idle',
      serial: 0,
    };

    function reset(status) {
      state.pending = null;
      state.preparing = false;
      state.lastStatus = status || 'idle';
      state.serial++;
    }

    function setEnabled(enabled) {
      state.enabled = !!enabled;
      if (!state.enabled) reset('disabled');
      return state.enabled;
    }

    async function prepare(ctx) {
      ctx = ctx || {};
      if (!state.enabled) return { status: 'disabled' };
      if (state.preparing) return { status: 'busy' };
      var currentSong = ctx.currentSong;
      var nextSong = ctx.nextSong;
      if (!currentSong || !nextSong) {
        reset('missing-queue');
        return { status: 'missing-queue' };
      }
      var getKey = deps.getKey || function(song) { return song && song.key || ''; };
      var fromKey = getKey(currentSong);
      var toKey = getKey(nextSong);
      if (!fromKey || !toKey || fromKey === toKey) {
        reset('missing-key');
        return { status: 'missing-key' };
      }

      var serial = ++state.serial;
      state.preparing = true;
      state.lastStatus = 'preparing';
      try {
        if (deps.ensureBeatMap) {
          var fromReady = await deps.ensureBeatMap(currentSong, fromKey, ctx);
          if (serial !== state.serial) return { status: 'stale' };
          var toReady = await deps.ensureBeatMap(nextSong, toKey, ctx);
          if (serial !== state.serial) return { status: 'stale' };
          if (!fromReady || !toReady) {
            reset('waiting-beatmap');
            return { status: 'waiting-beatmap' };
          }
        }
        if (!deps.planTransition) throw new Error('PLAN_TRANSITION_REQUIRED');
        var plan = await deps.planTransition(fromKey, toKey, ctx);
        if (serial !== state.serial) return { status: 'stale' };
        var chosen = plan && plan.chosen;
        var tier = tierOf(plan);
        if (!plan || !plan.ok || !chosen || !isExecutablePlan(plan, deps)) {
          reset('fallback');
          return { status: 'fallback', plan: plan || null };
        }
        var audioUrl = deps.prepareAudioUrl ? await deps.prepareAudioUrl(nextSong, ctx) : '';
        if (serial !== state.serial) return { status: 'stale' };
        if (!audioUrl) {
          reset('missing-audio');
          return { status: 'missing-audio', plan: plan };
        }

        var exitTime = toNumber(chosen.exit && chosen.exit.time, NaN);
        var executionMode = executionModeFor(plan, deps);
        var timeline = timelineOf(plan, deps);
        var fallbackLeadSec = executionMode === 'intro-bed'
          ? toNumber(ctx.introBedLeadSec, toNumber(ctx.leadSec, 1))
          : toNumber(ctx.leadSec, 1);
        var leadSec = timelineLeadSec(timeline, fallbackLeadSec);
        var triggerAt = isFinite(exitTime) ? Math.max(0, exitTime - leadSec) : 0;
        var entryTime = timelineBStart(timeline, Math.max(0, toNumber(chosen.entry && chosen.entry.time, 0)));
        state.pending = {
          token: ctx.token,
          currentIndex: ctx.currentIndex,
          nextIndex: ctx.nextIndex,
          fromKey: fromKey,
          toKey: toKey,
          plan: plan,
          timeline: timeline,
          audioUrl: audioUrl,
          executionMode: executionMode,
          entryTime: entryTime,
          exitTime: exitTime,
          triggerAt: triggerAt,
          createdAt: Date.now(),
        };
        state.lastStatus = 'ready';
        return { status: 'ready', pending: state.pending };
      } catch (err) {
        reset('error');
        return { status: 'error', error: err && err.message ? err.message : String(err) };
      } finally {
        state.preparing = false;
      }
    }

    function shouldTrigger(ctx) {
      ctx = ctx || {};
      var pending = state.pending;
      if (!state.enabled || !pending) return false;
      if (pending.token !== ctx.token) return false;
      if (pending.currentIndex !== ctx.currentIndex) return false;
      return toNumber(ctx.currentTime, 0) >= pending.triggerAt;
    }

    function consumePending() {
      var pending = state.pending;
      state.pending = null;
      state.lastStatus = pending ? 'consumed' : state.lastStatus;
      return pending;
    }

    function snapshot() {
      return {
        enabled: state.enabled,
        preparing: state.preparing,
        lastStatus: state.lastStatus,
        pending: state.pending,
      };
    }

    return {
      setEnabled: setEnabled,
      reset: reset,
      prepare: prepare,
      shouldTrigger: shouldTrigger,
      consumePending: consumePending,
      snapshot: snapshot,
    };
  }

  return {
    createCuefieldAutoMix: createCuefieldAutoMix,
  };
});

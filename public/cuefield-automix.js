(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuefieldAutoMix = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var EXECUTABLE_TIERS = { magic: true, usable: true, usable_but_not_magic: true };

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function tierOf(plan) {
    return plan && plan.chosen && plan.chosen.evaluation && plan.chosen.evaluation.tier || '';
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
        if (!plan || !plan.ok || !chosen || !EXECUTABLE_TIERS[tier]) {
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
        var triggerAt = isFinite(exitTime) ? Math.max(0, exitTime - toNumber(ctx.leadSec, 1)) : 0;
        var entryTime = Math.max(0, toNumber(chosen.entry && chosen.entry.time, 0));
        state.pending = {
          token: ctx.token,
          currentIndex: ctx.currentIndex,
          nextIndex: ctx.nextIndex,
          fromKey: fromKey,
          toKey: toKey,
          plan: plan,
          audioUrl: audioUrl,
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

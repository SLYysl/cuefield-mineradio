const assert = require('node:assert/strict');
const test = require('node:test');

const { chooseTransitionWindow } = require('../cuefield/transition-window-planner');
const { createCuefieldAutoMix } = require('../public/cuefield-automix');

test('prepares a transition for the current and next queue items before playback reaches the exit', async () => {
  const calls = [];
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async (song, key) => {
      calls.push(['beatmap', key]);
      return true;
    },
    planTransition: async (fromKey, toKey) => {
      calls.push(['plan', fromKey, toKey]);
      return {
        ok: true,
        chosen: {
          recipe: 'section-jump',
          score: 0.86,
          exit: { time: 42 },
          entry: { time: 12 },
          evaluation: { tier: 'usable', risks: [] },
        },
      };
    },
    prepareAudioUrl: async (song) => {
      calls.push(['audio', song.key]);
      return '/api/audio?url=b';
    },
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 7,
    currentIndex: 1,
    nextIndex: 2,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(calls, [
    ['beatmap', 'a'],
    ['beatmap', 'b'],
    ['plan', 'a', 'b'],
    ['audio', 'b'],
  ]);
  assert.equal(automix.shouldTrigger({ token: 7, currentIndex: 1, currentTime: 40.9 }), false);
  assert.equal(automix.shouldTrigger({ token: 7, currentIndex: 1, currentTime: 41 }), true);
});

test('holds automatic transitions until a dynamic minimum listening floor', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.9,
        exit: { time: 30 },
        evaluation: { tier: 'usable', risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 31,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    durationSec: 240,
  });

  assert.equal(result.pending.minimumListenUntil, 100.8);
  assert.equal(result.pending.triggerAt, 100.8);
  assert.equal(automix.shouldTrigger({ token: 31, currentIndex: 0, currentTime: 100.7 }), false);
  assert.equal(automix.shouldTrigger({ token: 31, currentIndex: 0, currentTime: 100.8 }), true);
});

test('lets a later signature section extend but never shorten the listening floor', async () => {
  const prepareWithProtection = async (protectedUntil) => {
    const automix = createCuefieldAutoMix({
      getKey: (song) => song.key,
      ensureBeatMap: async () => true,
      planTransition: async () => ({
        ok: true,
        chosen: {
          recipe: 'section-jump',
          score: 0.9,
          exit: { time: 40 },
          protectedUntil,
          evaluation: { tier: 'usable', risks: [] },
        },
      }),
      prepareAudioUrl: async () => '/api/audio?url=b',
    });
    automix.setEnabled(true);
    return automix.prepare({
      token: protectedUntil,
      currentIndex: 0,
      nextIndex: 1,
      currentSong: { key: 'a' },
      nextSong: { key: 'b' },
      durationSec: 180,
    });
  };

  assert.equal((await prepareWithProtection(30)).pending.triggerAt, 75.6);
  assert.equal((await prepareWithProtection(92)).pending.triggerAt, 92);
});

test('keeps weak or rejected transition plans as fallback instead of auto executing', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.63,
        exit: { time: 28 },
        entry: { time: 4 },
        evaluation: { tier: 'weak', risks: ['directionality mismatch'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 2,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 2, currentIndex: 0, currentTime: 29 }), false);
});

test('can execute weak transition plans in soft automix mode when no hard risk is present', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.58,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.64,
        exit: { time: 28 },
        entry: { time: 4 },
        evaluation: { score: 0.63, tier: 'weak', risks: ['directionality mismatch'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 2,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.equal(automix.shouldTrigger({ token: 2, currentIndex: 0, currentTime: 27 }), true);
});

test('assigns filtered pickup to usable plans and intro bed to weak plans', async () => {
  const makeAutomix = (tier, score) => createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.82,
        exit: { time: 40 },
        entry: { time: 10 },
        evaluation: { score, tier, risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  const usable = makeAutomix('usable', 0.86);
  usable.setEnabled(true);
  const usableResult = await usable.prepare({
    token: 8,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  const weak = makeAutomix('weak', 0.57);
  weak.setEnabled(true);
  const weakResult = await weak.prepare({
    token: 9,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 2.8,
    introBedLeadSec: 5.2,
  });

  assert.equal(usableResult.pending.executionMode, 'filtered-pickup');
  assert.equal(weakResult.pending.executionMode, 'intro-bed');
  assert.equal(weakResult.pending.triggerAt, 34.8);
});

test('uses recipe planner timeline for execution mode, trigger lead, and B start', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'outro-to-chorus',
        transitionRecipe: 'intro-outro-long-blend',
        score: 0.9,
        exit: { time: 40 },
        entry: { time: 24 },
        evaluation: { score: 0.86, tier: 'usable', risks: [] },
        timeline: [
          { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
          { t: 0, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 10,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 2.8,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.pending.executionMode, 'intro-outro-long-blend');
  assert.equal(result.pending.entryTime, 8);
  assert.equal(result.pending.triggerAt, 32);
  assert.equal(result.pending.timeline.length, 2);
});

test('uses explicit mixStart and copies transition window diagnostics into pending state', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 53 },
        entry: { time: 12 },
        protectedUntil: 40,
        mixStart: 48.25,
        handoffAt: 51.25,
        audibleOverlap: 3,
        preRollDuration: 2,
        exitRatio: 0.7,
        evaluation: { tier: 'usable', risks: [] },
        timeline: [
          { t: 0, deck: 'B', op: 'play', at: 0 },
          { t: 3, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 13,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 5,
  });

  assert.equal(result.pending.triggerAt, 48.25);
  assert.equal(result.pending.mixStart, 48.25);
  assert.equal(result.pending.handoffAt, 51.25);
  assert.equal(result.pending.audibleOverlap, 3);
  assert.equal(result.pending.preRollDuration, 2);
  assert.equal(result.pending.exitRatio, 0.7);
});

test('keeps legacy exit minus lead trigger when mixStart is absent', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 53 },
        entry: { time: 12 },
        evaluation: { tier: 'usable', risks: [] },
        timeline: [],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 14,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 5,
  });

  assert.equal(result.pending.triggerAt, 48);
});

test('treats null mixStart as legacy timing instead of a zero fallback', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 53 },
        entry: { time: 12 },
        protectedUntil: 40,
        mixStart: null,
        evaluation: { tier: 'usable', risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 15,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 5,
  });

  assert.equal(result.pending.triggerAt, 48);
  assert.equal(Object.prototype.hasOwnProperty.call(result.pending, 'mixStart'), false);
});

test('uses legacy timing when an explicit window has no positive handoff span', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 100 },
        entry: { time: 12 },
        mixStart: 50,
        handoffAt: 50,
        evaluation: { tier: 'usable', risks: [] },
        timeline: [
          { t: -8, deck: 'B', op: 'play', at: 4, volume: 0 },
          { t: 2.6, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 20,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.pending.triggerAt, 92);
  assert.equal(Object.prototype.hasOwnProperty.call(result.pending, 'mixStart'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.pending, 'handoffAt'), false);
});

test('clamps an explicit mixStart below protectedUntil', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 53 },
        entry: { time: 12 },
        protectedUntil: 40,
        mixStart: 35,
        handoffAt: 45,
        evaluation: { tier: 'usable', risks: [] },
        timeline: [{ t: 0, deck: 'B', op: 'handoff' }],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 16,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.pending.triggerAt, 40);
});

test('keeps the pending mixStart field absent when the plan omits it', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 53 },
        entry: { time: 12 },
        protectedUntil: 40,
        evaluation: { tier: 'usable', risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 17,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
    leadSec: 5,
  });

  assert.equal(result.pending.triggerAt, 48);
  assert.equal(Object.prototype.hasOwnProperty.call(result.pending, 'mixStart'), false);
});

test('executes honest start fallback only with safety opt-in and preserves its timeline', async () => {
  const makeAutomix = (allowSafetyFallback) => createCuefieldAutoMix({
    allowSafetyFallback,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        transitionRecipe: 'honest-start-fallback',
        exit: { time: 48 },
        entry: { time: 0 },
        evaluation: { tier: 'usable', risks: ['no valid complete transition window'] },
        timeline: [
          { t: 0, deck: 'B', op: 'play', at: 0, volume: 0 },
          { t: 0, deck: 'B', op: 'volume', value: 1, duration: 3400 },
          { t: 0, deck: 'A', op: 'volume', value: 0, duration: 3400 },
          { t: 3.4, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  const enabled = makeAutomix(true);
  enabled.setEnabled(true);
  const ready = await enabled.prepare({
    token: 18,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.pending.executionMode, 'honest-start-fallback');
  assert.equal(ready.pending.timeline.length, 4);
  assert.equal(ready.pending.timeline[3].t, 3.4);

  const disabled = makeAutomix(false);
  disabled.setEnabled(true);
  const fallback = await disabled.prepare({
    token: 19,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });
  assert.equal(fallback.status, 'fallback');
});

function validTerminalPlan(overrides = {}) {
  const timeline = overrides.timeline || [
    { t: 0, deck: 'B', op: 'play', at: 0, volume: 0 },
    { t: 0, deck: 'B', op: 'volume', value: 1, duration: 3400 },
    { t: 0, deck: 'A', op: 'volume', value: 0, duration: 3400 },
    { t: 3.4, deck: 'B', op: 'handoff' },
  ];
  return {
    ok: true,
    chosen: {
      transitionRecipe: 'terminal-rescue',
      exit: { time: 48 },
      entry: { time: 0 },
      mixStart: 48,
      handoffAt: 51.4,
      evaluation: { score: 0.1, tier: 'weak', risks: ['missing-structure'] },
      ...overrides,
      timeline,
    },
  };
}

function automixForTerminalPlan(plan, allowSafetyFallback = true) {
  return createCuefieldAutoMix({
    allowSafetyFallback,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => plan,
    prepareAudioUrl: async () => '/api/audio?url=b',
  });
}

async function prepareTerminalPlan(automix, token) {
  automix.setEnabled(true);
  return automix.prepare({
    token,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });
}

test('executes terminal rescue only with safety opt-in and a valid explicit timeline', async () => {
  const plan = validTerminalPlan();
  const makeAutomix = (allowSafetyFallback, timeline) => createCuefieldAutoMix({
    allowSafetyFallback,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => validTerminalPlan({ timeline }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });
  const prepare = async (automix, token) => {
    automix.setEnabled(true);
    return automix.prepare({
      token,
      currentIndex: 0,
      nextIndex: 1,
      currentSong: { key: 'a' },
      nextSong: { key: 'b' },
    });
  };
  const timeline = plan.chosen.timeline;

  const ready = await prepare(makeAutomix(true, timeline), 20);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.pending.executionMode, 'terminal-rescue');
  assert.deepEqual(ready.pending.timeline, timeline);

  const disabled = await prepare(makeAutomix(false, timeline), 21);
  assert.equal(disabled.status, 'fallback');

  const empty = await prepare(makeAutomix(true, []), 22);
  assert.equal(empty.status, 'fallback');
});

test('executes the genuine planner terminal rescue timeline', async () => {
  const analysis = (duration, protectedUntil = 0) => ({
    duration,
    bpm: 120,
    bars: [],
    structureMap: {
      structureSource: 'beat-only',
      protectedUntil,
      exitCandidates: [],
      entryCandidates: [],
      sections: [],
    },
    candidates: [],
  });
  const windowPlan = chooseTransitionWindow(analysis(128, 60), analysis(96));
  const plan = {
    ok: true,
    chosen: {
      ...windowPlan.chosen,
      transitionRecipe: windowPlan.chosen.recipeCandidate.recipe,
      evaluation: { score: 0.1, tier: 'weak', risks: ['missing-structure'] },
    },
  };

  assert.equal(plan.chosen.transitionRecipe, 'terminal-rescue');
  const result = await prepareTerminalPlan(automixForTerminalPlan(plan), 24);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.pending.timeline, windowPlan.chosen.timeline);
});

test('returns a retryable technical status for a failed terminal rescue plan', async () => {
  const automix = createCuefieldAutoMix({
    allowSafetyFallback: true,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: false,
      error: 'TERMINAL_RESCUE_INVALID_DURATION',
      chosen: {
        transitionRecipe: 'terminal-rescue',
        technicalFailure: true,
        errorCode: 'TERMINAL_RESCUE_INVALID_DURATION',
        evaluation: { score: 0.1, tier: 'weak', risks: [] },
        timeline: [{ t: 3.4, deck: 'B', op: 'handoff' }],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 23,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'technical-error');
  assert.equal(result.error, 'TERMINAL_RESCUE_INVALID_DURATION');
});

test('rejects malformed ok terminal rescue plans before audio preparation', async (t) => {
  const validTimeline = validTerminalPlan().chosen.timeline;
  const at = (timeline, predicate, updates) => timeline.map((action) => (
    predicate(action) ? { ...action, ...updates } : action
  ));
  const cases = [
    ['chosen technical failure', validTerminalPlan({ technicalFailure: true, errorCode: 'TERMINAL_RESCUE_INVALID_DURATION' })],
    ['missing mix start', validTerminalPlan({ mixStart: undefined })],
    ['null mix start', validTerminalPlan({ mixStart: null })],
    ['non-finite handoff', validTerminalPlan({ handoffAt: Infinity })],
    ['string handoff', validTerminalPlan({ handoffAt: '51.4' })],
    ['reversed explicit window', validTerminalPlan({ handoffAt: 47 })],
    ['missing B play', validTerminalPlan({ timeline: validTimeline.filter((action) => action.op !== 'play') })],
    ['missing A volume ramp', validTerminalPlan({ timeline: validTimeline.filter((action) => !(action.deck === 'A' && action.op === 'volume')) })],
    ['missing B volume ramp', validTerminalPlan({ timeline: validTimeline.filter((action) => !(action.deck === 'B' && action.op === 'volume')) })],
    ['zero-duration volume ramp', validTerminalPlan({ timeline: validTimeline.map((action) => action.op === 'volume' ? { ...action, duration: 0 } : action) })],
    ['string action timing', validTerminalPlan({ timeline: validTimeline.map((action) => ({ ...action, t: String(action.t) })) })],
    ['missing handoff', validTerminalPlan({ timeline: validTimeline.filter((action) => action.op !== 'handoff') })],
    ['play and fades after an early handoff', validTerminalPlan({
      timeline: validTimeline.map((action) => action.op === 'handoff' ? { ...action, t: 0 } : { ...action, t: 5 }),
    })],
    ['negative action ordering', validTerminalPlan({
      timeline: [...validTimeline, { t: -0.01, deck: 'B', op: 'bass', value: 0.2, duration: 0 }],
    })],
    ['operation after handoff', validTerminalPlan({
      timeline: [...validTimeline, { t: 3.41, deck: 'B', op: 'bass', value: 1, duration: 0 }],
    })],
    ['mismatched handoff offset', validTerminalPlan({
      timeline: at(validTimeline, (action) => action.op === 'handoff', { t: 3.2 }),
    })],
    ['action duration overruns handoff', validTerminalPlan({
      timeline: at(validTimeline, (action) => action.op === 'volume', { duration: 3415 }),
    })],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [label, plan] = cases[index];
    await t.test(label, async () => {
      const result = await prepareTerminalPlan(automixForTerminalPlan(plan), 30 + index);
      assert.equal(result.status, 'fallback');
    });
  }
});

test('never starts transition actions before the protected signature section ends', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        transitionRecipe: 'intro-outro-long-blend',
        exit: { time: 42 },
        entry: { time: 16, source: 'lyric+beat' },
        protectedUntil: 40,
        evaluation: { score: 0.86, tier: 'usable', risks: [] },
        timeline: [
          { t: -8, deck: 'B', op: 'play', at: 8, volume: 0 },
          { t: 0, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 11,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.pending.triggerAt, 40);
  assert.equal(automix.shouldTrigger({ token: 11, currentIndex: 0, currentTime: 39.9 }), false);
});

test('does not execute weak transition plans with hard outgoing phrase risk', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.58,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.66,
        exit: { time: 30 },
        entry: { time: 5 },
        evaluation: { score: 0.64, tier: 'weak', risks: ['closed outgoing phrase'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 3,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 3, currentIndex: 0, currentTime: 29 }), false);
});

test('does not execute rejected plans even when soft automix mode allows weak plans', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.5,
        exit: { time: 30 },
        entry: { time: 6 },
        evaluation: { score: 0.42, tier: 'reject', risks: ['directionality mismatch'] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 6,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(automix.shouldTrigger({ token: 6, currentIndex: 0, currentTime: 29 }), false);
});

test('executes safety long blend even when the section evaluation is rejected', async () => {
  const automix = createCuefieldAutoMix({
    allowWeak: true,
    allowSafetyFallback: true,
    minWeakScore: 0.55,
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        transitionRecipe: 'safety-long-blend',
        score: 0.5,
        exit: { time: 48 },
        entry: { time: 32 },
        evaluation: { score: 0.42, tier: 'reject', risks: ['directionality mismatch'] },
        timeline: [
          { t: -12, deck: 'B', op: 'play', at: 0, volume: 0 },
          { t: -12, deck: 'B', op: 'volume', value: 0.24, duration: 2600 },
          { t: 4.8, deck: 'B', op: 'handoff' },
        ],
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  const result = await automix.prepare({
    token: 12,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.pending.executionMode, 'safety-long-blend');
  assert.equal(result.pending.entryTime, 0);
  assert.equal(result.pending.triggerAt, 36);
  assert.equal(automix.shouldTrigger({ token: 12, currentIndex: 0, currentTime: 36 }), true);
});

test('does not reuse a prepared transition after queue token or index changes', async () => {
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => ({
      ok: true,
      chosen: {
        recipe: 'section-jump',
        score: 0.88,
        exit: { time: 16 },
        entry: { time: 8 },
        evaluation: { tier: 'usable', risks: [] },
      },
    }),
    prepareAudioUrl: async () => '/api/audio?url=b',
  });

  automix.setEnabled(true);
  await automix.prepare({
    token: 4,
    currentIndex: 2,
    nextIndex: 3,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(automix.shouldTrigger({ token: 5, currentIndex: 2, currentTime: 20 }), false);
  assert.equal(automix.shouldTrigger({ token: 4, currentIndex: 1, currentTime: 20 }), false);
  assert.equal(automix.shouldTrigger({ token: 4, currentIndex: 2, currentTime: 20 }), true);
});

test('preserves a selected bridge plan in pending runtime state', async () => {
  const bridgePlan = { template: 'drum-build', bars: 8, climax: { time: 64, type: 'hook', confidence: 0.88 } };
  const plan = {
    ok: true,
    chosen: {
      recipe: 'synthetic-bridge',
      score: 0.82,
      exit: { time: 48 },
      entry: { time: 64 },
      evaluation: { tier: 'usable', score: 0.82, risks: [] },
    },
  };
  plan.chosen.transitionRecipe = 'synthetic-bridge';
  plan.chosen.bridgePlan = bridgePlan;
  plan.chosen.timeline = [
    { t: 0, deck: 'A', op: 'bridge', duration: 16000, bridge: { template: 'drum-build', bars: 8, bpmFrom: 120, bpmTo: 126 } },
    { t: 16, deck: 'B', op: 'handoff' },
  ];
  plan.chosen.mixStart = 48;
  plan.chosen.handoffAt = 64;
  const automix = createCuefieldAutoMix({
    getKey: (song) => song.key,
    ensureBeatMap: async () => true,
    planTransition: async () => plan,
    prepareAudioUrl: async () => '/audio/b',
  });
  automix.setEnabled(true);

  const result = await automix.prepare({
    token: 1,
    currentIndex: 0,
    nextIndex: 1,
    currentSong: { key: 'a' },
    nextSong: { key: 'b' },
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.pending.bridgePlan, bridgePlan);
  assert.equal(result.pending.executionMode, 'synthetic-bridge');
});

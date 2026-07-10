const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCueProfile } = require('../cuefield/cue-profile');
const {
  buildSafetyTimelineForAnchors,
  measureTimelineWindow,
  planRecipeCandidates,
} = require('../cuefield/recipe-planner');

function makeBeatMap(duration = 128, gridStep = 0.5) {
  const beats = [];
  for (let time = 0, index = 0; time < duration; time += gridStep, index++) {
    const inOutro = time >= duration - 16;
    beats.push({
      time: Number(time.toFixed(3)),
      confidence: 0.9,
      phrase: index % 32 === 0,
      downbeat: index % 4 === 0,
      low: inOutro ? 0.22 : 0.46,
      body: inOutro ? 0.25 : 0.42,
      snap: index % 4 === 0 ? 0.62 : 0.28,
      impact: index % 4 === 0 ? 0.68 : 0.34,
      step: gridStep,
    });
  }
  return { duration, gridStep, beats };
}

function makeProfile(title, duration, candidates, mutateBeat) {
  const map = makeBeatMap(duration);
  if (typeof mutateBeat === 'function') {
    map.beats = map.beats.map((beat) => mutateBeat({ ...beat }));
  }
  return buildCueProfile({
    track: { title, duration },
    map,
    candidates,
  });
}

test('builds cue profile bars, cue points, and density windows from beatmap data', () => {
  const profile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(),
    candidates: [
      { type: 'outro', role: 'exit', time: 112, confidence: 0.7 },
      { type: 'intro', role: 'entry', time: 8, confidence: 0.6 },
    ],
  });

  assert.equal(profile.duration, 128);
  assert.equal(profile.downbeats.length > 20, true);
  assert.equal(profile.bars.length > 20, true);
  assert.equal(profile.cuePoints.outroStart, 112);
  assert.equal(profile.cuePoints.introStart, 8);
  assert.equal(profile.windows.bass.length > 0, true);
});

test('measures silent B pre-roll separately from an audible dual-deck overlap', () => {
  const window = measureTimelineWindow([
    { t: -5, deck: 'B', op: 'play', at: 8, volume: 0 },
    { t: -1.8, deck: 'B', op: 'volume', value: 1, duration: 1800, curve: 'equal-power-in' },
    { t: -1.8, deck: 'A', op: 'volume', value: 0, duration: 1800, curve: 'equal-power-out' },
    { t: 0.6, deck: 'B', op: 'handoff' },
  ]);

  assert.equal(window.preRollDuration > window.audibleOverlap, true);
  assert.equal(window.audibleOverlap >= 1.5 && window.audibleOverlap <= 2.1, true);
  assert.equal(window.audibleStart > -5, true);
  assert.equal(window.audibleEnd > window.audibleStart, true);
  assert.equal(window.handoffOffset, 0.6);
});

test('measures linear and equal-power threshold crossings within 0.01 seconds', () => {
  const linear = measureTimelineWindow([
    { t: -2, deck: 'B', op: 'play', at: 0, volume: 0 },
    { t: -2, deck: 'B', op: 'volume', value: 1, duration: 4000 },
    { t: -2, deck: 'A', op: 'volume', value: 0, duration: 4000 },
    { t: 2, deck: 'B', op: 'handoff' },
  ], 0.25);
  const equalPower = measureTimelineWindow([
    { t: -2, deck: 'B', op: 'play', at: 0, volume: 0 },
    { t: -2, deck: 'B', op: 'volume', value: 1, duration: 4000, curve: 'equal-power-in' },
    { t: -2, deck: 'A', op: 'volume', value: 0, duration: 4000, curve: 'equal-power-out' },
    { t: 2, deck: 'B', op: 'handoff' },
  ]);

  assert.equal(Math.abs(linear.audibleStart - -1) <= 0.01, true);
  assert.equal(Math.abs(linear.audibleEnd - 1) <= 0.01, true);
  assert.equal(Math.abs(linear.audibleOverlap - 2) <= 0.01, true);
  assert.equal(Math.abs(equalPower.audibleStart - -1.796) <= 0.01, true);
  assert.equal(Math.abs(equalPower.audibleEnd - 1.796) <= 0.01, true);
  assert.equal(Math.abs(equalPower.audibleOverlap - 3.592) <= 0.01, true);
});

test('captures an overlapping A ramp start gain before the later ramp overrides it', () => {
  const window = measureTimelineWindow([
    { t: -1, deck: 'B', op: 'play', at: 0, volume: 1 },
    { t: 0, deck: 'A', op: 'volume', value: 0, duration: 10000 },
    { t: 5, deck: 'A', op: 'volume', value: 1, duration: 5000 },
    { t: 10, deck: 'B', op: 'handoff' },
  ], 0.7);

  assert.equal(Math.abs(window.audibleStart - 7) <= 0.01, true);
  assert.equal(Math.abs(window.audibleEnd - 10) <= 0.01, true);
  assert.equal(Math.abs(window.audibleOverlap - 3) <= 0.01, true);
});

test('reports the longest separated dual-audible interval without merging gaps', () => {
  const window = measureTimelineWindow([
    { t: -4, deck: 'B', op: 'play', at: 0, volume: 0 },
    { t: -4, deck: 'B', op: 'volume', value: 1, duration: 1000 },
    { t: -3, deck: 'B', op: 'volume', value: 0, duration: 0 },
    { t: -2, deck: 'B', op: 'volume', value: 1, duration: 1000 },
    { t: -1, deck: 'B', op: 'volume', value: 0, duration: 0 },
    { t: 0, deck: 'B', op: 'handoff' },
  ], 0.5);

  assert.equal(Math.abs(window.audibleStart - -3.5) <= 0.01, true);
  assert.equal(Math.abs(window.audibleEnd - -3) <= 0.01, true);
  assert.equal(Math.abs(window.audibleOverlap - 0.5) <= 0.01, true);
  assert.equal(window.preRollDuration, 0.5);
});

test('aligns safety B playback so the handoff lands at the requested B position', () => {
  const execution = buildSafetyTimelineForAnchors({
    bLandingAt: 32,
    overlapClass: 'medium',
    overlapDuration: 5.6,
  });
  const play = execution.timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const handoff = execution.timeline.find((action) => action.op === 'handoff');

  assert.equal(Math.abs(play.at + (handoff.t - play.t) - 32) <= 0.01, true);
  assert.equal(execution.runwayAvailable, true);
  assert.equal(execution.landingError, 0);
  assert.equal(measureTimelineWindow(execution.timeline).handoffOffset, handoff.t);
});

test('marks insufficient B runway explicitly and never emits a negative media position', () => {
  const execution = buildSafetyTimelineForAnchors({
    bLandingAt: 2,
    overlapClass: 'short',
    overlapDuration: 3.4,
  });
  const playActions = execution.timeline.filter((action) => action.deck === 'B' && action.op === 'play');

  assert.equal(playActions.every((action) => action.at >= 0), true);
  assert.equal(execution.runwayAvailable, false);
  assert.equal(Math.abs(execution.landingError) > 0.01, true);
});

test('short safety keeps B bass reduced until the final handoff window', () => {
  const execution = buildSafetyTimelineForAnchors({
    bLandingAt: 32,
    overlapClass: 'short',
    overlapDuration: 3.4,
  });
  const bFullBass = execution.timeline.find((action) => action.deck === 'B' && action.op === 'bass' && action.value === 1);
  const aFullBass = execution.timeline.find((action) => action.deck === 'A' && action.op === 'bass' && action.value === 1);
  const window = measureTimelineWindow(execution.timeline);

  assert.equal(window.audibleOverlap >= 3, true);
  assert.equal(window.handoffOffset, 0.6);
  assert.equal(bFullBass.t >= 0, true);
  assert.equal(aFullBass, undefined);
});

test('route policy forces late rises short and caps late releases at medium overlap', () => {
  const fromProfile = makeProfile('A', 128, [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }]);
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.82, resolvesTo: { time: 12 } };
  const toProfile = makeProfile('B', 120, [entry]);
  const sectionChoice = { exit: { time: 112 }, entry, evaluation: { tier: 'usable', risks: [] } };

  const rise = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice,
    routePolicy: { route: 'late-contrast-rise', overlapClass: 'short' },
  });
  const release = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice,
    routePolicy: { route: 'late-contrast-release', overlapClass: 'short-or-medium' },
  });

  assert.equal(rise.chosen.anchors.overlapClass, 'short');
  assert.equal(rise.diagnostics.overlapClass, 'short');
  assert.notEqual(release.chosen.anchors.overlapClass, 'long');
  assert.equal(release.diagnostics.overlapClass === 'short' || release.diagnostics.overlapClass === 'medium', true);
});

test('plans multiple recipe candidates with timelines and chooses the safest high score', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128),
    candidates: [
      { type: 'outro', role: 'exit', time: 112, confidence: 0.78, energyBefore: 0.6, energyAfter: 0.3 },
    ],
  });
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 96 },
    map: makeBeatMap(96),
    candidates: [
      { type: 'intro', role: 'entry', time: 8, confidence: 0.7, energyBefore: 0.2, energyAfter: 0.48 },
      { type: 'hook', role: 'entry', time: 24, confidence: 0.76, energyBefore: 0.42, energyAfter: 0.7 },
    ],
  });

  const plan = planRecipeCandidates(fromProfile, toProfile);
  const recipes = plan.candidates.map((candidate) => candidate.recipe);

  assert.equal(Array.isArray(plan.candidates), true);
  assert.equal(recipes.includes('intro-outro-long-blend'), true);
  assert.equal(recipes.includes('safety-long-blend'), true);
  assert.equal(recipes.includes('filtered-pickup'), true);
  assert.equal(recipes.includes('bass-eq-handoff'), true);
  assert.equal(recipes.includes('quick-safe-fade'), true);
  assert.equal(plan.candidates.every((candidate) => candidate.timeline.length > 0), true);
  assert.equal(plan.candidates.every((candidate) => Number.isFinite(candidate.window.audibleOverlap)), true);
  assert.equal(plan.candidates.every((candidate) => typeof candidate.window.runwayAvailable === 'boolean'), true);
  assert.equal(plan.candidates.every((candidate) => Number.isFinite(candidate.window.landingError)), true);
  assert.equal(plan.candidates.every((candidate) => {
    const play = candidate.timeline.find((action) => action.deck === 'B' && action.op === 'play');
    const handoffs = candidate.timeline.filter((action) => action.op === 'handoff');
    const handoff = handoffs[handoffs.length - 1];
    const expected = play && handoff
      ? play.at + (handoff.t - play.t) - candidate.anchors.bAnchor
      : Number.MAX_SAFE_INTEGER;
    return Math.abs(candidate.window.landingError - expected) <= 0.001;
  }), true);
  assert.equal(plan.candidates.some((candidate) => candidate.window.runwayAvailable), true);
  assert.equal(plan.chosen.window.runwayAvailable, true);
  assert.equal(plan.chosen.recipe, 'safety-long-blend');
  assert.equal(plan.chosen.anchors.overlapClass, 'short');
  assert.equal(plan.chosen.risks.includes('hard cut'), false);
});

test('uses safety long blend for weak or rejected section choices', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128),
    candidates: [
      { type: 'outro', role: 'exit', time: 112, confidence: 0.7 },
    ],
  });
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120),
    candidates: [
      { type: 'intro', role: 'entry', time: 0, confidence: 0.62 },
      { type: 'hook', role: 'entry', time: 48, confidence: 0.8 },
    ],
  });

  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry: { time: 48 },
      evaluation: { tier: 'reject', risks: ['directionality mismatch'] },
    },
  });

  assert.equal(plan.chosen.recipe, 'safety-long-blend');
  assert.equal(plan.chosen.anchors.overlapClass, 'short');
  assert.equal(plan.chosen.window.audibleOverlap >= 3, true);
  assert.equal(plan.chosen.anchors.runwayAvailable, true);
  assert.equal(plan.chosen.anchors.landingError, 0);
  assert.equal(plan.chosen.window.runwayAvailable, true);
  assert.equal(plan.chosen.window.landingError, 0);
  assert.equal(plan.chosen.timeline[0].op, 'play');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'filter' && action.t < -2), false);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'B' && action.op === 'bass' && action.value < 0.2), true);
});

test('keeps invalid safety runway as explicit degraded output when every candidate is invalid', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.7 }],
  });
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120),
    candidates: [{ type: 'intro', role: 'entry', source: 'fallback', time: 0, confidence: 0.52 }],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry: { source: 'fallback', time: 2, confidence: 0.52 },
      evaluation: { tier: 'reject', risks: ['directionality mismatch'] },
    },
  });

  assert.equal(plan.candidates.every((candidate) => candidate.window.runwayAvailable === false), true);
  assert.equal(plan.chosen.recipe, 'safety-long-blend');
  assert.equal(plan.chosen.risks.includes('insufficient B runway'), true);
  assert.equal(plan.chosen.anchors.runwayAvailable, false);
  assert.equal(Number.isFinite(plan.chosen.anchors.landingError), true);
});

test('keeps fallback entries on a short aligned overlap even with a high pair score', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.75),
    candidates: [{ type: 'intro', role: 'entry', source: 'fallback', time: 16, confidence: 0.52 }],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry: { type: 'intro', role: 'entry', source: 'fallback', time: 16, confidence: 0.52 },
      score: 0.99,
      evaluation: { tier: 'reject', score: 0.99, risks: ['directionality mismatch'] },
    },
  });
  const play = plan.chosen.timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const handoff = plan.chosen.timeline.find((action) => action.op === 'handoff');

  assert.equal(plan.chosen.anchors.overlapClass, 'short');
  assert.equal(plan.chosen.window.audibleOverlap >= 3, true);
  assert.equal(plan.chosen.anchors.entrySource, 'fallback');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'filter' && action.t < -2), false);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'B' && action.op === 'volume' && action.curve === 'equal-power-in'), true);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'volume' && action.curve === 'equal-power-out'), true);
  assert.equal(Math.abs((play.at + (handoff.t - play.t)) - plan.chosen.anchors.bAnchor) <= 0.01, true);
});

test('uses medium overlap for a trusted entry with moderate tempo difference', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.74, resolvesTo: { time: 8 } };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.56),
    candidates: [entry],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'weak', risks: [] } },
  });

  assert.equal(plan.chosen.anchors.overlapClass, 'medium');
  assert.equal(plan.chosen.anchors.overlapDuration >= 4, true);
  assert.equal(plan.chosen.anchors.overlapDuration <= 6, true);
  assert.equal(plan.chosen.window.audibleOverlap >= 4 && plan.chosen.window.audibleOverlap <= 6, true);
  assert.equal(plan.chosen.window.handoffOffset, 0.6);
});

test('uses long overlap only for a trusted entry with compatible tempo', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.8, resolvesTo: { time: 12 } };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.52),
    candidates: [entry],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'weak', risks: [] } },
  });

  assert.equal(plan.chosen.anchors.overlapClass, 'long');
  assert.equal(plan.chosen.anchors.overlapDuration >= 8, true);
  assert.equal(plan.chosen.anchors.overlapDuration <= 12, true);
  assert.equal(plan.chosen.window.audibleOverlap >= 6 && plan.chosen.window.audibleOverlap <= 10, true);
  assert.equal(plan.chosen.window.handoffOffset, 1);
  assert.equal(plan.chosen.timeline.filter((action) => action.deck === 'B' && action.op === 'volume' && !action.curve).every((action) => action.value === 0), true);
});

test('structure route leaves direct planner long-overlap selection available', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.8, resolvesTo: { time: 12 } };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.5),
    candidates: [entry],
  });
  const usable = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'usable', risks: [] } },
    routePolicy: { route: 'structure-mix', overlapClass: 'adaptive' },
  });
  const weak = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'weak', risks: [] } },
    routePolicy: { route: 'structure-mix', overlapClass: 'adaptive' },
  });

  assert.notEqual(usable.chosen.recipe, 'safety-long-blend');
  assert.equal(weak.diagnostics.eligibleRecipes.includes('intro-outro-long-blend'), true);
  assert.equal(weak.chosen.anchors.overlapClass, 'long');
});

test('reports overlap diagnostics from the chosen recipe timeline', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.8, resolvesTo: { time: 12 } };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.52),
    candidates: [entry],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'usable', risks: [] } },
  });

  assert.equal(plan.chosen.recipe, 'bass-eq-handoff');
  assert.equal(plan.diagnostics.overlapClass, 'medium');
  assert.equal(plan.diagnostics.overlapDuration, 7);
});

test('does not let an executable tier bypass the fallback compatibility gate', () => {
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: makeBeatMap(128, 0.5),
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'fallback', time: 16, confidence: 0.52 };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: makeBeatMap(120, 0.75),
    candidates: [entry],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'usable', risks: [] } },
  });

  assert.equal(plan.chosen.recipe, 'safety-long-blend');
  assert.equal(plan.chosen.anchors.overlapClass, 'short');
  assert.equal(plan.chosen.window.audibleOverlap >= 3, true);
});

test('does not trust a low-confidence beat grid for long overlap', () => {
  const fromMap = makeBeatMap(128, 0.5);
  const toMap = makeBeatMap(120, 0.52);
  fromMap.beats.forEach((beat) => { beat.confidence = 0.2; });
  toMap.beats.forEach((beat) => { beat.confidence = 0.2; });
  const fromProfile = buildCueProfile({
    track: { title: 'A', duration: 128 },
    map: fromMap,
    candidates: [{ type: 'outro', role: 'exit', time: 112, confidence: 0.82 }],
  });
  const entry = { type: 'intro', role: 'entry', source: 'energy', time: 0, confidence: 0.8, resolvesTo: { time: 12 } };
  const toProfile = buildCueProfile({
    track: { title: 'B', duration: 120 },
    map: toMap,
    candidates: [entry],
  });
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: { exit: { time: 112 }, entry, evaluation: { tier: 'weak', risks: [] } },
  });

  assert.equal(plan.diagnostics.beatGridTrusted, false);
  assert.notEqual(plan.chosen.anchors.overlapClass, 'long');
});

test('reports planner features for outro completeness, intro aggression, and texture distance', () => {
  const fromProfile = makeProfile('A', 128, [
    { type: 'outro', role: 'exit', time: 112, confidence: 0.86 },
  ], (beat) => {
    if (beat.time >= 112) {
      beat.low = 0.14;
      beat.body = 0.18;
      beat.snap = 0.16;
      beat.impact = 0.22;
    }
    return beat;
  });
  const toProfile = makeProfile('B', 120, [
    { type: 'intro', role: 'entry', time: 0, confidence: 0.82 },
    { type: 'hook', role: 'entry', time: 32, confidence: 0.78 },
  ], (beat) => {
    if (beat.time < 12) {
      beat.low = 0.76;
      beat.body = 0.82;
      beat.snap = 0.72;
      beat.impact = 0.86;
    }
    return beat;
  });

  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry: { time: 32 },
      evaluation: { tier: 'reject', risks: ['style bridge mismatch'] },
    },
  });

  assert.equal(plan.chosen.recipe, 'safety-long-blend');
  assert.equal(plan.diagnostics.outroCompleteness > 0.7, true);
  assert.equal(plan.diagnostics.bIntroAggression > 0.7, true);
  assert.equal(plan.diagnostics.styleTextureDistance > 0.45, true);
  assert.equal(plan.chosen.risks.includes('intro aggression masked'), true);
  assert.equal(plan.chosen.risks.includes('texture distance masked'), true);
});

test('selects filtered pickup for a controlled late energy rise', () => {
  const fromProfile = makeProfile('A', 128, [
    { type: 'outro', role: 'exit', time: 112, confidence: 0.84 },
  ]);
  const entry = {
    type: 'intro',
    role: 'entry',
    source: 'energy',
    time: 8,
    confidence: 0.82,
    resolvesTo: { time: 16 },
  };
  const toProfile = makeProfile('B', 120, [entry]);
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry,
      evaluation: { tier: 'usable', risks: [] },
    },
    routePolicy: {
      route: 'late-contrast-rise',
      compatibilityClass: 'contrast',
      contrastDirection: 'rising',
    },
  });

  assert.equal(plan.chosen.recipe, 'filtered-pickup');
  assert.equal(plan.diagnostics.eligibleRecipes.includes('filtered-pickup'), true);
  assert.equal(plan.chosen.window.runwayAvailable, true);
});

test('selects echo out when a late contrast has unsafe sustained overlap', () => {
  const fromProfile = makeProfile('A', 128, [
    { type: 'outro', role: 'exit', time: 112, confidence: 0.84 },
  ]);
  const entry = {
    type: 'intro',
    role: 'entry',
    source: 'energy',
    time: 8,
    confidence: 0.82,
    resolvesTo: { time: 16 },
  };
  const toProfile = makeProfile('B', 120, [entry]);
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry,
      evaluation: { tier: 'reject', risks: ['style bridge mismatch'] },
    },
    routePolicy: {
      route: 'late-contrast-rise',
      compatibilityClass: 'contrast',
      contrastDirection: 'rising',
    },
  });

  assert.equal(plan.chosen.recipe, 'echo-out');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'echo'), true);
  assert.equal(Array.isArray(plan.chosen.fallbackTimeline), true);
  assert.equal(plan.chosen.fallbackTimeline.some((action) => action.op === 'echo'), false);
  assert.equal(plan.diagnostics.eligibleRecipes.includes('echo-out'), true);
});

test('reports why unsafe long recipes were rejected', () => {
  const fromProfile = makeProfile('A', 128, [
    { type: 'outro', role: 'exit', time: 112, confidence: 0.84 },
  ]);
  const entry = {
    type: 'intro',
    role: 'entry',
    source: 'fallback',
    time: 3,
    confidence: 0.35,
  };
  const toProfile = makeProfile('B', 120, [entry]);
  const plan = planRecipeCandidates(fromProfile, toProfile, {
    sectionChoice: {
      exit: { time: 112 },
      entry,
      evaluation: { tier: 'weak', risks: [] },
    },
    routePolicy: { route: 'terminal-rescue', compatibilityClass: 'uncertain' },
  });

  assert.equal(Array.isArray(plan.diagnostics.rejectedRecipes), true);
  assert.equal(plan.diagnostics.rejectedRecipes.some((item) => (
    item.recipe === 'intro-outro-long-blend' && typeof item.reason === 'string'
  )), true);
  assert.equal(plan.chosen.recipe === 'quick-safe-fade' || plan.chosen.recipe === 'safety-long-blend', true);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCueProfile } = require('../cuefield/cue-profile');
const { planRecipeCandidates } = require('../cuefield/recipe-planner');

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
  assert.equal(plan.chosen.anchors.overlapDuration <= 3.2, true);
  assert.equal(plan.chosen.timeline[0].op, 'play');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'filter' && action.t < -2), false);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'B' && action.op === 'bass' && action.value < 0.2), true);
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

  assert.equal(plan.chosen.anchors.overlapClass, 'short');
  assert.equal(plan.chosen.anchors.overlapDuration <= 3.2, true);
  assert.equal(plan.chosen.anchors.entrySource, 'fallback');
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'filter' && action.t < -2), false);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'B' && action.op === 'volume' && action.curve === 'equal-power-in'), true);
  assert.equal(plan.chosen.timeline.some((action) => action.deck === 'A' && action.op === 'volume' && action.curve === 'equal-power-out'), true);
  assert.equal(Math.abs((play.at + plan.chosen.anchors.lead) - plan.chosen.anchors.bAnchor) <= 0.05, true);
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
  assert.equal(plan.chosen.timeline.filter((action) => action.deck === 'B' && action.op === 'volume' && !action.curve).every((action) => action.value === 0), true);
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
  assert.equal(plan.chosen.anchors.overlapDuration <= 3.2, true);
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

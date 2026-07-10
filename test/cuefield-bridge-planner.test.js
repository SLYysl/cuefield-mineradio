const assert = require('node:assert/strict');
const test = require('node:test');

const { planBridge } = require('../cuefield/bridge-planner');

function analysis({ duration = 120, bpm = 120, protectedUntil = 32, climax = null, exits = [48, 64, 80] } = {}) {
  return {
    structureMap: {
      duration,
      protectedUntil,
      sections: climax ? [climax] : [],
      entryCandidates: climax ? [{ ...climax, role: 'entry', time: climax.start }] : [],
      exitCandidates: exits.map((time) => ({ role: 'exit', type: 'phrase-boundary', time, confidence: 0.8 })),
    },
    cueProfile: {
      duration,
      bpm,
      gridStep: 60 / bpm,
      downbeats: Array.from({ length: 20 }, (_, index) => ({ time: index * 2, confidence: 0.9 })),
    },
  };
}

function direct(overrides = {}) {
  return {
    score: 0.62,
    evaluation: { score: 0.62, tier: 'usable', risks: [] },
    policy: { route: 'late-contrast-rise', compatibilityClass: 'contrast', contrastDirection: 'rising' },
    exit: { time: 48 },
    timeline: [{ t: 0, deck: 'B', op: 'handoff' }],
    ...overrides,
  };
}

test('requires a trusted Hook or Drop with confidence at least 0.72', () => {
  const from = analysis();
  const missing = planBridge({ fromAnalysis: from, toAnalysis: analysis(), directPlan: direct() });
  const weak = planBridge({
    fromAnalysis: from,
    toAnalysis: analysis({ climax: { type: 'hook', start: 64, end: 80, confidence: 0.71 } }),
    directPlan: direct(),
  });

  assert.equal(missing, null);
  assert.equal(weak, null);
});

test('never starts before A first-Hook protection and requires usable beat grids', () => {
  const climax = { type: 'hook', start: 64, end: 80, confidence: 0.86 };
  const protectedPlan = planBridge({
    fromAnalysis: analysis({ protectedUntil: 60, exits: [48, 64, 80] }),
    toAnalysis: analysis({ climax }),
    directPlan: direct({ exit: { time: 48 } }),
  });
  const missingGrid = planBridge({
    fromAnalysis: analysis({ bpm: 0 }),
    toAnalysis: analysis({ climax }),
    directPlan: direct(),
  });

  assert.equal(protectedPlan.mixStart >= 60, true);
  assert.equal(missingGrid, null);
});

test('constructs four, eight, or sixteen bars from available runway', () => {
  const climax = { type: 'hook', start: 72, end: 88, confidence: 0.9 };
  const four = planBridge({
    fromAnalysis: analysis({ duration: 58, protectedUntil: 48, exits: [50] }),
    toAnalysis: analysis({ duration: 70, climax: { ...climax, start: 10 } }),
    directPlan: direct({ exit: { time: 50 }, policy: { route: 'terminal-rescue', compatibilityClass: 'contrast' } }),
  });
  const eight = planBridge({
    fromAnalysis: analysis({ duration: 100 }),
    toAnalysis: analysis({ climax }),
    directPlan: direct({ policy: { route: 'structure-mix', compatibilityClass: 'compatible' }, score: 0.5, evaluation: { score: 0.5, tier: 'usable' } }),
  });
  const sixteen = planBridge({
    fromAnalysis: analysis({ duration: 160 }),
    toAnalysis: analysis({ duration: 140, climax: { ...climax, start: 96 } }),
    directPlan: direct(),
  });

  assert.equal(four.bars, 4);
  assert.equal(eight.bars, 8);
  assert.equal(sixteen.bars, 16);
});

test('routes terminal, rising, lyric-linked, and abrupt contrast pairs to distinct templates', () => {
  const climax = { type: 'hook', start: 72, end: 88, confidence: 0.9 };
  const from = analysis();
  const to = analysis({ climax });
  const terminal = planBridge({ fromAnalysis: from, toAnalysis: to, directPlan: direct({ policy: { route: 'terminal-rescue', compatibilityClass: 'contrast' } }) });
  const rising = planBridge({ fromAnalysis: from, toAnalysis: to, directPlan: direct() });
  const lyric = planBridge({
    fromAnalysis: from,
    toAnalysis: to,
    directPlan: direct({ policy: { route: 'structure-mix', compatibilityClass: 'compatible' }, score: 0.5, evaluation: { score: 0.5, tier: 'usable' } }),
    lyricLink: { score: 0.8, reasons: ['call-response'] },
  });
  const impact = planBridge({
    fromAnalysis: from,
    toAnalysis: to,
    directPlan: direct({ policy: { route: 'late-contrast-fall', compatibilityClass: 'contrast', contrastDirection: 'falling' } }),
  });

  assert.equal(terminal.template, 'echo-break');
  assert.equal(rising.template, 'drum-build');
  assert.equal(lyric.template, 'loop-rise');
  assert.equal(impact.template, 'impact-drop');
});

test('uses improvement gating for compatible pairs but allows contrast and strong lyric links', () => {
  const climax = { type: 'drop', start: 64, end: 80, confidence: 0.84 };
  const from = analysis();
  const to = analysis({ climax });
  const goodDirect = direct({
    score: 0.86,
    evaluation: { score: 0.86, tier: 'magic' },
    policy: { route: 'structure-mix', compatibilityClass: 'compatible' },
  });
  const compatible = planBridge({ fromAnalysis: from, toAnalysis: to, directPlan: goodDirect });
  const contrast = planBridge({ fromAnalysis: from, toAnalysis: to, directPlan: direct() });
  const lyric = planBridge({ fromAnalysis: from, toAnalysis: to, directPlan: goodDirect, lyricLink: { score: 0.72, reasons: ['call-response'] } });

  assert.equal(compatible, null);
  assert.notEqual(contrast, null);
  assert.notEqual(lyric, null);
});

test('starts B so the handoff lands exactly on the trusted climax', () => {
  const climax = { type: 'hook', start: 72, end: 88, confidence: 0.9 };
  const plan = planBridge({ fromAnalysis: analysis(), toAnalysis: analysis({ climax }), directPlan: direct() });
  const play = plan.timeline.find((action) => action.deck === 'B' && action.op === 'play');
  const handoff = plan.timeline.find((action) => action.op === 'handoff');
  const stage3 = plan.stageDurations[2];

  assert.equal(Math.abs((play.at + stage3) - climax.start) < 0.001, true);
  assert.equal(Math.abs(handoff.t - plan.totalDuration) < 0.001, true);
  assert.equal(Math.abs((plan.mixStart + plan.totalDuration) - plan.handoffAt) < 0.001, true);
  assert.equal(plan.timeline.some((action) => action.op === 'bridge'), true);
  assert.equal(Array.isArray(plan.fallbackTimeline), true);
});

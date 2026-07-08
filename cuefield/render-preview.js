const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function clampStart(value) {
  return Math.max(0, round(value, 3));
}

function gridStepFor(fromFixture, toFixture) {
  return Math.max(
    toNumber(fromFixture && fromFixture.map && fromFixture.map.gridStep, 0),
    toNumber(toFixture && toFixture.map && toFixture.map.gridStep, 0),
    0.5,
  );
}

function parseEvalRow(line) {
  const parts = String(line || '').replace(/\r$/, '').split('\t');
  if (parts.length < 7 || parts[0] === 'score') throw new Error('INVALID_EVAL_ROW');
  return {
    score: toNumber(parts[0]),
    grade: parts[1] || '',
    from: parts[2] || '',
    to: parts[3] || '',
    exitPoint: toNumber(parts[4]),
    entryPoint: toNumber(parts[5]),
    transitionBars: toNumber(parts[6]),
    risks: (parts[7] || '').split('|').filter(Boolean),
    vetoes: (parts[8] || '').split('|').filter(Boolean),
  };
}

function safeOutputName(row, mode) {
  const raw = `${row.from || 'from'}--to--${row.to || 'to'}--${mode || 'preview'}`;
  return raw
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() + '.mp3';
}

function audioFileForTitle(audioDir, title) {
  const candidates = fs.readdirSync(audioDir)
    .filter((name) => name.toLowerCase().endsWith('.mp3'));
  const exact = candidates.find((name) => path.basename(name, path.extname(name)) === title);
  if (exact) return path.join(audioDir, exact);
  const normalized = String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const fuzzy = candidates.find((name) => path.basename(name, path.extname(name)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === normalized);
  if (fuzzy) return path.join(audioDir, fuzzy);
  throw new Error(`AUDIO_NOT_FOUND:${title}`);
}

function fixtureForTitle(fixtures, title) {
  const fixture = fixtures.find((item) => item && item.track && item.track.title === title);
  if (!fixture) throw new Error(`FIXTURE_NOT_FOUND:${title}`);
  return fixture;
}

function makeSegment(label, duration, from, to) {
  return { label, duration: round(duration, 3), from: from || null, to: to || null };
}

function isSectionMode(mode) {
  return [
    'section-hook',
    'section-jump',
    'section-filter-push',
    'section-stutter-pickup',
    'section-hard-stutter',
  ].includes(mode);
}

function presentNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sectionChoiceEntryPoint(choice) {
  const entry = choice && choice.entry;
  return entry ? presentNumber(entry.time) : null;
}

function sectionChoiceResolvedEntryPoint(choice) {
  const entry = choice && choice.entry;
  return entry && entry.resolvesTo ? presentNumber(entry.resolvesTo.time) : null;
}

function beatEnergy(beat) {
  if (!beat) return 0;
  return Math.max(
    toNumber(beat.low),
    toNumber(beat.body),
    toNumber(beat.snap),
    toNumber(beat.impact),
    toNumber(beat.strength),
  );
}

function averageEnergy(beats, start, duration) {
  const window = beats.filter((beat) => beat.time >= start && beat.time < start + duration);
  if (!window.length) return 0;
  return window.reduce((sum, beat) => sum + beatEnergy(beat), 0) / window.length;
}

function findReleaseAfterUpcomingPeak(map, plannedExit) {
  const beats = (map && map.beats || []).slice().sort((a, b) => a.time - b.time);
  if (!beats.length) return null;
  const step = toNumber(map && map.gridStep, 0.5) || 0.5;
  const phraseSec = step * 16;
  const current = averageEnergy(beats, plannedExit - phraseSec / 2, phraseSec);
  const future = beats
    .filter((beat) => beat.time > plannedExit + step && beat.time <= plannedExit + phraseSec * 2)
    .map((beat) => ({ beat, energy: averageEnergy(beats, beat.time, phraseSec / 2) }));
  if (!future.length) return null;
  future.sort((a, b) => b.energy - a.energy);
  const peak = future[0];
  if (peak.energy < Math.max(current * 1.18, current + 0.08)) return null;

  const release = beats.find((beat) => {
    if (beat.time < peak.beat.time + phraseSec) return false;
    const combo = String(beat.combo || '');
    if (combo && combo !== 'downbeat') return false;
    return averageEnergy(beats, beat.time, phraseSec / 2) <= peak.energy * 0.7;
  });
  return release ? release.time + step : peak.beat.time + phraseSec + step;
}

function buildBassSwapPlan(ctx) {
  const step = gridStepFor(ctx.fromFixture, ctx.toFixture);
  const barSec = step * 4;
  const preBars = 4;
  const teaseBars = 1;
  const postBars = 6;
  const preSec = preBars * barSec;
  const teaseSec = teaseBars * barSec;
  const cutSec = step;
  const postSec = postBars * barSec;
  const exitPoint = toNumber(ctx.row.exitPoint);
  const entryPoint = toNumber(ctx.row.entryPoint);

  return [
    makeSegment('A full phrase before mix', preSec, {
      start: clampStart(exitPoint - preSec - teaseSec),
      filter: 'full',
      volume: 1,
    }),
    makeSegment('B high-pass tease over A groove', teaseSec, {
      start: clampStart(exitPoint - teaseSec),
      filter: 'full',
      volume: 0.96,
    }, {
      start: clampStart(entryPoint),
      filter: 'highpass',
      highpassHz: 360,
      volume: 0.28,
      fadeIn: Math.min(0.7, teaseSec * 0.25),
    }),
    makeSegment('Downbeat cut tail', cutSec, {
      start: clampStart(exitPoint),
      filter: 'full',
      volume: 0.42,
      fadeOut: Math.min(step * 0.8, cutSec),
    }, {
      start: clampStart(entryPoint + teaseSec),
      filter: 'full',
      volume: 1,
    }),
    makeSegment('B takes over', postSec, null, {
      start: clampStart(entryPoint + teaseSec + cutSec),
      filter: 'full',
      volume: 1,
    }),
  ];
}

function buildEchoOutPlan(ctx) {
  const step = gridStepFor(ctx.fromFixture, ctx.toFixture);
  const barSec = step * 4;
  const preSec = 4 * barSec;
  const echoSec = 2 * barSec;
  const bridgeSec = 2 * barSec;
  const postSec = 4 * barSec;
  const exitPoint = toNumber(ctx.row.exitPoint);
  const entryPoint = toNumber(ctx.row.entryPoint);

  return [
    makeSegment('A final phrase before echo', preSec, {
      start: clampStart(exitPoint - preSec),
      filter: 'full',
      volume: 1,
    }),
    makeSegment('A echo tail with B pickup loop', echoSec, {
      start: clampStart(exitPoint),
      filter: 'highpass',
      volume: 0.62,
      effect: 'echo-out',
      fadeOut: Math.min(1.4, echoSec * 0.45),
    }, {
      start: clampStart(entryPoint),
      filter: 'highpass',
      volume: 0.52,
      role: 'pickup-loop',
      fadeIn: Math.min(1, echoSec * 0.35),
    }),
    makeSegment('B low end opens under echo tail', bridgeSec, {
      start: clampStart(exitPoint + echoSec),
      filter: 'echo-tail',
      volume: 0.24,
      effect: 'echo-out',
      fadeOut: bridgeSec,
    }, {
      start: clampStart(entryPoint + echoSec),
      filter: 'full',
      volume: 1,
    }),
    makeSegment('B takes over', postSec, null, {
      start: clampStart(entryPoint + echoSec + bridgeSec),
      filter: 'full',
      volume: 1,
    }),
  ];
}

function buildSectionJumpPlan(ctx) {
  const step = gridStepFor(ctx.fromFixture, ctx.toFixture);
  const barSec = step * 4;
  const preSec = 4 * barSec;
  const stutterMode = ctx.mode === 'section-stutter-pickup';
  const hardStutterMode = ctx.mode === 'section-hard-stutter';
  const filterPushMode = ctx.mode === 'section-filter-push';
  const hardStutterTapSec = Math.max(0.125, step / 2);
  const hardStutterSec = hardStutterTapSec * 4;
  const choiceExit = ctx.sectionChoice && ctx.sectionChoice.exit;
  const choiceEntryTime = sectionChoiceEntryPoint(ctx.sectionChoice);
  const choiceResolvedEntryTime = sectionChoiceResolvedEntryPoint(ctx.sectionChoice);
  const defaultLeadSec = 2 * barSec;
  const choiceLeadSec = choiceEntryTime != null
    && choiceResolvedEntryTime != null
    && choiceResolvedEntryTime > choiceEntryTime
    ? choiceResolvedEntryTime - choiceEntryTime
    : null;
  const choiceEntryStart = choiceResolvedEntryTime != null && choiceLeadSec != null && choiceLeadSec < defaultLeadSec
    ? choiceResolvedEntryTime - defaultLeadSec
    : choiceEntryTime;
  const loopSec = choiceResolvedEntryTime != null ? Math.max(defaultLeadSec, choiceLeadSec || 0) : defaultLeadSec;
  const bridgeSec = stutterMode
    ? Math.max(step, loopSec - (step * 2))
    : (hardStutterMode ? Math.max(step, loopSec - hardStutterSec) : Math.max(step, loopSec - 1));
  const cleanPickupSec = Math.max(0, loopSec - bridgeSec);
  const cutSec = step;
  const postSec = 6 * barSec;
  const exitPoint = toNumber(ctx.row.exitPoint);
  const fromPhrase = ctx.sectionAnchors && ctx.sectionAnchors.fromExitPhrase;
  const toEntry = ctx.sectionAnchors && (ctx.sectionAnchors.toSectionEntry || ctx.sectionAnchors.toHook);
  const protectedExit = (choiceExit && choiceExit.time != null) || (fromPhrase && fromPhrase.time != null)
    ? null
    : findReleaseAfterUpcomingPeak(ctx.fromFixture && ctx.fromFixture.map, exitPoint);
  const phraseStart = clampStart(
    choiceExit && choiceExit.time != null
      ? choiceExit.time
      : (fromPhrase && fromPhrase.time != null ? fromPhrase.time : (protectedExit || exitPoint - loopSec)),
  );
  const entryStart = clampStart(choiceEntryStart != null
    ? choiceEntryStart
    : (toEntry && toEntry.time != null ? toEntry.time : ctx.row.entryPoint));

  const segments = [
    makeSegment('A phrase before section jump', preSec, {
      start: clampStart(phraseStart - preSec),
      filter: 'full',
      volume: 1,
    }),
    makeSegment('A outgoing phrase bridge under B section pickup', bridgeSec, {
      start: phraseStart,
      filter: 'full',
      volume: filterPushMode ? 0.46 : 0.58,
      role: 'outgoing-phrase-bridge',
      fadeOut: Math.min(1.2, bridgeSec * 0.45),
    }, {
      start: entryStart,
      filter: 'highpass',
      highpassHz: filterPushMode ? 360 : 220,
      volume: filterPushMode ? 0.58 : 0.5,
      role: 'section-pickup',
      fadeIn: Math.min(0.8, bridgeSec * 0.25),
    }),
  ];

  if (stutterMode) {
    segments.push(
      makeSegment('B stutter pickup', step, null, {
        start: entryStart + bridgeSec,
        filter: 'highpass',
        highpassHz: 220,
        volume: 0.72,
        role: 'section-stutter',
      }),
      makeSegment('B stutter pickup', step, null, {
        start: entryStart + bridgeSec,
        filter: 'highpass',
        highpassHz: 180,
        volume: 0.84,
        role: 'section-stutter',
      }),
    );
  } else if (hardStutterMode) {
    const tapStart = entryStart + bridgeSec;
    [
      { highpassHz: 420, volume: 0.48 },
      { highpassHz: 320, volume: 0.62 },
      { highpassHz: 240, volume: 0.78 },
      { highpassHz: 160, volume: 0.92 },
    ].forEach((tap) => {
      segments.push(makeSegment('B hard stutter cue tap', hardStutterTapSec, null, {
        start: tapStart,
        filter: 'highpass',
        highpassHz: tap.highpassHz,
        volume: tap.volume,
        role: 'section-hard-stutter',
      }));
    });
  } else if (cleanPickupSec > 0) {
    segments.push(makeSegment('B clean section pickup', cleanPickupSec, null, {
      start: entryStart + bridgeSec,
      filter: 'highpass',
      highpassHz: filterPushMode ? 260 : 180,
      volume: filterPushMode ? 0.84 : 0.76,
      role: 'section-pickup',
    }));
  }

  segments.push(
    makeSegment('B section downbeat cut', cutSec, null, {
      start: entryStart + loopSec,
      filter: 'full',
      volume: 1,
      role: 'section-entry',
    }),
    makeSegment('B section takes over', postSec, null, {
      start: entryStart + loopSec + cutSec,
      filter: 'full',
      volume: 1,
      role: 'section-entry',
    }),
  );

  return segments;
}

function buildRecipe(mode, segments) {
  let style = 'Bass Swap / Downbeat Cut';
  if (mode === 'echo-out') style = 'Echo Out';
  else if (mode === 'section-filter-push') style = 'Section Filter Push';
  else if (mode === 'section-stutter-pickup') style = 'Section Stutter Pickup';
  else if (mode === 'section-hard-stutter') style = 'Section Hard Stutter';
  else if (isSectionMode(mode)) style = 'Section Jump';
  return {
    style,
    layer: 'transition-engine-preview',
    actions: segments.map((segment) => ({
      label: segment.label,
      duration: segment.duration,
      from: segment.from && {
        filter: segment.from.filter,
        volume: segment.from.volume,
        effect: segment.from.effect || null,
        role: segment.from.role || null,
      },
      to: segment.to && {
        filter: segment.to.filter,
        volume: segment.to.volume,
        effect: segment.to.effect || null,
        role: segment.to.role || null,
      },
    })),
  };
}

function sectionChoiceStyle(choice) {
  if (!choice || !choice.recipe) return null;
  if (choice.recipe === 'outro-to-chorus') return 'Outro to Chorus';
  if (choice.recipe === 'section-jump') return 'Section Jump';
  return String(choice.recipe).split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function buildPreviewPlan(opts) {
  const mode = opts.mode || 'bass-swap';
  const ctx = {
    mode,
    row: opts.row || {},
    fromFixture: opts.fromFixture || {},
    toFixture: opts.toFixture || {},
    sectionAnchors: opts.sectionAnchors || {},
    sectionChoice: opts.sectionChoice || null,
  };
  let segments;
  if (mode === 'echo-out') segments = buildEchoOutPlan(ctx);
  else if (isSectionMode(mode)) segments = buildSectionJumpPlan(ctx);
  else segments = buildBassSwapPlan(ctx);
  const recipe = buildRecipe(mode, segments);
  return {
    mode,
    fromAudio: opts.fromAudio,
    toAudio: opts.toAudio,
    output: opts.output,
    row: opts.row || {},
    sectionChoice: opts.sectionChoice || null,
    gridStep: gridStepFor(opts.fromFixture, opts.toFixture),
    recipe: {
      ...recipe,
      style: sectionChoiceStyle(opts.sectionChoice) || recipe.style,
    },
    segments,
  };
}

function fixtureDuration(fixture) {
  return Math.max(
    toNumber(fixture && fixture.track && fixture.track.duration, 0),
    toNumber(fixture && fixture.map && fixture.map.duration, 0),
  );
}

function buildFullSimulationPlan(opts) {
  const plan = buildPreviewPlan(opts);
  const segments = plan.segments.slice();
  const first = segments[0];
  if (first && first.from && first.from.start > 0) {
    segments.unshift(makeSegment('A plays from start before transition', first.from.start, {
      start: 0,
      filter: 'full',
      volume: 1,
    }, null));
  }

  const toDuration = fixtureDuration(opts.toFixture || {});
  const last = segments[segments.length - 1];
  if (last && last.to && toDuration > last.to.start) {
    segments[segments.length - 1] = makeSegment(
      `${last.label} and plays to end`,
      toDuration - last.to.start,
      last.from,
      last.to,
    );
  }

  return {
    ...plan,
    fullSimulation: true,
    recipe: {
      ...plan.recipe,
      style: `${plan.recipe.style} Full Simulation`,
      actions: buildRecipe(plan.mode, segments).actions,
    },
    segments,
  };
}

function sourceFilter(source, label, duration) {
  if (!source) return '';
  const input = source.input === 'to' ? '1:a' : '0:a';
  const parts = [
    `[${input}]atrim=start=${source.start}:duration=${duration}`,
    'asetpts=PTS-STARTPTS',
  ];
  if (source.filter === 'highpass') parts.push(`highpass=f=${source.highpassHz || 180}`);
  if (source.filter === 'echo-tail') parts.push('highpass=f=260');
  if (source.effect === 'echo-out') parts.push('aecho=0.65:0.45:360:0.38');
  if (source.fadeIn) parts.push(`afade=t=in:st=0:d=${round(source.fadeIn, 3)}`);
  if (source.fadeOut) parts.push(`afade=t=out:st=${round(Math.max(0, duration - source.fadeOut), 3)}:d=${round(source.fadeOut, 3)}`);
  parts.push(`volume=${source.volume == null ? 1 : source.volume}`);
  return `${parts.join(',')}[${label}]`;
}

function buildFilterGraph(plan) {
  const filters = [];
  const concatLabels = [];
  plan.segments.forEach((segment, index) => {
    const outs = [];
    if (segment.from) {
      filters.push(sourceFilter({ ...segment.from, input: 'from' }, `s${index}a`, segment.duration));
      outs.push(`[s${index}a]`);
    }
    if (segment.to) {
      filters.push(sourceFilter({ ...segment.to, input: 'to' }, `s${index}b`, segment.duration));
      outs.push(`[s${index}b]`);
    }
    if (outs.length === 2) {
      filters.push(`${outs.join('')}amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[s${index}]`);
      concatLabels.push(`[s${index}]`);
    } else {
      const only = outs[0].slice(1, -1);
      filters.push(`[${only}]alimiter=limit=0.95[s${index}]`);
      concatLabels.push(`[s${index}]`);
    }
  });
  filters.push(`${concatLabels.join('')}concat=n=${plan.segments.length}:v=0:a=1,alimiter=limit=0.95[out]`);
  return filters.join(';');
}

function buildFfmpegArgs(plan) {
  if (!plan.fromAudio || !plan.toAudio || !plan.output) throw new Error('PREVIEW_PATHS_REQUIRED');
  return [
    '-y',
    '-i', plan.fromAudio,
    '-i', plan.toAudio,
    '-filter_complex', buildFilterGraph(plan),
    '-map', '[out]',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '192k',
    plan.output,
  ];
}

function renderPreview(plan, opts = {}) {
  const ffmpeg = opts.ffmpeg || 'ffmpeg';
  fs.mkdirSync(path.dirname(plan.output), { recursive: true });
  const args = buildFfmpegArgs(plan);
  const result = spawnSync(ffmpeg, args, { stdio: opts.stdio || 'inherit' });
  if (result.status !== 0) throw new Error(`FFMPEG_FAILED:${result.status}`);
  return plan.output;
}

module.exports = {
  audioFileForTitle,
  buildFfmpegArgs,
  buildFullSimulationPlan,
  buildPreviewPlan,
  fixtureForTitle,
  parseEvalRow,
  renderPreview,
  safeOutputName,
};

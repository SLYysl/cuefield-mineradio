# Cuefield Transition Recipe Planner Design
> Date: 2026-07-09

## Goal

Upgrade Cuefield AutoMix from "pick A exit + B entry and crossfade" to "choose how to transition." The next iteration should generate multiple transition recipes for a track pair, score their expected listening quality, and execute a timeline of deck actions.

The target is not to force every pair to cut. The target is that common playlist pairs get a defensible transition plan, and rejected pairs explain why no real-time recipe is safe.

## Current Problem

The current Mineradio integration prepares beatmaps and a pair plan, then maps tier to a fixed frontend mode:

- `usable` -> `filtered-pickup`
- `weak` -> `intro-bed`
- `reject` -> fallback

This improved loading gaps but still feels abrupt because the planner does not know enough about:

- downbeat/bar alignment
- intro/outro cue points
- phrase boundaries
- bass handoff
- vocal collision
- whether B should enter as bed, pickup, bass swap, or quick fade

The frontend is compensating with fixed volume curves, which is the wrong layer for musical decisions.

## Research Inputs

From Codex and Hermes blackboard research:

- **Mixxx Auto DJ**: useful state-machine and transition mode model. It is not musically smart enough, but its separation between deck state and transition mode is worth copying.
- **songs-automixer_python**: closest practical reference for Stretch/Skip/Backspin, Rubber Band time-stretch, bar snapping, and transition-type branching.
- **byronxu99/AutoDJ**: useful ideas for harmonic mixing, entrance/exit cue alignment, bass EQ fade, half/double-time matching, and tempo ramp.
- **Zehren Automix**: best near-term cue point reference. Rule-based cue detection plus novelty analysis is more practical for MVP than GPU models.
- **madmom**: reference standard for beat/downbeat tracking and bar-level alignment.
- **Rubber Band**: later path for high-quality time-stretch. Do not use WebAudio playbackRate as the long-term beatmatch solution.
- **CUE-DETR, Demucs, DJtransGAN**: useful v2/offline references, not real-time MVP dependencies.

## Architecture

### 1. Music Understanding Layer

Add a cached `cueProfile` next to beatmap cache. It should be precomputed during AutoMix preparation, not at the transition moment.

Shape:

```js
{
  key,
  duration,
  bpm,
  camelot,
  beats: [{ time, confidence }],
  downbeats: [{ time, barIndex, confidence }],
  bars: [{ index, start, end, energy, low, vocal }],
  phrases: [{ start, end, kind, confidence }],
  cuePoints: {
    introStart,
    introEnd,
    outroStart,
    outroEnd,
    firstStrongDownbeat,
    lastSafePhraseEnd
  },
  windows: {
    vocal: [{ start, end, density }],
    bass: [{ start, end, density }],
    energy: [{ start, end, value }]
  }
}
```

MVP can derive this from current Mineradio beatmaps plus heuristics. Later versions can replace the internals with madmom/Zehren Automix without changing the planner API.

### 2. Recipe Planner Layer

Replace single `chosen` output with recipe candidates:

```js
{
  ok: true,
  chosen,
  candidates: [
    {
      recipe: "intro-outro-long-blend",
      score: 0.82,
      confidence: 0.76,
      reason: ["phrase aligned", "low bass conflict"],
      risks: [],
      anchors: {
        aExit,
        aOutroStart,
        bStart,
        bAnchor,
        downbeatOffset
      },
      timeline: [...]
    }
  ]
}
```

The planner should evaluate several recipes, not just one:

- `intro-outro-long-blend`: A outro and B intro overlap for 8-16 bars.
- `filtered-pickup`: B starts before anchor with high-pass/low gain, releases at downbeat.
- `bass-eq-handoff`: A low band ducks before B low band rises.
- `quick-safe-fade`: short fallback for incompatible key/BPM but clean phrase endings.

Do not include `loop-tail`, `drop-mix`, `hard-stutter`, or stem-aware transitions in this MVP. They need better beat/stem confidence and are more likely to sound fake.

### 3. Timeline Execution Layer

The frontend should execute the planner timeline rather than infer the recipe from tier.

Initial action set:

```js
{ t, deck: "A" | "B", op: "play", at, volume }
{ t, deck: "A" | "B", op: "volume", value, duration }
{ t, deck: "A" | "B", op: "filter", type: "highpass" | "lowpass" | "none", value, duration }
{ t, deck: "A" | "B", op: "bass", value, duration }
{ t, deck: "A" | "B", op: "handoff" }
{ t, deck: "A" | "B", op: "stop" }
```

MVP execution can map `bass` to a WebAudio low-shelf filter and `filter` to a biquad high-pass. If the graph is not ready, the executor should fall back to volume-only but log the downgrade.

## Scoring Rules

Candidate score should combine:

- downbeat alignment
- bar/phrase alignment
- key compatibility
- BPM tolerance or half/double-time compatibility
- energy continuity
- bass overlap risk
- vocal collision risk
- transition length suitability

Hard rejections:

- strong vocal collision in the intended overlap
- strong bass clash that cannot be ducked by recipe
- no reliable A exit or B start cue

Weak pairs should not be forced through hook jumps. If no candidate clears the real-time safety floor, normal playback is better than a bad AutoMix.

## Implementation Phases

### Phase 1: Planner API

- Add `cuefield/cue-profile.js` to normalize current beatmap into `cueProfile`.
- Add `cuefield/recipe-planner.js` to return `candidates[]` and `chosen.timeline`.
- Keep old `/api/cuefield/transition` shape compatible by including `chosen`, but add `candidates` and timeline fields.
- Add tests with synthetic profiles for the four MVP recipes.

### Phase 2: Frontend Executor

- Add a small timeline executor in `public/index.html` or a separate browser script.
- Keep existing prepared B deck, but replace fixed `intro-bed` / `filtered-pickup` code with timeline actions.
- Add WebAudio filter/bass nodes only for the hidden B deck first; then add A low-shelf support.

### Phase 3: Better Cue Detection

- Improve `cueProfile` generation with phrase/downbeat heuristics from existing beatmaps.
- Experiment with madmom/Zehren Automix offline as optional cache builders.
- Store profile version in cache so old beatmaps can be upgraded.

### Phase 4: Human Feedback Loop

- Log selected recipe, score, risks, and user feedback.
- Add a small eval script to replay 20-50 transitions and compare user labels against candidate scores.
- Tune recipe scoring only after the planner emits structured candidates.

## Non-Goals

- No GPU model in real-time playback.
- No real-time Demucs/Spleeter.
- No full Rubber Band integration in the first planner pass.
- No new player UI beyond current AutoMix toggle/status.
- No broad rewrite of `public/index.html`.

## Success Criteria

- Planner returns at least two recipe candidates for ordinary pairs with usable cue data.
- Weak pairs default to `intro-outro-long-blend` or `quick-safe-fade`, not hook jumps.
- Rejected pairs include a concrete reason.
- Frontend executes timeline actions without loading gaps or backward seeks.
- Tests cover recipe selection and timeline shape before manual listening.

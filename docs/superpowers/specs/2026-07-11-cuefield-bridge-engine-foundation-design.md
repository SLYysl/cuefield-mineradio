# Cuefield Bridge Engine Foundation Design

> Date: 2026-07-11
> Status: approved for implementation

## Goal

Cuefield may render a difficult transition as a three-stage musical bridge:

1. transform and release A;
2. continue with synthesized material that belongs to neither song;
3. introduce transformed B and land exactly on a trusted Hook or Drop.

The bridge is available to both sequential and smart selection. It is chosen intelligently when it materially improves continuity; it is not applied to every pair.

## Planning Eligibility

The server plans bridges while both full structure maps are available. A bridge is eligible only when:

- A's first-Hook protection has already been satisfied;
- B has a trusted climax candidate, preferring Hook then Drop, with confidence at least `0.72`;
- both tracks have usable BPM/beat-grid evidence;
- at least four bars of total bridge runway can be constructed;
- the bridge's predicted score improves the direct transition by at least `0.12`, or the pair is a large contrast/terminal route, or lyric linkage is strong.

If B has no trusted climax, Cuefield must keep the direct transition. The climax requirement is never relaxed to make a bridge executable.

## Three Stages

Bridge length is 4, 8, or 16 bars, capped at 16. Template choice and length depend on contrast, runway, energy direction, and vocal risk.

### Stage 1: Release A

Start on a phrase/beat boundary after `protectedUntil`. Use the selected template's bounded combination of bass removal, filter, echo, volume release, or rhythmic accent. A remains recognizable long enough to make the transformation intentional.

### Stage 2: Synthetic Connector

A is dry-silent and B is not yet foregrounded. The bridge engine generates professional-template structure with realtime procedural material:

- kick, clap, hats, percussion;
- snare/tom build and fills;
- noise riser and downlifter;
- impact;
- bounded tonal or bass pulse.

The material is generated in the existing AudioContext. No copyrighted sample pack or binary asset is introduced in the foundation.

### Stage 3: Prepare B

B starts at `climaxTime - stage3Duration`, initially filtered and bass-protected. The filter, bass, and gain open toward the climax. The handoff occurs when playback reaches the trusted climax anchor, so the audience receives the intended Hook/Drop rather than a random intro position.

Tempo advances per bar from A BPM toward B BPM. The foundation does not time-stretch A or B; only synthesized events follow the interpolated bridge grid.

## Templates

The initial template library contains:

- `drum-build`: stable kick/hat bed, rising snare density, impact into B;
- `echo-break`: A echo release, sparse synthetic middle, downlifter/impact;
- `loop-rise`: rhythmic pulse derived from A's tempo/energy, filter rise into B;
- `impact-drop`: short contrast reset with silence control and a strong B landing.

Templates describe stages and event density, while runtime chooses safe procedural timbres. They are data, not separate playback engines.

## Lyric And Dialogue Link

The foundation computes a local, explainable linkage score rather than claiming semantic understanding. It compares A's last complete lyric before exit with B's first one or two lines around the trusted climax using:

- normalized Chinese-character/word overlap;
- call-response pronouns such as `我/你` and `I/you`;
- final-character or suffix/rhyme similarity;
- clean vocal timing that avoids uncontrolled simultaneous lead vocals.

Only the score and compact reason codes leave the server. Raw lyric text is not returned by the transition API or written to feedback diagnostics.

## Timeline And API Contract

`cuefield/bridge-planner.js` returns either `null` or:

```js
{
  template: 'drum-build',
  bars: 8,
  bpmFrom: 118,
  bpmTo: 126,
  climax: { time: 63.2, type: 'hook', confidence: 0.84 },
  stageDurations: [4.1, 8.0, 3.8],
  predictedScore: 0.81,
  reasons: ['contrast-route', 'trusted-hook'],
  timeline: []
}
```

The chosen transition embeds the bridge timeline only when bridge selection wins. A normalized `op: 'bridge'` action carries the compact bridge recipe. Existing `play`, filter, bass, echo, volume, and handoff actions manage A/B. AutoMix stores the bridge plan in its pending transition.

## Browser Runtime

Add `public/cuefield-bridge-engine.js` as a UMD module. It schedules oscillators, noise buffers, gains, and filters from one existing AudioContext, tracks all nodes/timers, and exposes `start(plan, context)` and `stop(reason)`.

All levels, feedback, frequencies, and event counts are bounded. Cancellation, reset, failed handoff, and track replacement stop/disconnect bridge nodes. If synthesis cannot start, the ordinary gain/EQ fallback timeline continues and playback must not stall or remain muted.

## Testing

Pure server tests cover trusted-climax gating, Hook protection, 4/8/16-bar choice, template routing, lyric-link scoring, exact B climax landing, and direct-plan fallback. Browser tests cover timeline normalization, bounded event generation, tempo interpolation, node lifecycle, cancellation, and synthesis failure fallback. Bridge API tests ensure no raw lyrics are returned.

## Non-Goals

- Stem separation.
- Offline rendering or exporting a new audio file.
- Time-stretching or pitch-shifting the source tracks.
- Claiming full semantic lyric understanding.
- Shipping third-party sample libraries.
- Publishing or deployment.
- Modifying the unrelated local `desktop/main.js` Metal setting.

## Success Criteria

- Both Cuefield selection modes can execute the same bridge contract.
- Bridges only occur when eligibility and improvement rules pass.
- A's protected first Hook remains audible.
- Every bridge lands B on a trusted climax with exact timing.
- Synthetic material can keep groove/energy moving while neither source track owns the middle stage.
- Runtime failure degrades to the existing direct transition without interrupting playback.

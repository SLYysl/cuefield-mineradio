# Cuefield AutoMix MVP

Cuefield AutoMix is an experimental transition layer built on top of Mineradio. This branch keeps the current player and visual system, then adds a local transition planner that can prepare and execute conservative DJ-style handoffs between queued tracks.

## Current MVP

- `safety-long-blend` is the default conservative fallback for weak or rejected pairs.
- Weak/reject does not mean "must hard cut"; it means "use the safer long blend unless a hard runtime error blocks execution".
- The current listening checkpoint contains 57 real playlist tests: `1=54 / 2=2 / 3=1`.
- Current `safety-long-blend` pass rate from that checkpoint is 94.7%.
- The planner now records `outroCompleteness`, `bIntroAggression`, and `styleTextureDistance` diagnostics.

## Important Boundaries

- This is an experimental fork, not an official Mineradio release.
- No music files, cookies, playback URLs, or private tester data are included in the repository.
- Local feedback is written to `data/cuefield-feedback.jsonl`, which is ignored by git.
- Beatmap caches are local runtime artifacts and are ignored by git.
- Third-party music platform access remains subject to each platform's terms and copyright rules.

## Files

- `cuefield/recipe-planner.js` - recipe selection and safety fallback planning.
- `cuefield/mineradio-bridge.js` - Mineradio beatmap cache adapter.
- `public/cuefield-automix.js` - AutoMix state machine and execution gate.
- `public/cuefield-timeline-executor.js` - recipe timeline execution helpers.
- `public/index.html` - Mineradio UI integration, feedback buttons, and handoff runtime.
- `cuefield/feedback-log.js` - local feedback JSONL and summary stats.
- `cuefield/feedback-remote.js` - optional remote feedback mirroring.
- `scripts/cuefield-feedback-collector.js` - optional local collector server for multi-tester feedback.

## Multi-Tester Feedback

By default, feedback stays on each tester's machine. To collect feedback centrally, run a collector and configure testers to mirror feedback to it.

Collector:

```bash
CUEFIELD_FEEDBACK_COLLECTOR_TOKEN="change-me" \
CUEFIELD_FEEDBACK_COLLECTOR_HOST=127.0.0.1 \
CUEFIELD_FEEDBACK_COLLECTOR_PORT=3787 \
node scripts/cuefield-feedback-collector.js
```

Tester app:

```bash
CUEFIELD_FEEDBACK_REMOTE_URL="https://your-collector.example/cuefield-feedback" \
CUEFIELD_FEEDBACK_REMOTE_TOKEN="change-me" \
CUEFIELD_FEEDBACK_SOURCE="tester-name-or-build-id" \
npm start
```

The remote payload is intentionally small: rating, note, pair title/key metadata, recipe/tier/score/risk metadata, and transition timing. It does not include cookies, audio URLs, music files, or raw beatmap caches.

If the remote endpoint is not configured, unavailable, or times out, local feedback still succeeds.

## Local Verification

```bash
node --test test/cuefield*.test.js test/beatmap-cache-path.test.js
node --check server.js
```

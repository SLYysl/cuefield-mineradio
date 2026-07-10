# Cuefield Set Planner Design

> Date: 2026-07-11
> Status: approved for implementation

## Goal

Cuefield gains two independent set modes. `sequential` keeps queue order and optimizes only the transition. `smart` evaluates the next 10-20 queued songs, promotes the best transition candidate to the next slot, and keeps every skipped song in its original relative order.

The listener's explicit "play next" choice always overrides smart selection.

## Selection Flow

Smart mode uses bounded two-step lookahead:

1. Collect up to 20 future queue entries after the current song, targeting 16 when available.
2. Exclude the current song, recently played duplicates, unavailable keys, and duplicate candidate keys.
3. Ensure beat maps and request A -> B transition plans for the candidate pool.
4. Keep the best 3-4 immediate candidates.
5. For each finalist, evaluate up to three B -> C continuations and retain its best onward score.
6. Rank finalists, select from the safe top three, and move only the winner to `currentIndex + 1`.

If preparation fails, the candidate pool is too small, or no candidate is executable, the current sequential next song remains unchanged.

## Scoring

The final score is bounded to `0...1`:

- 55% immediate A -> B transition quality, including direct or bridge execution quality;
- 20% best B -> C onward transition quality;
- 15% surprise, including contrast that remains executable and lyric/dialogue linkage;
- 10% recent-set energy shape;
- penalties for repeated artist, repeated texture/style, duplicate keys, and monotonous BPM movement.

Planner inputs are compact transition summaries. It does not inspect raw audio or raw lyrics. A pair is safe only when its plan is executable, respects A's protected first Hook, and provides a valid B landing. Technical fallbacks remain available to AutoMix but do not compete as "magic" choices.

## Controlled Choice

After sorting safe candidates:

- choose among rank 1/2/3 with weights `0.60 / 0.27 / 0.13`;
- force rank 1 when its score lead over rank 2 exceeds `0.12`;
- force rank 1 when either alternative is unsafe, violates Hook protection, or only has a technical fallback;
- use the injected random function so selection is deterministic in tests.

This creates variation without choosing a clearly inferior transition.

## Manual Priority And Queue Mutation

Every user action that sets a song as next records an ephemeral song key. Before smart planning, Cuefield checks whether `currentIndex + 1` still matches that key. When it matches, the planner returns it immediately and performs no reordering.

The marker clears when that song becomes current, disappears from the queue, or is replaced by another manual-next action. It is not persisted across launches.

Smart promotion removes the selected future entry and inserts it at `currentIndex + 1`. All other entries retain their relative order. The ordinary player shuffle mode remains separate and does not enable Cuefield smart selection.

## Runtime Contract

Add browser UMD module `public/cuefield-set-planner.js` containing pure candidate collection, scoring, top-three selection, and promotion helpers. `public/index.html` owns asynchronous beat-map preparation, API calls, pair-plan caching, mode persistence, cancellation, and queue UI refresh.

Pair plans use a bounded in-memory cache keyed by `fromKey -> toKey`, with a short TTL. A new track switch invalidates stale in-flight selection through the existing playback token. Only the final selected pair is passed to AutoMix for audio preparation.

## UI

The Cuefield control exposes three states: off, sequential, and smart. Existing enabled users migrate to sequential. The button title and toast state the active mode and preparation status. The control stays compact and does not alter the ordinary playback mode control.

## Error Handling

- Missing beat map or audio key: skip that candidate.
- Pair API failure: record a compact diagnostic and continue the pool.
- Stale track token: discard the result without queue mutation.
- No safe finalist: preserve sequential order.
- Manual-next marker present: bypass smart planning.
- Queue changes during planning: resolve the winner again by key before promotion.

## Testing

Pure tests cover candidate bounds, deduplication, weighted choice, forced-best rules, score penalties, manual priority, and stable promotion. Integration contract tests cover mode persistence, manual marker creation, smart resolution before AutoMix preparation, stale-token protection, and sequential fallback.

## Non-Goals

- Whole-playlist preplanning.
- Rebuilding source/import integrations.
- Persisting an automatically generated set order.
- Reordering songs outside the future queue window.
- Publishing, deployment, or visibility changes.
- Modifying the unrelated local `desktop/main.js` Metal setting.

## Success Criteria

- Sequential mode preserves current queue behavior.
- Smart mode considers 10-20 future songs and uses two-step lookahead.
- Manual next always wins.
- Only the selected song moves; skipped songs keep their order.
- Selection uses safe weighted top-three choice with deterministic forced-best rules.
- Failure leaves a playable sequential next track.


# Cuefield Set Planner Implementation Plan

> **Execution:** Follow this plan task-by-task with test-driven development.

**Goal:** Add sequential and smart Cuefield set modes, with bounded two-step lookahead, safe weighted top-three choice, manual-next priority, and stable queue promotion.

**Architecture:** Put deterministic candidate/ranking logic in a browser-compatible pure UMD module. Keep asynchronous beat analysis, transition API access, caching, playback-token cancellation, and queue mutation orchestration in `public/index.html`. Resolve smart next before calling the existing AutoMix `prepare` path.

**Tech Stack:** Browser UMD JavaScript, Node `node:test`, existing Cuefield transition API and beat-map cache.

## Task 1: Pure Candidate And Choice Engine

**Files:**
- Create `test/cuefield-set-planner.test.js`
- Create `public/cuefield-set-planner.js`

1. Write failing tests for future-window collection (10-20, target 16), duplicate/recent exclusion, score weights and penalties, forced-best at a `>0.12` gap, unsafe-alternative forcing, deterministic `60/27/13` choice, manual-next resolution, and stable promotion.
2. Run `node --test test/cuefield-set-planner.test.js`; confirm RED because the module is absent.
3. Implement pure helpers: `collectCandidates`, `scoreCandidate`, `chooseTopCandidate`, `resolveManualNext`, and `promoteCandidate`.
4. Keep all numeric outputs bounded and inject `random` for tests.
5. Run the focused test and confirm GREEN.
6. Commit only the new module and test with `git commit -m "Add Cuefield smart set planner"`.

## Task 2: Mode And Manual-Next Integration

**Files:**
- Create `test/cuefield-set-ui.test.js`
- Modify `public/index.html`

1. Write source-contract tests proving the new script loads before AutoMix, the mode preference supports `off/sequential/smart`, existing enabled preference migrates to sequential, every manual-next entry point records the selected key, and smart mode is independent of ordinary shuffle.
2. Run `node --test test/cuefield-set-ui.test.js`; confirm RED.
3. Add the script tag, mode store key/state, compact mode-cycle control behavior, title/toast/status text, and an ephemeral `cuefieldManualNextKey`.
4. Record manual-next after successful queue insertion; clear it when consumed or invalidated.
5. Preserve the existing `cuefieldAutoMixEnabled` contract for AutoMix internals and old persisted users.
6. Run UI contract tests and existing UI/playback tests; confirm GREEN.
7. Commit the integration with `git commit -m "Expose Cuefield set modes"`.

## Task 3: Two-Step Smart Resolution

**Files:**
- Modify `test/cuefield-set-ui.test.js`
- Modify `public/index.html`

1. Add failing tests for resolution before `cuefieldAutoMix.prepare`, bounded pair-cache TTL, top 3-4 immediate finalists, up to three onward candidates, playback-token staleness checks, winner-by-key promotion, and sequential fallback.
2. Extract `planCuefieldSongPair(fromSong, toSong)` from AutoMix initialization so both AutoMix and smart selection use identical lyric fetching/API payloads.
3. Add a pair-plan memory cache and compact plan-to-score adapter.
4. Implement `resolveCuefieldNextIndex(token, currentIndex)`:
   - honor manual next;
   - return ordinary next in sequential mode;
   - collect smart candidates;
   - prepare/evaluate immediate pairs;
   - evaluate bounded B -> C lookahead for finalists;
   - choose and promote the winner only if token/current song are still valid.
5. Make `scheduleCuefieldAutoMixPrepare` await resolution inside its timer, then pass the resolved index to `runCuefieldAutoMixPrepare`.
6. On any error, log compact diagnostics and retain sequential next.
7. Run focused set, AutoMix, handoff, and UI tests; confirm GREEN.
8. Commit with `git commit -m "Plan Cuefield sets with two-step lookahead"`.

## Task 4: Set Planner Verification

1. Run `node --test test/cuefield-set-planner.test.js test/cuefield-set-ui.test.js test/cuefield-automix.test.js test/cuefield-playback-handoff.test.js`.
2. Run `git diff --check`.
3. Inspect `git status --short` and confirm `desktop/main.js` remains the only unrelated modification.
4. Do not restart or publish yet; continue directly to the Bridge Engine plan.


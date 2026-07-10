# Cuefield Bridge Engine Foundation Implementation Plan

> **Execution:** Follow this plan task-by-task with test-driven development.

**Goal:** Add an intelligent three-stage synthetic bridge that can transform A, generate an independent middle section, and introduce B so playback lands exactly on a trusted Hook/Drop.

**Architecture:** Calculate lyric linkage and bridge eligibility server-side while full structure maps exist. Return a compact bridge plan and timeline through the existing transition API. Normalize one bridge timeline action, then synthesize bounded procedural material in a browser UMD engine using the existing AudioContext. Direct transitions remain the deterministic fallback.

**Tech Stack:** CommonJS planner modules, browser UMD JavaScript, Node `node:test`, Web Audio API, existing Cuefield structure map and AutoMix timeline.

## Task 1: Explainable Lyric Link

**Files:**
- Create `test/cuefield-lyric-link.test.js`
- Create `cuefield/lyric-link.js`

1. Write failing tests for Chinese/English normalization, token/character overlap, `我/你` and `I/you` call-response, bounded suffix/rhyme similarity, vocal timing collision penalty, and no raw text in returned diagnostics.
2. Run `node --test test/cuefield-lyric-link.test.js`; confirm RED.
3. Implement a local deterministic scorer returning `{ score, reasons }` only.
4. Run the focused test and confirm GREEN.
5. Commit with `git commit -m "Score Cuefield lyric links"`.

## Task 2: Bridge Planner And Exact Climax Landing

**Files:**
- Create `test/cuefield-bridge-planner.test.js`
- Create `cuefield/bridge-planner.js`

1. Write failing fixtures/tests for first-Hook protection, trusted Hook/Drop confidence `>=0.72`, usable beat grids, minimum four bars, 4/8/16-bar selection, all four templates, score-improvement gating, contrast/terminal override, and exact B climax landing.
2. Assert in every winning plan that `bPlayAt + stage3Duration === climax.time` within tolerance and that the handoff occurs at the climax.
3. Run the test and confirm RED.
4. Implement pure climax selection, bar/runway math, template choice, predicted score, eligibility reasons, and timeline construction.
5. Embed a gain/EQ direct fallback timeline in the bridge plan.
6. Run the test and confirm GREEN.
7. Commit with `git commit -m "Plan Cuefield synthetic bridges"`.

## Task 3: Transition API Integration

**Files:**
- Modify `test/cuefield-mineradio-bridge.test.js`
- Modify `cuefield/mineradio-bridge.js`

1. Add failing tests proving bridge planning sees full structures/LRC, wins only when eligible, leaves direct plans unchanged otherwise, returns compact climax/reason fields, and never returns raw lyric text.
2. Run `node --test test/cuefield-mineradio-bridge.test.js`; confirm RED.
3. Invoke lyric-link and bridge planners after the direct window plan. When bridge wins, replace the chosen executable timeline while preserving direct diagnostics and fallback.
4. Add compact bridge diagnostics used by smart-set immediate scoring.
5. Run bridge/API tests and confirm GREEN.
6. Commit with `git commit -m "Route Cuefield transitions through bridges"`.

## Task 4: Timeline Contract And Procedural Runtime

**Files:**
- Create `test/cuefield-bridge-engine.test.js`
- Create `public/cuefield-bridge-engine.js`
- Modify `test/cuefield-timeline-executor.test.js`
- Modify `public/cuefield-timeline-executor.js`

1. Write failing tests for bridge action normalization, bounded 4/8/16 bars, per-bar BPM interpolation, template event families, maximum event count, idempotent stop, and failed AudioContext fallback.
2. Run focused tests and confirm RED.
3. Normalize `op: 'bridge'` with compact template/bars/BPM/stage fields.
4. Implement event-plan generation separately from Web Audio scheduling so timing is testable without a browser.
5. Implement `start`/`stop` using bounded oscillators, noise buffers, gains, and filters on the supplied AudioContext; track and disconnect every node.
6. Run focused tests and confirm GREEN.
7. Commit with `git commit -m "Synthesize Cuefield bridge material"`.

## Task 5: Playback Integration And Failure Safety

**Files:**
- Modify `test/cuefield-playback-handoff.test.js`
- Modify `test/cuefield-automix.test.js`
- Modify `public/cuefield-automix.js`
- Modify `public/index.html`

1. Write failing contract tests proving the bridge script loads, pending AutoMix preserves bridge plans, bridge actions start the engine, reset/cancel/handoff stop it, and synthesis failure leaves direct gain/EQ actions executable.
2. Run focused tests and confirm RED.
3. Load and initialize the bridge engine, invoke it from timeline action dispatch, and stop it from every existing AutoMix reset/teardown path.
4. Preserve bridge metadata in pending state and feedback diagnostics without raw lyrics.
5. Ensure the engine uses the current shared AudioContext and never creates an uncontrolled second context.
6. Run focused tests and confirm GREEN.
7. Commit with `git commit -m "Execute Cuefield three-stage bridges"`.

## Task 6: Full Verification And Listening Handoff

**Files:**
- Modify `CURRENT_STATE.md`

1. Run every Cuefield-focused test, then `node --test test/*.test.js`.
2. Run `git diff --check` and inspect status/diff for scope and secret safety.
3. Exercise real cached song pairs and report direct-versus-bridge selection, trusted climax, bars, template, and predicted score.
4. Stop only the Mineradio process owned by this worktree, restart with the established local command, and verify `http://127.0.0.1:3000` responds.
5. Update `CURRENT_STATE.md` within 30 lines with verified state and listening instructions.
6. Do not push, deploy, publish, or change repository visibility. Preserve `desktop/main.js` untouched.

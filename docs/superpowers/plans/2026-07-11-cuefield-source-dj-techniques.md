# Cuefield Source DJ Techniques Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement six source-track DJ techniques with strict evidence gates and executable fallbacks.

**Architecture:** Extend the compact timeline contract with bounded duck, loop, and echo-tail fields. Keep source-loop state in a focused UMD runtime module. Build teaser and double-drop from existing actions, and make recipe eligibility depend on beat, structure, vocal, energy, and musical evidence.

**Tech Stack:** Node test runner, Web Audio, HTMLMediaElement, Cuefield recipe planner and timeline executor.

---

### Task 1: Timeline primitives

**Files:** `public/cuefield-timeline-executor.js`, `test/cuefield-timeline-executor.test.js`

- [x] Test bounded `duck`, `loop`, and `echo.tailMs` normalization.
- [x] Mark addressed deck graphs and source-loop runtime requirements.
- [x] Keep unsupported values finite and bounded.

### Task 2: Source loop runtime

**Files:** `public/cuefield-source-loop.js`, `test/cuefield-source-loop.test.js`, `public/index.html`

- [x] Test real source-region repetition and slip release catch-up.
- [x] Test idempotent stop/reset and stale-token rejection.
- [x] Execute normalized loop actions and clean them on reset/handoff.

### Task 3: Audio execution

**Files:** `public/index.html`, `test/cuefield-feedback-stats-ui.test.js`

- [x] Execute beat-synchronized low-band duck envelopes.
- [x] Preserve release echo feedback/wet decay for the requested tail.
- [x] Downgrade to fallback timeline if a required graph or loop runtime is unavailable.

### Task 4: Recipe generation and gates

**Files:** `cuefield/recipe-planner.js`, `test/cuefield-recipe-planner.test.js`

- [x] Refine filtered pickup and bass swap curves and embed ducking.
- [x] Add source-loop-roll with 1-bar, half-bar, and half-beat phases.
- [x] Add hook-teaser using B playback/fade/stop before the final entry.
- [x] Add harmonic-double-drop with simultaneous landing and immediate bass ownership exchange.
- [x] Verify low-confidence pairs never select the three advanced recipes.

### Task 5: Integration and verification

**Files:** `cuefield/transition-window-planner.js`, `cuefield/mineradio-bridge.js`, `cuefield/feedback-log.js`, `CURRENT_STATE.md`

- [x] Expose compact technique/gate diagnostics without raw musical profiles.
- [x] Run focused and full tests plus syntax/whitespace checks.
- [x] Restart Mineradio and inspect real plans; keep the branch local and unpushed.

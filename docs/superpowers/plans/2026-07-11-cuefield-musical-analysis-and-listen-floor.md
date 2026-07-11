# Cuefield Musical Analysis And Listen Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dynamic automatic-listening floor and a cached Basic Pitch musical profile that safely improves transition ranking.

**Architecture:** Keep timing protection in the small UMD AutoMix runtime. Keep audio sampling pure and testable in its own renderer module, and run TensorFlow/Basic Pitch in a persistent Electron worker behind a bounded IPC service. Pass compact profiles through the existing beat-map adapter and use them only when both sides have reliable evidence.

**Tech Stack:** Node test runner, Electron IPC/worker_threads, Web Audio `AudioBuffer`, `@spotify/basic-pitch`, TensorFlow.js.

---

### Task 1: Automatic listening floor

**Files:**
- Modify: `public/cuefield-automix.js`
- Test: `test/cuefield-automix.test.js`

- [ ] Add a failing test proving a 240-second track cannot auto-transition at 30 seconds and is held to 100.8 seconds.
- [ ] Add a failing test proving `protectedUntil` may extend but never shorten the floor.
- [ ] Implement `minimumListenUntil(duration)` as `clamp(duration * 0.42, 72, 108)` and include the value in pending diagnostics.
- [ ] Run `node --test test/cuefield-automix.test.js` and commit the green change.

### Task 2: Representative audio sampler

**Files:**
- Create: `public/cuefield-musical-sampler.js`
- Create: `test/cuefield-musical-sampler.test.js`
- Modify: `public/index.html`

- [ ] Add failing tests for mono mixing, 22.05 kHz resampling, bounded output, and an opening window.
- [ ] Implement four deterministic windows totaling at most 16 seconds.
- [ ] Load the module before the main renderer code and run its focused tests.

### Task 3: Basic Pitch worker service

**Files:**
- Create: `desktop/cuefield-musical-analysis.js`
- Create: `desktop/cuefield-musical-worker.js`
- Create: `test/cuefield-musical-analysis.test.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add failing service tests for queueing, bounded samples, timeout, and worker failure.
- [ ] Install `@spotify/basic-pitch` and implement lazy model loading in a worker.
- [ ] Register `cuefield-musical-analyze` IPC and expose the narrow preload method.
- [ ] Run focused service and desktop contract tests.

### Task 4: Cache and transition ranking

**Files:**
- Modify: `public/index.html`
- Modify: `cuefield/adapter-mineradio.js`
- Modify: `cuefield/transition-window-planner.js`
- Modify: `cuefield/mineradio-bridge.js`
- Modify: `cuefield/feedback-log.js`
- Test: `test/cuefield-musical-profile.test.js`
- Test: `test/cuefield-mineradio-bridge.test.js`

- [ ] Add failing tests proving profile cache round-trip and neutral behavior when evidence is missing.
- [ ] Add a failing ranking test where reliable musical evidence breaks an otherwise close tie.
- [ ] Enrich new and cached beat maps opportunistically; failures remain beat-only.
- [ ] Pass only compact compatibility metrics into diagnostics and feedback.
- [ ] Run focused tests and commit.

### Task 5: Verification

**Files:**
- Modify: `CURRENT_STATE.md`

- [ ] Run `npm test` if available, otherwise `node --test test/*.test.js`.
- [ ] Run `git diff --check` and syntax checks for changed JavaScript files.
- [ ] Restart Mineradio and verify a real cached track gains `musicalProfile` without renderer blocking.
- [ ] Confirm a prepared 3-4 minute track reports a trigger no earlier than the dynamic floor.
- [ ] Update the checkpoint without publishing, deploying, or pushing.

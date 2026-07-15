# Cuefield GitHub Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public GitHub landing page so a music-platform engineer can identify Cuefield's role, transition system, engineering evidence, and Mineradio host relationship within 30 seconds.

**Architecture:** Keep all runtime code untouched. The showcase consists of one README, one user-provided source image, one derived hero image, and one static architecture SVG. Every public claim comes from the current public branch or its test output.

**Tech Stack:** GitHub Flavored Markdown, static PNG/SVG assets, Node.js test runner, Git.

---

### Task 1: Capture Current Evidence

**Files:**
- Read: `cuefield/recipe-planner.js`
- Read: `cuefield/render-preview-cli.js`
- Read: `cuefield/*.js`
- Read: `public/cuefield-*.js`
- Read: `test/*.js`

- [ ] **Step 1: Verify the baseline test count**

Run:

```bash
node --test test/*.test.js | tail -12
```

Expected: `# tests 398`, `# pass 398`, `# fail 0`.

- [ ] **Step 2: Record display metrics**

Run:

```bash
git ls-files -z 'cuefield/*.js' 'public/cuefield*.js' | xargs -0 wc -l | tail -1
git ls-files -z 'test/*.js' | xargs -0 wc -l | tail -1
git rev-list --count HEAD
```

Use the returned totals verbatim and label the commit number as repository history, not Cuefield-only history.

- [ ] **Step 3: Verify the recipe inventory**

Run:

```bash
rg -o "baseCandidate\\(\\s*['\"][^'\"]+" cuefield/recipe-planner.js -U \
  | sed -E "s/.*['\"]//" \
  | rg -v '^baseCandidate\\($' \
  | sort -u
```

Expected recipe IDs:

```text
bass-eq-handoff
echo-out
filtered-pickup
harmonic-double-drop
hook-teaser
intro-outro-long-blend
quick-safe-fade
safety-long-blend
source-loop-roll
spectral-emergence
tease-roll-double-drop
```

### Task 2: Build the Hero Asset

**Files:**
- Source: `/Users/sly/Downloads/FE6CFB14-8D77-4738-A903-8D24122AD547.PNG`
- Create: `docs/assets/readme/cuefield-mobius-source.png`
- Create: `docs/assets/readme/cuefield-mobius-hero.png`

- [ ] **Step 1: Preserve the user-provided source**

Copy the source PNG byte-for-byte into `docs/assets/readme/cuefield-mobius-source.png`. Verify both files have the same SHA-256 digest.

Run:

```bash
cp /Users/sly/Downloads/FE6CFB14-8D77-4738-A903-8D24122AD547.PNG \
  docs/assets/readme/cuefield-mobius-source.png
shasum -a 256 \
  /Users/sly/Downloads/FE6CFB14-8D77-4738-A903-8D24122AD547.PNG \
  docs/assets/readme/cuefield-mobius-source.png
```

Expected: both SHA-256 values are identical.

- [ ] **Step 2: Produce the horizontal hero**

Use the imagegen editing workflow with the source PNG. Generate a 1600×760 composition with these exact constraints:

```text
Preserve the metallic Möbius cube geometry and realistic material. Place the full cube on the right 58 percent of a 1600x760 canvas. Extend the scene into a deep charcoal background with warm silver reflections. Leave the left 42 percent quiet and dark for README text. Do not add letters, logos, UI, gradients in rainbow colors, pills, capsules, extra objects, or animation. Keep premium audio-hardware product photography, controlled studio lighting, and high contrast edges.
```

Save the result as `docs/assets/readme/cuefield-mobius-hero.png`.

- [ ] **Step 3: Verify asset dimensions**

Run:

```bash
sips -g pixelWidth -g pixelHeight -g format docs/assets/readme/cuefield-mobius-source.png docs/assets/readme/cuefield-mobius-hero.png
```

Expected: source `1254×1254 PNG`; hero `1600×760 PNG`.

### Task 3: Create the Architecture Graphic

**Files:**
- Create: `docs/assets/readme/cuefield-architecture.svg`

- [ ] **Step 1: Draw the static pipeline**

Create an SVG with a 1600×360 viewBox, white background, and seven high-saturation red, orange, yellow, green, cyan, blue, and purple cards connected by a rainbow signal line. Include these nodes in order:

```text
HOST DATA
MUSICAL ANALYSIS
STRUCTURE MAP
TRANSITION ROUTER
RECIPE PLANNER
TIMELINE EXECUTOR
FEEDBACK
```

Use only SVG paths, rects, text, gradients, opacity, and masks. Do not use JavaScript, animation, external fonts, or external images.

- [ ] **Step 2: Verify SVG safety**

Run:

```bash
rg -n '<script|foreignObject|https?://|@import|animation' docs/assets/readme/cuefield-architecture.svg
```

Expected: no matches.

### Task 4: Rewrite the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the mixed Cuefield/Mineradio hierarchy**

Use this section order and exact headings:

```markdown
# Cuefield
## 中文速览
## Why Cuefield
## How It Works
## 11 Transition Recipes
## Engineering Evidence
## Architecture & Repository Map
## Offline Preview CLI
## Safety & Data Boundary
## Mineradio: The Real-World Host
## License & Attribution
```

Place `docs/assets/readme/cuefield-mobius-hero.png` before the title. Keep the title and technical narrative in English. Add one compact Chinese paragraph under `中文速览`.

- [ ] **Step 2: Add verified engineering evidence**

Show the exact totals from Task 1 in a compact table. Describe the 94.7% result as a 57-transition historical checkpoint: `54 positive / 2 neutral / 1 negative`. Do not call it model accuracy or overall engine accuracy.

- [ ] **Step 3: Add the recipe matrix**

List all 11 recipe IDs from Task 1. Give each one a one-sentence purpose derived from `recipe-planner.js`, plus a short guardrail or fallback note. Do not invent listening results.

- [ ] **Step 4: Add real navigation and CLI usage**

Link the architecture stages to their current files. Document the actual invocation shape from `cuefield/render-preview-cli.js`. State that users supply their own local audio and that the repository includes no music.

- [ ] **Step 5: Compress Mineradio to host context**

Keep one short host paragraph, the upstream Mineradio link, GPL-3.0 attribution, privacy boundary, and third-party platform disclaimer. Remove installer instructions, donation material, troubleshooting, and the long Mineradio feature list from the Cuefield landing page.

### Task 5: Verify Scope and Rendering

**Files:**
- Verify: `README.md`
- Verify: `docs/assets/readme/cuefield-mobius-source.png`
- Verify: `docs/assets/readme/cuefield-mobius-hero.png`
- Verify: `docs/assets/readme/cuefield-architecture.svg`
- Verify: `docs/superpowers/specs/2026-07-15-cuefield-github-showcase-design.md`
- Verify: `docs/superpowers/plans/2026-07-15-cuefield-github-showcase.md`

- [ ] **Step 1: Confirm internal code is untouched**

Run:

```bash
git diff --name-only sly-public/main...HEAD
```

Expected paths are limited to the six display files listed above.

- [ ] **Step 2: Run formatting and test checks**

Run:

```bash
git diff --check sly-public/main...HEAD
node --test test/*.test.js
```

Expected: no diff errors; `398` tests pass with `0` failures.

- [ ] **Step 3: Render README locally and inspect GitHub**

Render the Markdown with a GitHub-compatible preview, inspect desktop and narrow widths, then push the display branch. Open the public branch page in a browser and confirm the hero, architecture SVG, tables, relative links, and collapsed sections load.

- [ ] **Step 4: Commit the showcase**

Run:

```bash
git add -A
git commit -m "docs: rebuild Cuefield GitHub showcase"
```

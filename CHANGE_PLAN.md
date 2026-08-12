# DraftPulse — 8-Phase Evolution Plan

> This document summarises the planned evolution from the current v2.0 architecture to a mature, differentiated product. Each phase is designed to be independently shippable.

---

## Phase 1: Audit & Documentation ← **Current Phase**

**Goal:** Establish a complete, accurate baseline of the v2.0 architecture.

### Key deliverables
- ✅ `CURRENT_ARCHITECTURE.md` — 12-area architecture audit (this document)
- ✅ `CHANGE_PLAN.md` — this file
- Verify all tests pass (`node tests/run_tests.js`)
- Confirm no undocumented auto-click behaviours

### Files reviewed
- All `shared/xg_*.js` (14 modules)
- `content.js`, `background.js`, `gemini_bridge.js`, `chatgpt_bridge.js`, `deepseek_bridge.js`
- `popup.js`, `popup.html`, `popup.css`, `styles.css`
- `manifest.json`

### Files modified
- None (read-only audit)

---

## Phase 2: Security Hardening + Pulse Score

**Goal:** Strengthen input validation and introduce a composite "Pulse Score" that combines view growth with engagement signals.

### Key features
- **Input sanitisation audit** — verify all user-controlled and model-controlled inputs are bounded; add CSP headers if applicable
- **Prompt injection defence** — strengthen `<tweet>` boundary markers; add explicit "do not execute" instructions; validate model output doesn't contain injected commands
- **Pulse Score algorithm** — composite metric combining:
  - View growth rate (existing)
  - Engagement ratio (likes + replies + reposts) / views
  - Recency weighting
  - Configurable formula in a new `shared/xg_pulse.js`
- **Heat badge redesign** — use Pulse Score instead of raw view rate; new visual levels
- **Rate limiting guard** — prevent rapid-fire generation requests (e.g. max 1 per 10 seconds per tab)

### Files modified
- `shared/xg_pulse.js` — **new file**: Pulse Score calculation
- `shared/xg_growth.js` — export additional engagement helpers
- `content.js` — integrate Pulse Score into badge/metrics display
- `styles.css` — new badge styles for Pulse Score levels
- `tests/test_pulse.js` — **new file**: Pulse Score unit tests
- `manifest.json` — no changes expected

---

## Phase 3: Expanded Persona System + Cooldown

**Goal:** Give users more control over reply style and prevent over-use.

### Key features
- **New persona presets** — expand from 6+custom to 10+custom:
  - `thread_unroller` — "Summarise the thread and add one insight"
  - `quote_tweet` — "Write as if quoting this tweet with commentary"
  - `emoji_reply` — "Short punchy reply with 1-2 relevant emoji"
  - `hot_take` — "Bold, controversial but defensible take"
- **Per-persona prompt templates** — each persona carries its own system-level instruction fragment in `PERSONA_INSTRUCTIONS`
- **Cooldown system** — configurable minimum interval between auto-generations:
  - Default: 15 seconds between requests
  - Stored in settings (`cooldownSeconds`)
  - Enforced in `content.js` with per-panel countdown display
  - Prevents accidental rapid requests
- **Smart cooldown** — longer cooldown after errors; shorter for manual mode

### Files modified
- `shared/xg_settings.js` — new persona IDs, `cooldownSeconds` in DEFAULT_SETTINGS, `normalizeSettings` updates
- `shared/xg_prompt.js` — persona-specific prompt templates
- `content.js` — cooldown timer UI, enforcement logic
- `popup.html` / `popup.js` — cooldown setting field
- `styles.css` — cooldown countdown styles
- `tests/test_settings.js` — updated for new settings fields

---

## Phase 4: Thread Context + Per-Account Memory

**Goal:** Make replies contextually aware of the conversation thread and the tweet author's style.

### Key features
- **Thread context extraction** — when replying to a thread (not a standalone tweet):
  - Walk up the DOM to find parent tweet (if in a thread view)
  - Collect 2-3 preceding tweets as context
  - Include in prompt as `<thread_context>` block
  - New function `collectThreadContext()` in `content.js`
- **Per-account memory** — lightweight local store of author patterns:
  - Track author handle → typical topics, language, emoji usage
  - Stored in `chrome.storage.local` (key: `draftpulseAuthorProfiles`)
  - Included in prompt as `<author_context>` to help model match tone
  - Profiles built incrementally from observed tweets (read-only, no API calls)
- **Author profile schema** — `{ handle, tweetCount, avgLength, topics[], language, lastSeen }`
- New module `shared/xg_author.js` for profile management

### Files modified
- `shared/xg_author.js` — **new file**: author profile storage and retrieval
- `shared/xg_prompt.js` — include `<thread_context>` and `<author_context>` blocks
- `shared/xg_selectors.js` — thread-related selectors (parent tweet, conversation root)
- `content.js` — `collectThreadContext()`, author profile updates
- `background.js` — pass thread/author context to prompt builder
- `tests/test_author.js` — **new file**: author profile unit tests

---

## Phase 5: Draft Panel UI + Multiple Candidates

**Goal:** Redesign the inline toolbar into a richer draft panel with side-by-side candidate comparison.

### Key features
- **Expandable draft panel** — current toolbar stays compact; clicking "生成回复草稿" expands into a panel below the tweet showing:
  - All candidates (up to 3) in cards
  - Each card shows: reply text, persona used, length indicator
  - One-click fill: clicking a card fills the X reply editor
  - Visual diff highlighting between candidates
- **Candidate quality indicators** — per-candidate metadata:
  - Length vs maxReplyLength bar
  - Emoji count
  - Question detected
  - Tone label (from persona)
- **History panel** — last 10 generated replies accessible even after page scroll
  - Stored in `chrome.storage.local` (key: `draftpulseReplyHistory`)
  - Accessible from toolbar icon
- **Keyboard shortcuts** — `Ctrl+Enter` to fill selected candidate; `Esc` to collapse panel

### Files modified
- `content.js` — panel expansion logic, candidate card rendering, history management
- `styles.css` — major panel redesign (cards, expand animation, diff highlighting)
- `popup.html` / `popup.js` — history viewer
- `shared/xg_settings.js` — `historySize` setting
- `background.js` — history storage/retrieval handlers

---

## Phase 6: My Voice + Settings Redesign

**Goal:** Let users teach the model their personal writing style and simplify the settings UI.

### Key features
- **"My Voice" samples** — users paste 2-3 examples of their own replies:
  - Stored in `chrome.storage.sync` (keys: `myVoiceSamples[0-2]`)
  - Included in prompt as `<my_voice>` block with instruction: "Match this person's writing style"
  - Max 300 chars per sample
- **Voice style extraction** — lightweight analysis of samples:
  - Average sentence length
  - Emoji frequency
  - Formal/casual ratio
  - Question tendency
  - Fed into prompt as style hints
- **Settings redesign** — popup UI overhaul:
  - Tabbed layout: "General" / "Style" / "Advanced" / "Diagnostics"
  - Visual persona preview (example output per persona)
  - Inline help tooltips
  - Collapsible advanced options
- **Import/export settings** — JSON export/import for backup

### Files modified
- `shared/xg_settings.js` — `myVoiceSamples`, voice analysis helpers
- `shared/xg_prompt.js` — `<my_voice>` block integration
- `shared/xg_voice.js` — **new file**: voice sample analysis
- `popup.html` — tabbed layout redesign
- `popup.css` — new tab styles, visual persona preview
- `popup.js` — tab navigation, voice sample management, import/export
- `tests/test_voice.js` — **new file**: voice analysis tests

---

## Phase 7: Diagnostics + Performance Optimization

**Goal:** Improve observability and reduce resource usage.

### Key features
- **Enhanced diagnostics panel**:
  - Per-stage timing waterfall chart (visual, in popup)
  - Bridge health indicator (latency, last error, re-injection count)
  - Memory usage estimate (snapshot count, history size, pending replies)
  - Export full diagnostic bundle as JSON (already exists) or readable text
- **Performance optimizations**:
  - Reduce MutationObserver callback frequency with requestIdleCallback batching
  - Virtualise panel updates: only update visible panels (IntersectionObserver)
  - Debounce metrics re-reads more aggressively (current: 2s → adaptive 5s for stable tweets)
  - Lazy-load image descriptors (only when user clicks generate)
  - Reduce bridge polling frequency when no active request
- **Error telemetry** (opt-in, local only):
  - Track error frequency by type
  - Surface in diagnostics
  - No network transmission — purely local

### Files modified
- `content.js` — IntersectionObserver for panel visibility, requestIdleCallback batching, lazy image descriptors
- `popup.html` / `popup.css` / `popup.js` — waterfall chart, health indicators, memory stats
- `shared/xg_diagnostics.js` — extended timing collection, error categorisation
- `background.js` — adaptive polling, bridge health tracking
- `styles.css` — minimise reflows during panel updates

---

## Phase 8: Final Tests + Documentation

**Goal:** Ensure full test coverage, write user-facing documentation, and prepare for release.

### Key features
- **Test coverage expansion**:
  - Unit tests for all new modules (pulse, author, voice)
  - Integration tests for full generation flow (mock bridge)
  - Edge case tests: empty tweets, image-only tweets, very long threads
  - Performance regression tests (panel insertion time, scan frequency)
- **DOM safety test suite**:
  - Automated verification that no auto-click targets exist on X pages
  - Regression test: assert only `showMore.click()` is called on X
  - Contract test: bridge scripts only click within their own domain
- **User documentation**:
  - Quick-start guide (install, first use, provider setup)
  - Persona guide (what each persona does, when to use)
  - Troubleshooting FAQ (bridge not ready, context invalidated, etc.)
  - Privacy statement (what's stored, what's not transmitted)
- **Release preparation**:
  - Version bump to 3.0
  - CHANGELOG.md update with all new features
  - manifest.json description update
  - Icon refresh if needed
  - Chrome Web Store asset preparation

### Files modified
- `tests/` — new test files for each new module
- `tests/run_tests.js` — register new test files
- `CHANGELOG.md` — comprehensive changelog
- `manifest.json` — version bump, description update
- `AGENTS.md` — update architecture documentation to reflect v3.0

---

## Phase Dependency Graph

```
Phase 1 (Audit)
  └── Phase 2 (Security + Pulse Score)
        ├── Phase 3 (Personas + Cooldown)
        │     └── Phase 6 (My Voice + Settings)
        └── Phase 4 (Thread Context + Author Memory)
              └── Phase 5 (Draft Panel UI)
                    └── Phase 7 (Diagnostics + Perf)
                          └── Phase 8 (Tests + Docs)
```

Phases 2, 3, and 4 can proceed in parallel after Phase 1. Phase 5 depends on Phase 4's thread context. Phase 7 consolidates all prior phases. Phase 8 is the final gate.

---

## File Impact Summary

| File | Phases |
|---|---|
| `shared/xg_pulse.js` | 2 (new) |
| `shared/xg_author.js` | 4 (new) |
| `shared/xg_voice.js` | 6 (new) |
| `shared/xg_settings.js` | 3, 5, 6 |
| `shared/xg_prompt.js` | 3, 4, 6 |
| `shared/xg_diagnostics.js` | 7 |
| `content.js` | 2, 3, 4, 5, 7 |
| `background.js` | 4, 5, 7 |
| `popup.html` | 3, 5, 6, 7 |
| `popup.css` | 5, 6, 7 |
| `popup.js` | 3, 5, 6, 7 |
| `styles.css` | 2, 5, 7 |
| `manifest.json` | 8 |
| `AGENTS.md` | 8 |
| `CHANGELOG.md` | 8 |
| `tests/test_pulse.js` | 2 (new) |
| `tests/test_author.js` | 4 (new) |
| `tests/test_voice.js` | 6 (new) |

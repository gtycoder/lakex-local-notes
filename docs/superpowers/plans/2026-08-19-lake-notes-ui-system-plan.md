# Lake Notes UI System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Implement the approved Lake Notes shell/UI improvements while preserving the SiYuan layout and Lake-native editor toolbar, then perform a code/UI audit.

**Architecture:** Keep `src/styles.css` as the import entry and add a Lake semantic token layer first. Build sync and search as explicit shell-level components/contracts around existing native IPC; do not modify Lake editor toolbar DOM or behavior. Add window persistence in Electron main, then verify every user-visible surface in the real Electron window through CDP and physical mouse where relevant.

**Tech Stack:** React 18, TypeScript, Electron 43, better-sqlite3/FTS5, Vite, Vitest, CDP, Lucide icons.

---

### Task 1: Establish semantic UI tokens without changing behavior

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/b3/dark.css`
- Test: `src/styles/tokens.test.ts` (token contract test if the project test environment supports CSS imports; otherwise a pure token-map test in `src/lib/theme.test.ts`)

- [ ] Add a token contract test for the required light/dark semantic values and motion durations.
- [ ] Run `npm test -- --run src/lib/theme.test.ts` (or the chosen token test) and verify it fails before implementation.
- [ ] Add `src/styles/tokens.css` with `--lake-shell`, `--lake-panel`, `--lake-canvas`, `--lake-border`, text tokens, accent/state tokens, and motion tokens. Scope dark values under `[data-theme="dark"]`.
- [ ] Import `tokens.css` after B3 theme files and before product overrides so the shell can consume aliases while B3 remains the foundation.
- [ ] Replace only product-shell hardcoded colors in a bounded first pass; do not touch `.ne-ui-*` Lake toolbar layout rules.
- [ ] Add/retain `prefers-reduced-motion` for shell transitions and animations.
- [ ] Run the token test, `npx tsc --noEmit`, and `git diff --check`.
- [ ] Commit: `refactor(ui): add Lake semantic theme and motion tokens`.

### Task 2: Consolidate shell CSS and dark-mode surface wiring

**Files:**
- Create: `src/styles/shell.css`
- Create: `src/styles/overlays.css`
- Create: `src/styles/quick-notes.css`
- Create: `src/styles/responsive.css`
- Create: `src/styles/editor-bridge.css`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/b3/layout.css`
- Modify: `src/features/outline/outline.css`

- [ ] Add a stylesheet-boundary test/check script that confirms the new files are imported and no file is empty.
- [ ] Run the check before moving rules and record the current baseline.
- [ ] Move only clearly-owned rules from `src/styles.css` into the new files; leave `styles.css` as a compatibility entry point with imports and rules that are still cross-cutting.
- [ ] Route desktop shell, sidebar, statusbar, overlays and quick-notes backgrounds through semantic tokens in light and dark modes.
- [ ] Keep current rail trigger geometry, collapsed rail pointer-event behavior, and 260ms outline column transition unchanged.
- [ ] Add a reduced-motion fallback covering new shell files.
- [ ] Run `npm test`, `npx tsc --noEmit`, `vite build`, and `git diff --check`.
- [ ] Commit: `refactor(ui): split shell styles from editor bridge`.

### Task 3: Build sync status summary and popover

**Files:**
- Create: `src/components/SyncStatusPopover.tsx`
- Create: `src/components/SyncStatusPopover.test.tsx`
- Modify: `src/components/DesktopStatusBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/styles/overlays.css`

- [ ] Write failing component tests covering: default “本地已保存”, pending count, syncing state, error state, and one-shot history-snapshot notice.
- [ ] Run the component test and verify it fails for missing component/contract.
- [ ] Define a view-model input that separates local save state from sync state and carries `pendingDocuments`, `pendingResources`, `lastSyncedAt`, `lastSavedAt`, `dirtyTabCount`, and optional `supersededNotes`.
- [ ] Render a compact top-bar control with accessible label; default label is local-first and only adds `待上传 N` when count is non-zero.
- [ ] Render a click popover with local state, cloud state, history snapshot notice, `立即同步`, `同步设置`, and `查看历史` actions.
- [ ] Keep the existing SyncToast for transient progress/errors; do not create a second persistent conflict banner.
- [ ] Wire the App's current `sync` and `saveState` values into the view model. Use available note summaries to derive pending note count without inventing sync behavior.
- [ ] Run component tests, TypeScript and the existing sync tests.
- [ ] Commit: `feat(ui): add local-first sync status popover`.

### Task 4: Implement global `⌘K` title/body search

**Files:**
- Modify: `electron/searchRepository.ts`
- Modify: `electron/searchRepository.test.ts` or the existing search/store test file
- Modify: `electron/ipc/registerNotes.ts` if IPC arguments/return shape change
- Modify: `electron/preload.cjs`
- Modify: `src/lib/native.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/components/SearchPanel.tsx`
- Create: `src/components/SearchPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/overlays.css`

- [ ] Write failing repository tests for 1-character title-only, 2-character title/body, exact/prefix/contains/body ranking, and exclusion of trash/Quick Notes.
- [ ] Run the repository tests and verify the new cases fail against the current 3-character implementation.
- [ ] Change the repository query strategy: one-character title LIKE; 2+ FTS title/body; deterministic ranking with exact title, prefix title, contains title, then body hit; preserve safe FTS escaping.
- [ ] Extend result metadata with enough information for UI display and first body hit positioning. If exact offsets are unavailable from FTS, return a sanitized snippet plus a body-hit flag and add a deterministic editor locate request based on the first matching plain-text occurrence.
- [ ] Add a global keydown listener in App for `Meta+KeyK`, ignoring editable fields unless the event is explicitly the app command shortcut; reuse the existing SearchPanel surface.
- [ ] Add active-result state, ArrowUp/ArrowDown, Enter, Meta+Enter, Esc, and focus restoration.
- [ ] Change debounce to 120ms and update copy to explicitly say titles/body, excluding Quick Notes.
- [ ] Wire opening/locating: normal open retains current tab; Meta+Enter opens a new tab; after editor readiness, invoke the host locate contract for the first body hit.
- [ ] Run all search tests, TypeScript, and build.
- [ ] Commit: `feat(search): add global title and body command search`.

### Task 5: Persist Electron window bounds and add Focus Mode

**Files:**
- Modify: `electron/main.ts`
- Create: `electron/windowState.ts`
- Create: `electron/windowState.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles/shell.css`
- Modify: `src/lib/native.ts` only if a focused-window IPC is required

- [ ] Write failing pure tests for clamping bounds to display work area and restoring maximized state safely.
- [ ] Implement a small window-state repository using `app.getPath("userData")`, with defensive JSON parsing and fallback defaults.
- [ ] Restore width/height/x/y before `BrowserWindow` creation; clamp to available display bounds; persist on `resize`, `move`, `maximize`, `unmaximize`, `enter-full-screen`, `leave-full-screen`, and close.
- [ ] Add Focus Mode state to the shell and a shortcut. It hides sidebar, outline and statusbar chrome while leaving the document and title control usable; restore the prior modes on exit.
- [ ] Add reduced-motion styles for Focus Mode transitions.
- [ ] Run window-state tests, TypeScript, build, and a real Electron launch/close/relaunch check.
- [ ] Commit: `feat(window): persist desktop bounds and add focus mode`.

### Task 6: Align outline, settings and Quick Notes to semantic tokens

**Files:**
- Modify: `src/features/outline/outline.css`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/components/QuickNotesWorkspace.tsx`
- Modify: `src/styles/overlays.css`
- Modify: `src/styles/quick-notes.css`
- Create: `src/components/SettingsPanel.test.tsx` only if new search-setting UI is added

- [ ] Preserve existing outline trigger and Lake toolbar behavior; add only token-based hierarchy, compact width defaults, and explicit follow-scroll state styling.
- [ ] Add a settings search field/filter without changing settings persistence semantics.
- [ ] Make Quick Notes use shared semantic colors, motion and focus styles; keep its independent workspace identity and both primary actions.
- [ ] Run component tests, TypeScript, build, and real-window screenshots for outline/settings/Quick Notes.
- [ ] Commit: `refactor(ui): align outline settings and quick notes tokens`.

### Task 7: Performance and editor lifecycle audit

**Files:**
- Modify: `src/features/editor/MultiTabEditor.tsx` only where lifecycle evidence supports it
- Modify: `src/App.tsx` only where lifecycle ownership is required
- Create: `docs/PERFORMANCE-UI-AUDIT-2026-08-19.md`
- Create: temporary scripts under `/tmp`, not the repository

- [ ] Capture current DOM node count, heap, layout/recalc counts and tab/editor instance count in the real Electron window.
- [ ] Add a regression probe for background tabs; do not unload content until state restoration is tested.
- [ ] If safe, pause or dispose inactive Lake instances based on existing lifecycle APIs; otherwise document the evidence and leave behavior unchanged.
- [ ] Test large tree and multi-tab states without modifying user-visible titles or adding a Recent view.
- [ ] Record remaining risks with concrete evidence.
- [ ] Commit: `docs: record frontend performance and lifecycle audit`.

### Task 8: Final code/UI audit and verification

**Files:**
- Create: `docs/UI-CODE-AUDIT-2026-08-19.md`
- Create: `docs/QA-UI-2026-08-19.md`
- Modify: no production files unless verification finds a defect

- [ ] Run `npm test`, `npx tsc --noEmit`, `vite build`, and `git diff --check` from the feature worktree.
- [ ] Start Electron with Node 24 and CDP; capture light/dark 1280×820 screenshots.
- [ ] Verify `⌘K`, 1/2-character search, keyboard navigation, Enter/⌘Enter, body hit positioning, Quick Notes exclusion, sync popover states, conflict snapshot toast, outline dock/hover with physical mouse, settings filter, Focus Mode, and window restore.
- [ ] Check console errors, CSP violations, duplicate KaTeX injection, and Lake toolbar DOM/interaction invariance.
- [ ] Write findings grouped by P0–P3, evidence paths, remaining risks, and exact follow-up items.
- [ ] Commit: `docs: complete Lake Notes UI and code audit`.

## Verification gates

Do not claim completion until every acceptance criterion in `docs/superpowers/specs/2026-08-19-lake-notes-ui-system-design.md` has current evidence. The final report must distinguish implemented, verified, and intentionally unchanged behavior.

# Lake Notes Optimization Progress

## User decisions

- Top bar keeps `本地空间` and global sync state.
- Bottom status is current-document only: simple word/image counts and a compact status label.
- Conflict history is highlighted as `已同步 · 历史 N` after the remote version wins and the local version is saved to history.
- Lake native editor toolbar remains unchanged.

## Completed

1. UI shell / rail / outline hover and scrollbar safety.
2. Floating current-document status bar.
3. Authoritative sync pending summary.
4. Document-targeted conflict history notices.
5. Renderer crash draft journal and recovery dialog.
6. SQLite integrity check at startup.
7. Drawnix lazy JS loading.
8. Layout and motion contracts.

## In progress / next

1. Split global App concerns into domain hooks without behavior changes.
2. Complete IPC error codes and remove renderer string matching.
3. Add packaged Electron smoke test and resource timing budget.
4. Add sync fault injection / WAL checkpoint / large dataset benchmarks.
5. Finish CSS legacy override cleanup.
6. Verify Drawnix first-use import with a real board fixture.

## Additional completed work

- Current-document status bar now floats over the editor and only shows `字数 N / 图片 N` plus the document-level state.
- Pending sync counts are produced by main-process facts (documents, referenced resources, Quick Notes), not renderer arithmetic.
- Snapshot notices carry note IDs/titles and open the correct document history.
- Draft journal recovery is wired through atomic files and a restore/discard dialog.
- Startup SQLite integrity and foreign-key checks are recorded; WAL is checkpointed best-effort on quit.
- Drawnix board JS is lazy-loaded; ordinary text editor smoke reports no Drawnix/Plait JS resources.
- App-level shortcuts are centralized in `useWindowShortcuts`.
- Settings search jumps to a unique matching category.
- Search no longer advertises a fake second tab instance for `⌘Enter`; an already-open note is activated.
- Repeatable `npm run test:ui` smoke script covers baseline, `⌘K`, sync Popover, rail widths and Drawnix JS resource timing.

## Current batch additions

- SQLite startup integrity check and best-effort WAL checkpoint on quit.
- Stable IPC error codes are preserved through preload (`NOT_FOUND`, `INVALID_INPUT`, `INTERNAL`).
- Repeatable `npm run test:ui` smoke now verifies baseline shell, `⌘K` focus, sync Popover and absence of Drawnix/Plait JS resources in ordinary text-editor startup.
- `useWindowShortcuts` centralizes app-level capture-phase keyboard handling.
- Settings search jumps into a unique matching category.
- Search no longer exposes an unimplemented second-tab promise.
- Draft journal writes are debounced to avoid one IPC/file write per keystroke.

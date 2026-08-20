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

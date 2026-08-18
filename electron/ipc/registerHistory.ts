import type { Store } from "../store.js";
import type { IpcRegistrar } from "./registrar.js";

export function registerHistoryIpc(ipc: IpcRegistrar, store: Store, restartHistoryTimers: () => void): void {
  ipc.handle("create_history_snapshot", (noteId: string, content?: string, force?: boolean) => store.createHistorySnapshot(noteId, content, force));
  ipc.handle("list_note_history", (noteId: string) => store.listNoteHistory(noteId));
  ipc.handle("restore_history", (historyId: number) => store.restoreHistory(historyId));
  ipc.handle("delete_history", (historyId: number) => store.deleteHistory(historyId));
  ipc.handle("cleanup_history", () => store.cleanupHistory());
  ipc.handle("get_history_settings", () => store.getHistorySettings());
  ipc.handle("save_history_settings", (settings: unknown) => {
    store.saveHistorySettings(settings as Parameters<Store["saveHistorySettings"]>[0]);
    restartHistoryTimers();
  });
  ipc.handle("get_history_stats", () => store.getHistoryStats());
  ipc.handle("list_note_orphans", (noteId: string) => store.listNoteOrphans(noteId));
  ipc.handle("preview_history_snapshot", (historyId: number) => store.previewHistorySnapshot(historyId));
  ipc.handle("preview_note_orphan", (noteId: string, filename: string) => store.previewNoteOrphan(noteId, filename));
  ipc.handle("clean_note_orphans", (noteId: string, filenames?: string[]) => store.cleanNoteOrphans(noteId, filenames));
}

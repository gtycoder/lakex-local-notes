export type LocalSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type DocumentSyncKind = "local-only" | "pending" | "synced" | "synced-history" | "conflict";

export interface DocumentStatusInput {
  hasCloudConfig: boolean;
  syncState: "local" | "synced" | "conflict";
  saveState: LocalSaveState;
  historyCount?: number;
}

export interface DocumentStatusModel {
  kind: DocumentSyncKind | "saving" | "dirty" | "save-error";
  label: string;
  historyCount: number;
}

export function getDocumentStatus(input: DocumentStatusInput): DocumentStatusModel {
  const historyCount = Math.max(0, input.historyCount ?? 0);
  if (input.saveState === "saving") return { kind: "saving", label: "保存中", historyCount };
  if (input.saveState === "dirty") return { kind: "dirty", label: "待保存", historyCount };
  if (input.saveState === "error") return { kind: "save-error", label: "保存失败", historyCount };
  if (!input.hasCloudConfig) return { kind: "local-only", label: "仅本地", historyCount };
  if (input.syncState === "local") return { kind: "pending", label: "待同步", historyCount };
  if (input.syncState === "conflict") {
    if (historyCount > 0) return { kind: "synced-history", label: `已同步 · 历史 ${historyCount}`, historyCount };
    return { kind: "conflict", label: "有冲突", historyCount };
  }
  return { kind: historyCount > 0 ? "synced-history" : "synced", label: historyCount > 0 ? `已同步 · 历史 ${historyCount}` : "已同步", historyCount };
}

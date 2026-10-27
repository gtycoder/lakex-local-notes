import { describe, expect, it } from "vitest";
import { getDocumentStatus } from "./documentStatusModel";

describe("current document status", () => {
  const base = { hasCloudConfig: true, isDirty: false as const, saveState: "saved" as const };
  it("keeps the simple four document sync states", () => {
    expect(getDocumentStatus({ ...base, hasCloudConfig: false })).toMatchObject({ kind: "local-only", label: "仅本地" });
    expect(getDocumentStatus({ ...base, isDirty: true })).toMatchObject({ kind: "pending", label: "待同步" });
    expect(getDocumentStatus(base)).toMatchObject({ kind: "synced", label: "已同步" });
    expect(getDocumentStatus({ ...base, isConflict: true })).toMatchObject({ kind: "conflict", label: "有冲突" });
  });
  it("highlights a remote overwrite as synced history", () => {
    expect(getDocumentStatus({ ...base, historyCount: 1 })).toMatchObject({ kind: "synced-history", label: "已同步 · 历史 1" });
  });
  it("prioritizes local save safety over cloud state", () => {
    expect(getDocumentStatus({ ...base, saveState: "saving" })).toMatchObject({ kind: "saving", label: "保存中" });
    expect(getDocumentStatus({ ...base, saveState: "dirty" })).toMatchObject({ kind: "dirty", label: "待保存" });
    expect(getDocumentStatus({ ...base, saveState: "error" })).toMatchObject({ kind: "save-error", label: "保存失败" });
  });
});

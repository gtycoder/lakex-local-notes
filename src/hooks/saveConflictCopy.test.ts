import { describe, expect, it, vi } from "vitest";
import { CONFLICT_COPY_SUFFIX, conflictCopyTitle, createConflictCopy, type ConflictCopyPorts } from "./saveConflictCopy";
import type { NoteDocument } from "../lib/types";

const doc = (id: string, title: string): NoteDocument => ({ id, title, parentId: "nb1", sortOrder: 0, updatedAt: "2026-11-05T00:00:00.000Z", content: "", isConflict: false });

function ports(created: NoteDocument): ConflictCopyPorts & { saveNote: ReturnType<typeof vi.fn> } {
  return {
    createNote: vi.fn(async () => created),
    createUsheet: vi.fn(async () => created),
    createBitable: vi.fn(async () => created),
    createBoard: vi.fn(async () => created),
    createInk: vi.fn(async () => created),
    saveNote: vi.fn(async () => ({})),
  };
}

describe("保存冲突 → 另存为副本（Batch4-D）", () => {
  it("doc：按原父级建独立新文档并写入未保存正文（不是覆盖原文档）", async () => {
    const created = doc("copy-1", "计划" + CONFLICT_COPY_SUFFIX);
    const p = ports(created);
    const result = await createConflictCopy({ ports: p, kind: "doc", parentId: "nb1", title: "计划", content: "<p>本地未保存</p>" });
    expect(result.id).toBe("copy-1");
    expect(p.createNote).toHaveBeenCalledWith("nb1", "计划" + CONFLICT_COPY_SUFFIX);
    expect(p.saveNote).toHaveBeenCalledWith("copy-1", created.title, "<p>本地未保存</p>");
    // 其它 kind 的创建器不得被顺带调用
    expect(p.createUsheet).not.toHaveBeenCalled();
    expect(p.createBitable).not.toHaveBeenCalled();
  });

  it("kind 跟着原文档走：usheet/bitable/board/ink 用各自创建器（否则副本会被当 Lake 文档打开）", async () => {
    for (const [kind, creator] of [["usheet", "createUsheet"], ["bitable", "createBitable"], ["board", "createBoard"], ["ink", "createInk"]] as const) {
      const created = doc("copy-" + kind, "T" + CONFLICT_COPY_SUFFIX);
      const p = ports(created);
      await createConflictCopy({ ports: p, kind, parentId: null, title: "T", content: "{}" });
      expect(p[creator]).toHaveBeenCalledTimes(1);
      expect(p.createNote).not.toHaveBeenCalled();
      expect(p.saveNote).toHaveBeenCalledWith(created.id, created.title, "{}");
    }
  });

  it("标题：空标题兜底「无标题」；已带后缀不重复加", () => {
    expect(conflictCopyTitle("  ")).toBe("无标题" + CONFLICT_COPY_SUFFIX);
    expect(conflictCopyTitle("周报")).toBe("周报" + CONFLICT_COPY_SUFFIX);
    expect(conflictCopyTitle("周报" + CONFLICT_COPY_SUFFIX)).toBe("周报" + CONFLICT_COPY_SUFFIX);
  });

  it("创建失败向上抛（调用方负责提示；不能假装复制成功）", async () => {
    const p = ports(doc("x", "t"));
    p.saveNote = vi.fn(async () => { throw new Error("disk full"); });
    await expect(createConflictCopy({ ports: p, parentId: null, title: "T", content: "v" })).rejects.toThrow("disk full");
  });
});

import { describe, expect, it } from "vitest";
import { createNativeServices } from "./services";
import type { LakeNative } from "./native";

/** 伪 LakeNative：只实现测试用到的方法，断言适配器「字段映射」行为（V5 Phase 3 DTO 映射测试）。 */
function fakeNative(overrides: Partial<LakeNative> = {}): LakeNative {
  // Proxy 桩：未覆盖的方法调用即抛 unused（与原显式桩行为一致）；新增测试无需再补桩。
  const unused = () => { throw new Error("unused"); };
  return new Proxy({} as LakeNative, {
    get: (_target, prop) => {
      if (prop in overrides) return overrides[prop as keyof LakeNative];
      if (prop === "assetPort") return 19876;
      return unused;
    },
  });
}

describe("createNativeServices（DTO 字段映射）", () => {
  it("notes.createNote：parentId=null 走默认笔记本（createNote），否则 createNoteIn（父目录语义）", async () => {
    const calls: string[] = [];
    const api = fakeNative({
      createNote: async (title) => {
        calls.push(`createNote(${title})`);
        return { id: "n1", title, parentId: "notebook-default", sortOrder: 1, updatedAt: "t", syncState: "local", isConflict: false, content: "<p>x</p>" };
      },
      createNoteIn: async (parentId, title) => {
        calls.push(`createNoteIn(${parentId},${title})`);
        return { id: "n2", title, parentId, sortOrder: 2, updatedAt: "t", syncState: "local", isConflict: false, content: "<p>y</p>" };
      },
    });
    const { notes } = createNativeServices(api);
    const root = await notes.createNote(null, "根笔记");
    const child = await notes.createNote("group-1", "子笔记");
    expect(calls).toEqual(["createNote(根笔记)", "createNoteIn(group-1,子笔记)"]);
    expect(root).toMatchObject({ id: "n1", parentId: "notebook-default", content: "<p>x</p>" });
    expect(child).toMatchObject({ id: "n2", parentId: "group-1", syncState: "local", isLocked: false });
  });

  it("notes.saveNoteContent / renameNote 拆分映射", async () => {
    const api = fakeNative({
      saveNote: async (id, title, content) => ({ id, title, parentId: null, sortOrder: 0, updatedAt: "t2", syncState: "synced", isConflict: false, isLocked: true, content }),
      renameTreeNode: async (id, title) => ({ id, workspaceId: "w", parentId: null, nodeType: "note", title, noteFileId: id, sortOrder: 3, createdAt: "c", updatedAt: "t3", syncState: "local", isConflict: false }),
    });
    const { notes } = createNativeServices(api);
    const saved = await notes.saveNoteContent("n1", "新标题", "<p>正文</p>");
    expect(saved).toMatchObject({ title: "新标题", content: "<p>正文</p>", syncState: "synced", isLocked: true });
    const renamed = await notes.renameNote("n1", "改标题");
    expect(renamed).toMatchObject({ id: "n1", title: "改标题", nodeType: "note", noteFileId: "n1" });
  });

  it("assets.upload：参数顺序 noteId→filename→bytes，bytes 转 number[] 数组", async () => {
    const captured: Array<{ input: { bytes: number[]; filename: string }; noteId: string }> = [];
    const api = fakeNative({
      uploadResource: async (input, noteId) => {
        captured.push({ input, noteId });
        return { url: "http://127.0.0.1:19876/a/b.png", resourceRef: "url", filename: input.filename, mimeType: "image/png", size: input.bytes.length };
      },
    });
    const { assets } = createNativeServices(api);
    const output = await assets.upload("note-9", "pic.png", new Uint8Array([1, 2, 3, 4]));
    expect(captured).toEqual([{ input: { bytes: [1, 2, 3, 4], filename: "pic.png" }, noteId: "note-9" }]);
    expect(output).toMatchObject({ url: "http://127.0.0.1:19876/a/b.png", filename: "pic.png", mimeType: "image/png", size: 4 });
  });

  it("quickNotes.list：扁平化 content.text/images → DTO", async () => {
    const api = fakeNative({
      listQuickNotes: async () => [
        {
          id: "q1", createdAt: "c", updatedAt: "u", previewText: "", imageCount: 1, contentHash: "h".repeat(64),
          syncState: "synced", isConflict: false,
          content: { version: 1, text: "小记正文", images: [{ id: "img-1", filename: "a.png", mimeType: "image/png", width: 10, height: 20, size: 5, hash: "f".repeat(64) }] },
        },
      ],
    });
    const { quickNotes } = createNativeServices(api);
    const items = await quickNotes.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "q1", text: "小记正文", syncState: "synced", images: [{ id: "img-1", filename: "a.png", mimeType: "image/png", width: 10, height: 20, size: 5 }] });
  });

  it("quickNotes.create：staging 会话 draftId 透传（桌面 isSafeSegment 校验非空）", async () => {
    const captured: Array<{ input: { text: string; draftId: string; stagedImageIds: string[] }; id: string }> = [];
    const api = fakeNative({
      createQuickNote: async (input) => {
        captured.push({ input, id: "q-new" });
        return { id: "q-new", createdAt: "c", updatedAt: "u", previewText: "", imageCount: 0, contentHash: "h".repeat(64), syncState: "local", isConflict: false, content: { version: 1, text: input.text, images: [] } };
      },
      updateQuickNote: async (id, input) => {
        captured.push({ input, id });
        return { id, createdAt: "c", updatedAt: "u", previewText: "", imageCount: 0, contentHash: "h".repeat(64), syncState: "local", isConflict: false, content: { version: 1, text: input.text, images: [] } };
      },
    });
    const { quickNotes } = createNativeServices(api);
    await quickNotes.create({ text: "新小记", stagedImageIds: ["img-9"], draftId: "draft-session-1" });
    await quickNotes.update("q1", { text: "改小记", stagedImageIds: [], retainedImageIds: ["img-1"], draftId: "draft-session-2" });
    expect(captured).toEqual([
      { input: { text: "新小记", draftId: "draft-session-1", stagedImageIds: ["img-9"] }, id: "q-new" },
      { input: { text: "改小记", draftId: "draft-session-2", stagedImageIds: [], retainedImageIds: ["img-1"] }, id: "q1" },
    ]);
  });

  it("trash.list / sync.onProgress：映射与订阅透传", async () => {
    const api = fakeNative({
      listTrash: async () => [{ id: "t1", title: "旧笔记", nodeType: "note", noteFileId: "n1", parentId: null, deletedAt: "d", updatedAt: "u", hasFile: true, purged: false }],
      onSyncProgress: (callback) => {
        callback({ phase: "upload", message: "上传中", current: 1, total: 2 });
        return () => undefined;
      },
    });
    const services = createNativeServices(api);
    const trash = await services.trash.list();
    expect(trash).toEqual([{ id: "t1", title: "旧笔记", deletedAt: "d" }]);
    const phases: string[] = [];
    const unsubscribe = services.sync.onProgress((phase, message) => { phases.push(`${phase}:${message}`); });
    expect(phases).toEqual(["upload:上传中"]);
    expect(typeof unsubscribe).toBe("function");
  });
});

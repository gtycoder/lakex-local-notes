import { describe, expect, it } from "vitest";
import { mapQuickNoteDeletedRow, mapQuickNoteRow, mapTrashRow } from "./quickNoteQueries.js";
import type { StoredQuickNoteContent } from "./quickNoteModel.js";

describe("quickNoteQueries 共享映射（Phase 0B-4）", () => {
  const row = {
    id: "qn1", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z",
    preview_text: "预览", image_count: 1, content_hash: "abc", sync_state: "local" as const, is_conflict: 0,
  };
  const content: StoredQuickNoteContent = { version: 3, text: "正文", body: "<p><br></p>", images: [{ id: "img1", filename: "a.png", mimeType: "image/png", hash: "h", width: null, height: null, size: 10 }] };
  const tagIds = ["t_0123456789abcdef"];
  const tagNames = (ids: readonly string[]) => ids.map((id) => (id === "t_0123456789abcdef" ? "灵感" : ""));

  it("mapQuickNoteRow：行→文档（含图片 URL 注入）", () => {
    const doc = mapQuickNoteRow(row, { content, tagIds, imageUrl: (id, f) => "http://x/" + id + "/" + f, tagNames });
    expect(doc.id).toBe("qn1");
    expect(doc.previewText).toBe("预览");
    expect(doc.syncState).toBe("local");
    expect(doc.content.images[0].url).toBe("http://x/qn1/a.png");
    expect(doc.content.tagIds).toEqual(["t_0123456789abcdef"]);
    expect(doc.content.tags).toEqual(["灵感"]);
  });

  it("mapQuickNoteRow：isConflict 布尔化", () => {
    const doc = mapQuickNoteRow({ ...row, is_conflict: 1 }, { content, tagIds, imageUrl: () => "", tagNames });
    expect(doc.isConflict).toBe(true);
  });

  it("mapQuickNoteDeletedRow：行→已删记录", () => {
    const rec = mapQuickNoteDeletedRow({ id: "q", created_at: "c", updated_at: "u", deleted_at: "d", conversion_target_note_id: null, ready_to_sync: 1 });
    expect(rec.deletedAt).toBe("d");
    expect(rec.readyToSync).toBe(true);
    expect(rec.conversionTargetNoteId).toBeNull();
  });

  it("mapTrashRow：回收站行映射", () => {
    expect(mapTrashRow({ id: "q", created_at: "c", updated_at: "u", deleted_at: "d" })).toEqual({ id: "q", createdAt: "c", updatedAt: "u", deletedAt: "d" });
  });
});

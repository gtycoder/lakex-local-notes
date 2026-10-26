/**
 * 小记 S3 key 布局的**格式钉死**测试（B1，261016）。
 *
 * 分工：`quickNoteKeys.ts` 负责「只定义一次」，本测试负责「格式没被悄悄改」——
 * 因此这里**故意写死字面量**，而不是复用被测函数的输出（那会变成自证循环）。
 * 旧 legacy 同步通道（quickNotePush/quickNotesSyncEngine）已删除；v3 的 key 布局在 core/s3v3Keys.ts。
 */
import { describe, expect, it } from "vitest";
import {
  QUICK_NOTES_ROOT,
  QUICK_NOTE_OBJECT_EXT,
  quickNoteAssetKeyRel,
  quickNoteAssetsPrefixRel,
  quickNoteKeys,
  quickNoteManifestKeyRel,
  quickNoteObjectKeyRel,
  quickNoteObjectsPrefixRel,
} from "./quickNoteKeys.js";

describe("小记 key 布局（单一来源 + 格式钉死）", () => {
  it("根前缀与对象扩展名是契约字面量", () => {
    expect(QUICK_NOTES_ROOT).toBe("quick-notes");
    expect(QUICK_NOTE_OBJECT_EXT).toBe("qnote");
  });

  it("相对 key 的布线格式（写死字面量，独立于实现）", () => {
    expect(quickNoteManifestKeyRel()).toBe("quick-notes/manifests/latest.json");
    expect(quickNoteObjectKeyRel("abc123")).toBe("quick-notes/objects/abc123.qnote");
    expect(quickNoteAssetKeyRel("note-a", "a.png")).toBe("quick-notes/assets/note-a/a.png");
    expect(quickNoteObjectsPrefixRel()).toBe("quick-notes/objects/");
    expect(quickNoteAssetsPrefixRel()).toBe("quick-notes/assets/");
  });

  it("带前缀的 key 组 = prefix + 相对布局（单条推送与整轮同步必须同构）", () => {
    const keys = quickNoteKeys("local-lakex-notes");
    expect(keys.manifestKey).toBe("local-lakex-notes/quick-notes/manifests/latest.json");
    expect(keys.objectKey("abc123")).toBe("local-lakex-notes/quick-notes/objects/abc123.qnote");
    expect(keys.assetKey("note-a", "a.png")).toBe("local-lakex-notes/quick-notes/assets/note-a/a.png");
    // 关键不变量：剥掉同步前缀后，必须与相对 key 逐字相同（两条路径永远指向同一批对象）
    const prefix = "local-lakex-notes/";
    expect(keys.manifestKey.slice(prefix.length)).toBe(quickNoteManifestKeyRel());
    expect(keys.objectKey("abc123").slice(prefix.length)).toBe(quickNoteObjectKeyRel("abc123"));
    expect(keys.assetKey("note-a", "a.png").slice(prefix.length)).toBe(quickNoteAssetKeyRel("note-a", "a.png"));
  });

});

/**
 * 小记 S3 key 布局的**格式钉死**测试（B1，261016）。
 *
 * 分工：`quickNoteKeys.ts` 负责「只定义一次」，本测试负责「格式没被悄悄改」——
 * 因此这里**故意写死字面量**，而不是复用被测函数的输出（那会变成自证循环）。
 * 另加源码级护栏：三个生产调用点不得再自行拼 key，否则单一来源立刻失效。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

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

  it("三个生产调用点都从单一来源取 key，且不得再自行拼（源码级护栏）", () => {
    const push = read("core/quickNotePush.ts");
    const engine = read("core/quickNotesSyncEngine.ts");
    const desktop = read("../electron/quickNotesSync.ts");
    const coreSources: Array<[string, string]> = [
      ["quickNotePush", push],
      ["quickNotesSyncEngine", engine],
    ];
    for (const [name, src] of coreSources) {
      expect(src.includes('from "./quickNoteKeys.js"'), name + " 必须 import 单一来源").toBe(true);
      // 旧写法：内联模板 `${cfg.prefix}/${ROOT}/objects|assets|manifests/...`
      expect(src.includes("`${cfg.prefix}/${ROOT}"), name + " 不得再内联拼 key").toBe(false);
    }
    expect(desktop.includes('from "../src/core/quickNoteKeys.js"'), "桌面 quickNotesSync 必须 import 单一来源").toBe(true);
    const forbidden = ["`${ROOT}/objects/", "`${ROOT}/assets/", "`${ROOT}/manifests/", '= "quick-notes"'];
    for (const bad of forbidden) {
      expect(desktop.includes(bad), "桌面 quickNotesSync 不得再出现：" + bad).toBe(false);
    }
  });
});

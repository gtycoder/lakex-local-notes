import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

describe("桌面适配器 hash 缓存（增量同步正确性/性能）", () => {
  it("第二次 loadState 复用缓存；直接改文件后能重新识别", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-hashcache-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    for (let i = 0; i < 500; i++) store.createNoteInAtTopWithContent(nb.id, "D" + i, "<p>v1-" + i + "-" + "x".repeat(200) + "</p>", [], "h" + i);
    const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await device.init();
    const t1 = Date.now();
    const s1 = (await device.loadState())!;
    const t1ms = Date.now() - t1;
    const t2 = Date.now();
    const s2 = (await device.loadState())!;
    const t2ms = Date.now() - t2;
    const h0 = s1.lake.notes.find((n) => n.id === "h0")!.contentHash;
    expect(s2.lake.notes.find((n) => n.id === "h0")!.contentHash).toBe(h0);
    console.log("HASHCACHE first=" + t1ms + "ms second=" + t2ms + "ms");
    // 模拟外部直接写正文（不经过 Store.saveNote）：mtime/size 变化 → 必须识别新 hash
    const p = store.getNotePaths("h0").lakePath;
    await fs.writeFile(p, "<p>externally-edited-" + "y".repeat(300) + "</p>");
    const s3 = (await device.loadState())!;
    const h0b = s3.lake.notes.find((n) => n.id === "h0")!.contentHash;
    expect(h0b).not.toBe(h0);
  }, 60_000);
});

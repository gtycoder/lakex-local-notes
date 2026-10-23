/**
 * I2（下载方向）跨端对拍：**本轮被本机编辑过的笔记，不得被远端版本静默覆盖**。
 *
 * 背景：拆开写域/维护域之后，同步的 DB 落地与用户写可以并发（对齐桌面既有语义）。
 * 若用户在某篇文档的"读 → 落地"窗口内编辑了它，直接应用远端版本会丢掉用户刚写的正文。
 * 两端各自的守卫：
 *   · 移动端 `src/mobile/data/syncDbPort.ts` 的 `flushNoteBatch`（批窗口内 hash 变了 ⇒ 推迟该条）；
 *   · 桌面 `electron/syncAdapters.ts` 的 `beginNoteBatch` 快照 + `applyRemoteNote`（逐条"未变才应用"）。
 * 本文件卡住桌面侧；移动侧由 src/mobile/data/syncDbPortBatchGuard.test.ts 卡住。**两端语义必须一致**。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "./store.js";
import { createStoreSyncPort } from "./syncAdapters.js";

const mkNote = (note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; contentHash: string }) => ({
  ...note, deleted: false, isConflict: false, isEditLocked: false, editLockedAt: null, icon: null,
  trashedAt: null, deletedFromParentId: null, kind: "doc", assets: [],
});

describe("I2（下载方向）：本轮被本机编辑过的笔记不被远端静默覆盖", () => {
  it("窗口内编辑过 ⇒ applyRemoteNote 推迟，本机正文原样保留", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lake-apply-guard-"));
    try {
      const store = new Store(root);
      const note = store.createNote("窗口测试");
      store.saveNote(note.id, "窗口测试", "<p>本机旧内容</p>");
      const port = createStoreSyncPort(store);

      await port.beginNoteBatch!();
      // 模拟"同步读到轮初状态之后、应用远端之前"用户又编辑了一次
      store.saveNote(note.id, "窗口测试", "<p>本机新内容（窗口内写的）</p>");

      const row = store.getNoteForSync(note.id)!;
      await port.applyRemoteNote!(
        mkNote({ id: note.id, title: "远端标题", parentId: row.parentId ?? null, sortOrder: row.sortOrder, updatedAt: "2030-01-01T00:00:00.000Z", contentHash: "remote-hash" }) as never,
        "<p>远端内容（不该落地）</p>",
      );

      // 本机正文必须还在（未被远端覆盖）
      expect(store.readNote(note.id).content).toContain("本机新内容");
      await port.flushNoteBatch!();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("窗口内没被动过 ⇒ 正常应用远端版本（守卫不误伤）", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lake-apply-guard-ok-"));
    try {
      const store = new Store(root);
      const note = store.createNote("窗口测试2");
      store.saveNote(note.id, "窗口测试2", "<p>本机旧内容</p>");
      const port = createStoreSyncPort(store);

      await port.beginNoteBatch!();
      const row = store.getNoteForSync(note.id)!;
      await port.applyRemoteNote!(
        mkNote({ id: note.id, title: "远端标题", parentId: row.parentId ?? null, sortOrder: row.sortOrder, updatedAt: "2030-01-01T00:00:00.000Z", contentHash: "remote-hash" }) as never,
        "<p>远端内容（应落地）</p>",
      );

      expect(store.readNote(note.id).content).toContain("远端内容");
      await port.flushNoteBatch!();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

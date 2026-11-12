import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { MemoryRemote } from "./deviceConformance.js";
import { S3V3_POINTER_KEY, indexKey } from "../../src/core/s3v3/protocol/s3v3Keys.js";
import { parseLakeIndexBytes, type LakeIndex } from "../../src/core/s3v3/protocol/s3v3Index.js";

/**
 * task-47：**编辑锁字段独立合并与发布**（L1–L5）。
 *
 * 语义（用户裁决，别另造）：
 *  - 锁 = 本机只读保护标记，**不是**分布式租约、**不是**合并屏障：他端已发布的正文必须正常应用，A 的锁保留；
 *  - 锁字段（isLocked/lockedAt）不 bump updatedAt ⇒ 必须按 lockedAt 做**独立 LWW**，与内容判定解耦；
 *    本地锁更新时**必须发布**（哪怕本轮内容判定是 download），否则「他端持续编辑期间锁永远发不出去」；
 *  - 远端锁更新 ⇒ 应用远端锁（applyRemoteEditLock / apply-lock）；
 *  - 同版本（都空/相等）不动，避免两端互刷。
 */
async function mkDevice() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-lock-"));
  const store = new Store(root);
  store.bootstrap();
  const device = new DesktopStoreDevice(store, root);
  await device.init();
  return { root, store, device };
}
async function readCloudIndex(remote: MemoryRemote): Promise<LakeIndex> {
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) throw new Error("缺少 v3 pointer");
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as { lake: { commit: string } };
  const indexBytes = await remote.get(indexKey("lake", pointer.lake.commit));
  if (!indexBytes) throw new Error("缺少 lake 索引");
  return parseLakeIndexBytes(indexBytes).index;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const engineFor = (device: DesktopStoreDevice, deviceId: string, remote: MemoryRemote) =>
  new S3v3SyncEngine({ remote, device, deviceId });

describe("task-47：编辑锁字段独立合并与发布（L1–L5）", () => {
  it("L1：A 加锁（已同步）→ B 编辑正文并同步 → A 应用正文且仍锁 → 锁再传播给 B（双向都不丢）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("L1");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "L1");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();

      a.store.setNoteEditLocked("L1", true);
      await engineFor(a.device, "A", remote).sync();
      expect((await readCloudIndex(remote)).notes.find((n) => n.id === "L1")!.isLocked).toBe(true);
      await engineFor(b.device, "B", remote).sync();
      expect(b.store.readNote("L1").isEditLocked).toBe(true);

      // B 改正文（数据层直写：锁只影响 UI 只读入口，不是合并屏障）
      await sleep(5);
      b.store.saveNote("L1", "Doc", "<p>B-edit</p>");
      await engineFor(b.device, "B", remote).sync();
      // A：正文=B、仍锁、无异常
      await engineFor(a.device, "A", remote).sync();
      expect(a.store.readNote("L1").content).toBe("<p>B-edit</p>");
      expect(a.store.readNote("L1").isEditLocked).toBe(true);
      // 锁继续传播：B 再同步后只读，且正文仍是自己的
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(b.store.readNote("L1").isEditLocked).toBe(true);
      expect(b.store.readNote("L1").content).toBe("<p>B-edit</p>");
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("L2（缺口回归）：B 连续两轮编辑正文时，A 的锁仍能发布并被 B 看到", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("L2");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v0</p>", [], "L2");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      a.store.setNoteEditLocked("L2", true);
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(b.store.readNote("L2").isEditLocked).toBe(true);

      for (const v of [1, 2]) {
        await sleep(5);
        // B 每轮都改正文并同步（内容 win 者是远端 ⇒ 旧实现不会发布 A 的锁）
        b.store.saveNote("L2", "Doc", "<p>B-v" + v + "</p>");
        await engineFor(b.device, "B", remote).sync();
        await engineFor(a.device, "A", remote).sync();
        expect(a.store.readNote("L2").content).toBe("<p>B-v" + v + "</p>");
        expect(a.store.readNote("L2").isEditLocked).toBe(true);
        // 关键：云端索引里的锁仍是 true（锁没被内容下载轮抹掉/漏发）
        expect((await readCloudIndex(remote)).notes.find((n) => n.id === "L2")!.isLocked).toBe(true);
        await engineFor(b.device, "B", remote).sync();
        expect(b.store.readNote("L2").isEditLocked).toBe(true);
        expect(b.store.readNote("L2").content).toBe("<p>B-v" + v + "</p>");
      }
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("L3：解锁传播（A 解锁 → B 可编辑），与 B 编辑并发时按 lockedAt LWW 且不抖动", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("L3");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v0</p>", [], "L3");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      a.store.setNoteEditLocked("L3", true);
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(b.store.readNote("L3").isEditLocked).toBe(true);

      // B 编辑 + A 解锁并发：两者都改变，锁按 lockedAt LWW（A 解锁时间更晚 ⇒ 解锁赢）
      await sleep(5);
      b.store.saveNote("L3", "Doc", "<p>B-edit</p>");
      await engineFor(b.device, "B", remote).sync();
      await sleep(5);
      a.store.setNoteEditLocked("L3", false);
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(a.store.readNote("L3").isEditLocked).toBe(false);
      expect(b.store.readNote("L3").isEditLocked).toBe(false);
      expect((await readCloudIndex(remote)).notes.find((n) => n.id === "L3")!.isLocked).toBe(false);
      // 不抖动：再跑一轮世界不变
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(a.store.readNote("L3").isEditLocked).toBe(false);
      expect(b.store.readNote("L3").isEditLocked).toBe(false);
      expect(b.store.readNote("L3").content).toBe("<p>B-edit</p>");
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("L4：锁不阻断同步 apply 写正文；本机保存被拒是 UI 只读态职责（不在共用写函数里）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("L4");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v0</p>", [], "L4");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      a.store.setNoteEditLocked("L4", true);
      await engineFor(a.device, "A", remote).sync();

      // 数据层：锁着的行仍可被普通保存写（锁策略不下沉到共用写函数——见 noteContentRepository 无锁守卫）
      expect(() => a.store.saveNote("L4", "Doc", "<p>data-layer-write</p>")).not.toThrow();
      expect(a.store.readNote("L4").content).toBe("<p>data-layer-write</p>");
      // 同步 apply 也不得因锁拒写：B 的正文必须落到锁着的 A 上
      await sleep(5);
      b.store.saveNote("L4", "Doc", "<p>B-edit</p>");
      await engineFor(b.device, "B", remote).sync();
      await engineFor(a.device, "A", remote).sync();
      expect(a.store.readNote("L4").content).toBe("<p>B-edit</p>");
      expect(a.store.readNote("L4").isEditLocked).toBe(true);
    } finally { a.store.close(); b.store.close(); }
    // UI 只读态是拒绝本机编辑的唯一闸门：锁定集合 → EditorTab/MultiTabEditor 的 readOnly、且 locked 时保存直接 return。
    const fsMod = await import("node:fs");
    const read = (rel: string) => fsMod.readFileSync(new URL(rel, import.meta.url), "utf8");
    const multi = read("../../src/features/editor/MultiTabEditor.tsx");
    expect(multi).toMatch(/readOnly=\{\(lockedNoteIds\?\.has\(tab\.noteId\)/);
    const tab = read("../../src/features/editor/EditorTab.tsx");
    expect(tab).toMatch(/const mode: "editor" \| "viewer" = locked \? "viewer" : "editor";/);
    expect(tab).toMatch(/if \(locked\) return;/);
    const app = read("../../src/App.tsx");
    expect(app).toMatch(/locked=\{activeNoteId !== null && lockedNoteIds\.has\(activeNoteId\)\}/);
  }, 180_000);

  it("L5：锁 × 移入回收站/恢复 —— 不炸，正文与锁状态按各自 LWW 收敛", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("L5");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v0</p>", [], "L5");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      a.store.setNoteEditLocked("L5", true);
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();

      // A 锁着时移入回收站并同步；B 跟随（不炸）
      a.store.deleteNote("L5");
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(a.store.listTrash().some((t) => t.id === "L5")).toBe(true);
      expect(b.store.listTrash().some((t) => t.id === "L5")).toBe(true);
      // 回收站里正文仍在（软删语义），且锁字段未把同步搞崩
      expect(a.store.readNote("L5").content).toBe("<p>v0</p>");
      // B 恢复（显式恢复 = 唯一例外）→ 传播回 A
      b.store.restoreTrashItem("L5");
      await engineFor(b.device, "B", remote).sync();
      await engineFor(a.device, "A", remote).sync();
      expect(a.store.listTreeNodes().some((n) => n.id === "L5" && n.nodeType === "note")).toBe(true);
      expect(a.store.readNote("L5").content).toBe("<p>v0</p>");
      // 锁状态稳定（A 的锁定时间更晚 ⇒ 仍是锁定），不抖动
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      expect(b.store.readNote("L5").isEditLocked).toBe(a.store.readNote("L5").isEditLocked);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);
});

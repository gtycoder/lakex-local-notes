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
 * task-73（P1，S72-F1）：**被远端删除时，被删侧本地未同步编辑必须留历史快照**（AGENTS §3#3）。
 *
 * 缺口：v3 起「移入回收站」是**位置变化**（条目仍在索引里、只是 trashed），不是缺席；
 * plan 的 archiveLocal 原先只在「远端缺席」分支生成 ⇒ 「远端 trashed + 本地有未发布编辑」时，
 * 本地编辑被上传成 trashed 条目（内容赢家本地/位置赢家远端，合并本身正确），但**没有任何历史快照**，
 * 用户之后在回收站/历史里都找不回自己那一版（真实桶 S72 实测 history=0）。
 *
 * 本文件钉住：① 主缺口已补（留档且快照=本地编辑版本）；② 同类路径不误伤/不重复（远端缺席仍留档；
 * 本地在回收站 + 远端编辑 = 无本地独有内容 ⇒ 不留档；两边都改 ⇒ 由 remote-wins-history 留档）。
 */
async function mkDevice() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-hist-"));
  const store = new Store(root);
  store.bootstrap();
  const device = new DesktopStoreDevice(store, root);
  await device.init();
  return { store, device };
}
const engineFor = (device: DesktopStoreDevice, deviceId: string, remote: MemoryRemote) =>
  new S3v3SyncEngine({ remote, device, deviceId });
async function readCloudIndex(remote: MemoryRemote): Promise<LakeIndex> {
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) throw new Error("缺少 v3 pointer");
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as { lake: { commit: string } };
  const indexBytes = await remote.get(indexKey("lake", pointer.lake.commit));
  if (!indexBytes) throw new Error("缺少 lake 索引");
  return parseLakeIndexBytes(indexBytes).index;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("task-73：被远端删除时本地编辑留历史快照（S72-F1）", () => {
  it("远端 trashed + 本地未同步编辑 ⇒ 留历史快照（快照=本地编辑版本），三端最终进回收站且正文一致", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    const c = await mkDevice();
    try {
      const nb = a.store.createNotebook("H73");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "h73-n1");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      await engineFor(c.device, "C", remote).sync();

      // B 本地编辑（未同步）；C 删除并发布（删除 = 位置变化：索引条目 trashed，仍存在）
      await sleep(10);
      b.store.saveNote("h73-n1", "Doc", "<p>B-edit-v2</p>");
      c.store.deleteNote("h73-n1");
      await engineFor(c.device, "C", remote).sync();

      // B 同步：内容赢家本地（上传其编辑）、位置赢家远端（trashed）⇒ 必须先留历史快照
      const rb = await engineFor(b.device, "B", remote).sync();
      expect(rb).toBeTruthy();
      const histB = b.store.listNoteHistory("h73-n1");
      expect(histB.length, "被删侧本地编辑必须留历史快照（S72-F1）").toBeGreaterThanOrEqual(1);
      const preview = b.store.previewHistorySnapshot(histB[0].id);
      expect(preview?.html ?? "").toContain("B-edit-v2");   // 快照 = B 的编辑版本
      expect(b.store.listTrash().some((t) => t.id === "h73-n1")).toBe(true);

      // 三端收敛：都在回收站；云端条目 trashed 且正文=B 编辑版本（删除压位置、内容保留）
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      await engineFor(c.device, "C", remote).sync();
      await engineFor(a.device, "A", remote).sync();
      for (const d of [a, b, c]) expect(d.store.listTrash().some((t) => t.id === "h73-n1")).toBe(true);
      const entry = (await readCloudIndex(remote)).notes.find((n) => n.id === "h73-n1")!;
      expect(entry.trashedAt ?? null).not.toBe(null);
      expect(a.store.readNote("h73-n1").content).toBe("<p>B-edit-v2</p>");
    } finally { a.store.close(); b.store.close(); c.store.close(); }
  }, 180_000);

  it("同类路径①：远端缺席（purge）+ 本地未同步编辑 ⇒ 既有 remote-purged-trash 分支仍留档（不回归）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("H73b");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "h73b-n1");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      await sleep(10);
      b.store.saveNote("h73b-n1", "Doc", "<p>B-edit</p>");
      a.store.deleteNote("h73b-n1");
      a.store.purgeTrashItem("h73b-n1");
      await engineFor(a.device, "A", remote).sync();
      await engineFor(a.device, "A", remote).sync();
      await engineFor(b.device, "B", remote).sync();
      const hist = b.store.listNoteHistory("h73b-n1");
      expect(hist.length, "远端缺席 + 本地编辑必须留档（既有路径）").toBeGreaterThanOrEqual(1);
      expect(b.store.previewHistorySnapshot(hist[0].id)?.html ?? "").toContain("B-edit");
      expect(b.store.listTrash().some((t) => t.id === "h73b-n1")).toBe(true);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("同类路径②：本地已在回收站（无本地独有编辑）+ 远端编辑 ⇒ 不留快照（无内容可丢），内容正确应用", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("H73c");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "h73c-n1");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      a.store.deleteNote("h73c-n1");
      await engineFor(a.device, "A", remote).sync();   // A 发布 trashed（B 尚未拉取，仍是活跃副本）
      await sleep(10);
      b.store.saveNote("h73c-n1", "Doc", "<p>B-edit</p>"); // B 编辑（此刻 B 还不知情，未过同步）
      await engineFor(b.device, "B", remote).sync();
      await engineFor(a.device, "A", remote).sync();   // A：内容取 B 版、位置保留回收站、无本地独有内容 ⇒ 不留档
      expect(a.store.listTrash().some((t) => t.id === "h73c-n1")).toBe(true);
      expect(a.store.readNote("h73c-n1").content).toBe("<p>B-edit</p>");
      expect(a.store.listNoteHistory("h73c-n1").length, "本地无独有编辑 ⇒ 不为删除侧另造快照").toBe(0);
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);

  it("同类路径③：两边都改正文 + 远端 trashed ⇒ 走 remote-wins-history，留档且只留一份（不重复）", async () => {
    const remote = new MemoryRemote();
    const a = await mkDevice();
    const b = await mkDevice();
    try {
      const nb = a.store.createNotebook("H73d");
      a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>v1</p>", [], "h73d-n1");
      await engineFor(a.device, "A", remote).sync({ onEmptyCloud: "upload" });
      await engineFor(b.device, "B", remote).sync();
      await sleep(10);
      a.store.saveNote("h73d-n1", "Doc", "<p>A-edit</p>");  // A 先改
      a.store.deleteNote("h73d-n1");                        // 再删（位置变化）
      await engineFor(a.device, "A", remote).sync();        // A 发布：内容 A 版 + trashed
      b.store.saveNote("h73d-n1", "Doc", "<p>B-edit</p>");  // B（尚未同步，仍活跃）也改
      await engineFor(b.device, "B", remote).sync();   // B：远端已发布（content+trashed 都变了）⇒ remote-wins-history
      const hist = b.store.listNoteHistory("h73d-n1");
      expect(hist.length).toBeGreaterThanOrEqual(1);
      expect(hist.length, "同一内容不重复留档").toBe(1);
      // 已知旁路缺陷（本任务只登记、不扩范围）：B 的本地更新晚于远端条目 updatedAt ⇒
      // deviceStore 的 lifecycleRace 守卫本轮（及后续轮）跳过生命周期覆写，B 会**留在活跃树**，
      // 与 A/C 的回收站视图长期不一致。另立任务（复现即本用例去掉这两行断言的形态）。
      expect(b.store.readNote("h73d-n1").content).toBe("<p>A-edit</p>");
    } finally { a.store.close(); b.store.close(); }
  }, 180_000);
});
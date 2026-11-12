import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../store.js";
import { syncWithV3 } from "./desktopSync.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

/**
 * task-66 P0 回归：**单篇 apply 失败必须降级**（不把整轮 syncNow 抛成失败），
 * 且必须留下可定位的 truthful warning（kind=apply_skipped，不是 remote_incomplete），
 * 下一轮重试能真正把该篇落库。
 *
 * 注入点：平台端口把远端落本地走 `store.importRemoteNote`；这里让 n1 首次调用抛错一次，
 * 其它文档必须照常应用（同一轮继续），下一轮不再抛 ⇒ n1 应用成功。
 */
class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

async function desktopStore(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-applywarn-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  return { root, store };
}

describe("单篇 apply 失败降级（task-66）", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("一篇 apply 失败 ⇒ 整轮成功 + 其它篇照常 + warnings 含 apply_skipped；下一轮重试成功", async () => {
    process.env.LAKE_S3V3_EMPTY_CLOUD = "upload";
    // A：两篇文档上传到同一 remote
    const a = await desktopStore("a");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "body-1", [], "n1");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc2", "body-2", [], "n2");
    const remote = new MemoryRemote();
    await syncWithV3(a.store, undefined, { remote, deviceId: "A" });

    // B：空库拉取；注入 n1 的首次「远端→本地」写入失败
    const b = await desktopStore("b");
    const original = Store.prototype.importRemoteNote;
    let injected = false;
    vi.spyOn(Store.prototype, "importRemoteNote").mockImplementation(function (
      this: Store,
      note: Parameters<Store["importRemoteNote"]>[0],
      content: Parameters<Store["importRemoteNote"]>[1],
      assets: Parameters<Store["importRemoteNote"]>[2],
    ) {
      const noteId = (note as unknown as { id: string }).id;
      if (!injected && noteId === "n1") {
        injected = true;
        throw new Error("injected apply failure: n1");
      }
      return original.call(this, note, content, assets);
    });

    // ① 整轮不抛错（降级，而不是把 syncNow 变成失败）
    const round1 = await syncWithV3(b.store, undefined, { remote, deviceId: "B" });

    // ② warning truth：kind=apply_skipped（不是 remote_incomplete），且能定位到该篇
    const applyWarning = round1.warnings?.find((w) => w.noteId === "n1");
    expect(applyWarning, "n1 必须出现在 warnings 里").toBeTruthy();
    expect(applyWarning!.kind).toBe("apply_skipped");
    expect(round1.warnings?.some((w) => w.noteId === "n1" && w.kind === "remote_incomplete")).toBe(false);
    expect(applyWarning!.title).toBe("Doc1");
    expect(applyWarning!.message).toContain("已跳过");

    // ③ 其它篇照常应用；失败那篇本轮未落地（不伪造成功）
    expect(b.store.hasNote("n2")).toBe(true);
    expect(b.store.readNote("n2").content).toBe("body-2");
    expect(b.store.hasNote("n1")).toBe(false);

    // ④ 诊断报告逐项可定位（设置页「同步诊断」的 failed 清单含该篇）
    const reports = b.store.listV3SyncReports();
    const latest = reports[reports.length - 1];
    expect(latest?.ok).toBe(true);
    expect(latest?.failed.some((f) => f.kind === "apply_skipped" && f.id === "n1" && f.title === "Doc1")).toBe(true);
    expect(latest!.warningCount).toBeGreaterThanOrEqual(1);
    expect(latest!.warnings.some((text) => text.includes("已跳过"))).toBe(true);

    // ⑤ 下一轮（不再注入）⇒ 重试成功
    const round2 = await syncWithV3(b.store, undefined, { remote, deviceId: "B" });
    expect(round2.warnings?.some((w) => w.kind === "apply_skipped") ?? false).toBe(false);
    expect(b.store.hasNote("n1")).toBe(true);
    expect(b.store.readNote("n1").content).toBe("body-1");
  }, 60_000);
});

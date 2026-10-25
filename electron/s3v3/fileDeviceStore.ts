import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { LakeIndex, QuickNotesIndex } from "../../src/core/s3v3Index.js";
import type { DeletionIntent } from "../../src/core/s3v3Intent.js";
import type { PendingDelete } from "../../src/core/s3v3Gate.js";

/** S3 v3 设备本地模型（Node 文件系统实现；生产接入时映射到现有 store，测试可直接用）。 */

export interface DeviceState {
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
  folders: LakeIndex["folders"];
  intents: DeletionIntent[];
  pending: PendingDelete[];
  /** 远端已彻底删除、本地保留的回收站副本（不参与同步上传）。 */
  remotePurged?: string[];
  /** 本地显式恢复标记（唯一提前例外）。 */
  restorePending?: string[];
  /** 全量重拉/重置时归档的本地条目（不参与同步）。 */
  archived?: Array<{ id: string; kind: "lake" | "quickNote"; title?: string }>;
}

export interface DeviceBaseline {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
}

export class FileDeviceStore {
  constructor(readonly root: string) {}

  private p(...parts: string[]): string { return path.join(this.root, ...parts); }

  async init(): Promise<void> {
    await fs.mkdir(this.p("bodies"), { recursive: true });
    await fs.mkdir(this.p("assets"), { recursive: true });
    await fs.mkdir(this.p("history"), { recursive: true });
    await fs.mkdir(this.p("archive"), { recursive: true });
  }

  async loadState(): Promise<DeviceState | null> {
    try { return JSON.parse(await fs.readFile(this.p("state.json"), "utf8")) as DeviceState; } catch { return null; }
  }

  async saveState(state: DeviceState): Promise<void> {
    await this.atomicWrite(this.p("state.json"), JSON.stringify(state));
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    try {
      const raw = await fs.readFile(this.p("baseline.json.gz"));
      return JSON.parse(gunzipSync(raw).toString("utf8")) as DeviceBaseline;
    } catch { return null; }
  }

  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    await this.atomicWrite(this.p("baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify(baseline)), { level: 9 }));
  }

  private async atomicWrite(file: string, data: string | Buffer): Promise<void> {
    const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  bodyPath(id: string): string { return this.p("bodies", id + ".lake"); }
  async readBody(id: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await fs.readFile(this.bodyPath(id))); } catch { return null; }
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(this.p("bodies"), { recursive: true });
    await this.atomicWrite(this.bodyPath(id), Buffer.from(bytes));
  }
  async deleteBody(id: string): Promise<void> {
    try { await fs.unlink(this.bodyPath(id)); } catch { /* ignore */ }
  }
  async writeHistory(id: string, bytes: Uint8Array): Promise<string> {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const file = this.p("history", id + "-" + stamp + ".lake");
    await fs.mkdir(this.p("history"), { recursive: true });
    await fs.writeFile(file, Buffer.from(bytes));
    return file;
  }

  assetsDir(id: string): string { return this.p("assets", id); }
  async listAssets(id: string): Promise<string[]> {
    try { return (await fs.readdir(this.assetsDir(id))).filter((f) => !f.endsWith(".tmp")).sort(); } catch { return []; }
  }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await fs.readFile(path.join(this.assetsDir(id), filename))); } catch { return null; }
  }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    const dir = this.assetsDir(id);
    await fs.mkdir(dir, { recursive: true });
    await this.atomicWrite(path.join(dir, filename), Buffer.from(bytes));
  }
  async deleteAssetsDir(id: string): Promise<void> {
    await fs.rm(this.assetsDir(id), { recursive: true, force: true });
  }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> {
    if (!bytes) return;
    await fs.mkdir(this.p("history"), { recursive: true });
    await fs.writeFile(this.p("history", id + "-" + Date.now() + ".lake"), Buffer.from(bytes));
  }

  quickBodyPath(id: string): string { return this.p("quick-bodies", id + ".qnote"); }
  async readQuickBody(id: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await fs.readFile(this.quickBodyPath(id))); } catch { return null; }
  }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(this.p("quick-bodies"), { recursive: true });
    await this.atomicWrite(this.quickBodyPath(id), Buffer.from(bytes));
  }
  async deleteQuickBody(id: string): Promise<void> {
    try { await fs.unlink(this.quickBodyPath(id)); } catch { /* ignore */ }
  }
  quickAssetsDir(id: string): string { return this.p("quick-assets", id); }
  async listQuickAssets(id: string): Promise<string[]> {
    try { return (await fs.readdir(this.quickAssetsDir(id))).filter((f) => !f.includes(".tmp")).sort(); } catch { return []; }
  }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await fs.readFile(path.join(this.quickAssetsDir(id), filename))); } catch { return null; }
  }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    const dir = this.quickAssetsDir(id);
    await fs.mkdir(dir, { recursive: true });
    await this.atomicWrite(path.join(dir, filename), Buffer.from(bytes));
  }
  async deleteQuickAssetsDir(id: string): Promise<void> {
    await fs.rm(this.quickAssetsDir(id), { recursive: true, force: true });
  }
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./deviceStore.js";
export type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./deviceStore.js";

/** 文件系统实现（测试与 CLI 用；生产接入时用适配器映射现有 Store / 移动端 SQLite）。 */
export class FileDeviceStore implements S3v3DeviceStore {
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
  /** 测试/CLI 文件实现没有同步账本：单条推送的记账由 state 落盘承担。 */
  async markQuickNoteSynced(): Promise<void> { /* no-op */ }
}

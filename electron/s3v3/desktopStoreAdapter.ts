import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Store, ImportedNoteAsset } from "../store.js";
import type { LakeFolderEntry, LakeNoteEntry } from "../../src/core/s3v3Index.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./deviceStore.js";

/**
 * 桌面现有 Store → S3v3DeviceStore 适配器（v1：Lake 文档/目录/附件）。
 * - 元数据以 Store 为准；sync 专属状态（baseline/intents/pending/remotePurged/restorePending/assetsHash）落 sidecar。
 * - 小记暂不支持：检测到 quick-notes 库即抛错，绝不静默跳过。
 */
export class DesktopStoreDevice implements S3v3DeviceStore {
  private readonly store: Store;
  private readonly stateFile: string;
  private readonly baselineFile: string;
  private readonly stagingDir: string;
  private stagedBodies = new Map<string, Uint8Array>();
  private stagedAssets = new Map<string, Map<string, Uint8Array>>();
  private clearedAssets = new Set<string>();
  private readonly skipQuickNotesGuard: boolean;

  constructor(store: Store, storeRoot: string, opts: { stateFile?: string; baselineFile?: string; skipQuickNotesGuard?: boolean } = {}) {
    this.skipQuickNotesGuard = !!opts.skipQuickNotesGuard;
    this.store = store;
    const dir = path.join(storeRoot, "sync-v3");
    this.stateFile = opts.stateFile ?? path.join(dir, "state.json");
    this.baselineFile = opts.baselineFile ?? path.join(dir, "baseline.json.gz");
    this.stagingDir = path.join(dir, "staging");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.mkdir(this.stagingDir, { recursive: true });
    if (!this.skipQuickNotesGuard) {
      const quickDb = path.join(path.dirname(this.stateFile), "..", "quick-notes", "metadata.sqlite3");
      if (await this.exists(quickDb)) throw new Error("DesktopStoreDevice: quick notes adapter not implemented（检测到 quick-notes 库，拒绝静默跳过）");
    }
  }

  private async exists(p: string): Promise<boolean> { try { await fs.stat(p); return true; } catch { return false; } }
  private async readJson<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return null; }
  }
  private async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  private sidecarShape(state: DeviceState) {
    return {
      intents: state.intents, pending: state.pending,
      remotePurged: state.remotePurged ?? [], restorePending: state.restorePending ?? [], archived: state.archived ?? [],
      assetsHash: Object.fromEntries(state.lake.notes.map((n) => [n.id, n.assetsHash]).filter(([, v]) => v)),
    };
  }

  async loadState(): Promise<DeviceState | null> {
    const folders: LakeFolderEntry[] = this.store.listFoldersForSync().map((f) => ({
      id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType, icon: f.icon, updatedAt: f.updatedAt,
      ...(f.trashedAt !== undefined && f.trashedAt !== null ? { trashedAt: f.trashedAt } : {}),
      ...(f.deletedFromParentId !== undefined && f.deletedFromParentId !== null ? { deletedFromParentId: f.deletedFromParentId } : {}),
    }));
    const side = await this.readJson<{ intents: DeviceState["intents"]; pending: DeviceState["pending"]; remotePurged: string[]; restorePending: string[]; archived: DeviceState["archived"]; assetsHash: Record<string, string> }>(this.stateFile);
    const notes: LakeNoteEntry[] = [];
    for (const n of this.store.listNotesForSync()) {
      let contentHash = "";
      try { contentHash = this.store.getNoteInfo(n.id).contentHash; } catch { /* 缺正文/已 purge：跳过 */ continue; }
      if (!contentHash) continue;
      notes.push({
        id: n.id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, contentHash,
        ...(n.kind ? { kind: String(n.kind) } : {}), ...(n.icon !== undefined ? { icon: n.icon } : {}),
        isLocked: !!n.isEditLocked, lockedAt: n.editLockedAt ?? null, isConflict: !!n.isConflict,
        ...(n.trashedAt ? { trashedAt: n.trashedAt } : {}), ...(n.deletedFromParentId !== undefined ? { deletedFromParentId: n.deletedFromParentId } : {}),
        ...(side?.assetsHash?.[n.id] ? { assetsHash: side.assetsHash[n.id] } : {}),
      });
    }
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes, folders },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
      folders,
      intents: side?.intents ?? [], pending: side?.pending ?? [],
      remotePurged: side?.remotePurged ?? [], restorePending: side?.restorePending ?? [], archived: side?.archived ?? [],
    };
    return state;
  }

  async saveState(state: DeviceState): Promise<void> {
    const current = new Map(this.store.listNotesForSync().map((n) => [n.id, n]));
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    for (const n of wanted.values()) {
      const content = this.stagedBodies.has(n.id) ? new TextDecoder().decode(this.stagedBodies.get(n.id)) : null;
      const cur = current.get(n.id);
      try {
        if (!cur) {
          const assets = await this.stagedAssetsToImported(n.id);
          this.store.createNoteInAtTopWithContent(n.parentId, n.title, content ?? "", assets, n.id, (n.kind ?? "doc") as never);
        } else {
          const doc = this.store.readNote(n.id);
          if (content !== null && content !== doc.content) this.store.saveNote(n.id, n.title, content);
          else if (n.title !== doc.title) this.store.saveNote(n.id, n.title, doc.content);
          if ((cur.parentId ?? null) !== (n.parentId ?? null) || cur.sortOrder !== n.sortOrder) this.store.moveTreeNode(n.id, n.parentId, n.sortOrder);
          if ((cur.icon ?? null) !== (n.icon ?? null)) this.store.setNodeIcon(n.id, n.icon ?? null);
          if (!!cur.isEditLocked !== !!n.isLocked) this.store.setNoteEditLocked(n.id, !!n.isLocked);
          if (n.trashedAt && !cur.trashedAt) this.store.deleteNote(n.id);
          else if (!n.trashedAt && cur.trashedAt) this.store.restoreTrashItem(n.id);
        }
        await this.flushStagedAssets(n.id);
      } catch (e) {
        throw new Error("DesktopStoreDevice.saveState 失败(" + n.id + "): " + (e as Error).message);
      }
    }
    for (const cur of current.values()) {
      if (wanted.has(cur.id)) continue;
      try { this.store.deleteNote(cur.id); this.store.purgeTrashItem(cur.id); } catch { /* 已不在 */ }
    }
    await this.saveFolders(state.folders);
    await this.writeAtomic(this.stateFile, JSON.stringify(this.sidecarShape(state)));
    this.stagedBodies.clear();
    this.stagedAssets.clear();
    this.clearedAssets.clear();
  }

  private async saveFolders(folders: LakeFolderEntry[]): Promise<void> {
    const cur = new Map(this.store.listFoldersForSync().map((f) => [f.id, f]));
    for (const f of folders) {
      const c = cur.get(f.id);
      try {
        if (!c) {
          const created = f.nodeType === "notebook" ? this.store.createNotebook(f.title) : this.store.createGroup(f.parentId ?? (this.store.listFoldersForSync()[0]?.id ?? ""), f.title);
          if (created.id !== f.id) throw new Error("目录 id 无法指定: " + f.id + " -> " + created.id);
        } else {
          if (c.title !== f.title) this.store.renameTreeNode(f.id, f.title);
          if ((c.parentId ?? null) !== (f.parentId ?? null) || c.sortOrder !== f.sortOrder) this.store.moveTreeNode(f.id, f.parentId, f.sortOrder);
          if ((c.icon ?? null) !== (f.icon ?? null)) this.store.setNodeIcon(f.id, f.icon ?? null);
        }
      } catch (e) { throw new Error("DesktopStoreDevice.saveFolders 失败(" + f.id + "): " + (e as Error).message); }
    }
    for (const c of cur.values()) if (!folders.some((f) => f.id === c.id)) { try { this.store.deleteTreeNode(c.id); } catch { /* ignore */ } }
  }

  private async stagedAssetsToImported(noteId: string): Promise<ImportedNoteAsset[]> {
    const staged = this.stagedAssets.get(noteId);
    if (!staged || staged.size === 0) return [];
    const dir = path.join(this.stagingDir, noteId);
    await fs.mkdir(dir, { recursive: true });
    const out: ImportedNoteAsset[] = [];
    for (const [filename, bytes] of staged) {
      const file = path.join(dir, filename);
      await fs.writeFile(file, bytes);
      out.push({ filename, sourcePath: file });
    }
    return out;
  }
  private async flushStagedAssets(noteId: string): Promise<void> {
    const dir = this.store.getNotePaths(noteId).assetsDir;
    const staged = this.stagedAssets.get(noteId);
    if (staged) {
      await fs.mkdir(dir, { recursive: true });
      for (const [filename, bytes] of staged) await fs.writeFile(path.join(dir, filename), bytes);
    }
    if (this.clearedAssets.has(noteId)) await fs.rm(dir, { recursive: true, force: true });
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    try { return JSON.parse(gunzipSync(await fs.readFile(this.baselineFile)).toString("utf8")) as DeviceBaseline; } catch { return null; }
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    await this.writeAtomic(this.baselineFile, gzipSync(Buffer.from(JSON.stringify(baseline)), { level: 9 }));
  }

  async readBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedBodies.get(id);
    if (staged) return staged;
    try {
      const doc = this.store.readNote(id);
      if (doc.bodyMissing) return null;
      return new TextEncoder().encode(doc.content);
    } catch { return null; }
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.stagedBodies.set(id, bytes); }
  async deleteBody(id: string): Promise<void> { this.stagedBodies.delete(id); }
  async writeHistory(id: string, bytes: Uint8Array): Promise<string> {
    try { this.store.createHistorySnapshot(id, new TextDecoder().decode(bytes), true); } catch { /* ignore */ }
    return id;
  }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> { if (bytes) await this.writeHistory(id, bytes); }

  async listAssets(id: string): Promise<string[]> {
    const dir = this.store.getNotePaths(id).assetsDir;
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { /* none */ }
    const staged = this.stagedAssets.get(id);
    return [...new Set([...files.filter((f) => !f.includes(".tmp")), ...(staged ? [...staged.keys()] : [])])].sort();
  }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
    const staged = this.stagedAssets.get(id)?.get(filename);
    if (staged) return staged;
    const got = this.store.readAssetBytes(id, filename);
    return got ? new Uint8Array(got.bytes) : null;
  }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    let map = this.stagedAssets.get(id); if (!map) { map = new Map(); this.stagedAssets.set(id, map); }
    map.set(filename, bytes);
  }
  async deleteAssetsDir(id: string): Promise<void> { this.clearedAssets.add(id); }

  async readQuickBody(): Promise<Uint8Array | null> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async writeQuickBody(): Promise<void> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async deleteQuickBody(): Promise<void> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async listQuickAssets(): Promise<string[]> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async readQuickAsset(): Promise<Uint8Array | null> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async writeQuickAsset(): Promise<void> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
  async deleteQuickAssetsDir(): Promise<void> { throw new Error("DesktopStoreDevice: quick notes adapter not implemented"); }
}

/**
 * 便携包导入：Capacitor 原生插件 PortableImport 的 JS 封装（Android）。
 *
 * 原生只做「文件系统 + 只读读桌面 SQLite」：选包/解压/校验/分页读行/复制文件/回滚隔离；
 * 手机业务库的映射与写入在 src/mobile/portable/importPortable.ts（可单测）。
 * 浏览器预览 / vitest 没有原生插件 ⇒ isPortableImportNativeAvailable() 为 false，所有方法返回不可用。
 */
import { registerPlugin } from "@capacitor/core";
import type { DesktopRow } from "../portable/portableMapping";

export interface StagedPortablePackage {
  ok: boolean;
  cancelled?: boolean;
  stagingPath?: string;
  manifestJson?: string;
  bytes?: number;
  entries?: number;
  error?: string;
}

export interface PortableRowsPage {
  ok: boolean;
  rows: DesktopRow[];
  done: boolean;
  error?: string;
}

export interface PortableBaselineFile {
  ok: boolean;
  json?: string;
  error?: string;
}

export interface PortableCopyResult {
  ok: boolean;
  files?: number;
  bytes?: number;
  error?: string;
}

export interface PortableBeginResult {
  ok: boolean;
  rollbackDir?: string;
  dbFiles?: number;
  movedDirs?: number;
  error?: string;
}

export interface PortableRecoverResult {
  ok: boolean;
  restored?: boolean;
  pending?: boolean;
  files?: number;
  error?: string;
}

export interface PortablePendingInfo {
  pending: boolean;
  startedAt?: number;
  stagingPath?: string;
}

export type PortableDbKey = "main" | "quick";
export type PortableTable =
  | "notes"
  | "tree_nodes"
  | "quick_notes"
  | "quick_note_deleted"
  | "tags"
  | "tag_links"
  | "tag_link_versions";

interface PortableImportPluginApi {
  pickAndStage(): Promise<StagedPortablePackage>;
  discardStaging(options: { stagingPath: string }): Promise<{ ok: boolean }>;
  readRows(options: {
    stagingPath: string;
    db: PortableDbKey;
    table: PortableTable;
    offset: number;
    limit: number;
  }): Promise<PortableRowsPage>;
  readBaseline(options: { stagingPath: string }): Promise<PortableBaselineFile>;
  copyPayload(options: { stagingPath: string }): Promise<PortableCopyResult>;
  beginImport(options: { stagingPath: string }): Promise<PortableBeginResult>;
  commitImport(): Promise<{ ok: boolean }>;
  rollbackImport(): Promise<PortableRecoverResult>;
  recoverPending(): Promise<PortableRecoverResult>;
  pendingInfo(): Promise<PortablePendingInfo>;
}

const PortableImport = registerPlugin<PortableImportPluginApi>("PortableImport");

export function isPortableImportNativeAvailable(): boolean {
  try {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown");
}

function unavailable(): string {
  return "浏览器预览不支持从便携包导入，请在 Android 上操作";
}

export async function nativePickPortablePackage(): Promise<StagedPortablePackage> {
  if (!isPortableImportNativeAvailable()) return { ok: false, error: unavailable() };
  try {
    return (await PortableImport.pickAndStage()) ?? { ok: false, error: "没有返回结果" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativeDiscardPortableStaging(stagingPath: string): Promise<void> {
  if (!isPortableImportNativeAvailable() || !stagingPath) return;
  try {
    await PortableImport.discardStaging({ stagingPath });
  } catch {
    /* 清理失败只留日志：下次选择时会留下可手动清掉的 cache 目录 */
  }
}

export async function nativeReadPortableRows(options: {
  stagingPath: string;
  db: PortableDbKey;
  table: PortableTable;
  offset: number;
  limit: number;
}): Promise<PortableRowsPage> {
  if (!isPortableImportNativeAvailable()) return { ok: false, rows: [], done: true, error: unavailable() };
  try {
    const page = await PortableImport.readRows(options);
    return { ok: page?.ok !== false, rows: page?.rows ?? [], done: page?.done !== false };
  } catch (error) {
    return { ok: false, rows: [], done: true, error: errorText(error) };
  }
}

export async function nativeReadPortableBaseline(stagingPath: string): Promise<PortableBaselineFile> {
  if (!isPortableImportNativeAvailable()) return { ok: false, error: unavailable() };
  try {
    return (await PortableImport.readBaseline({ stagingPath })) ?? { ok: false, error: "没有返回结果" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativeCopyPortablePayload(stagingPath: string): Promise<PortableCopyResult> {
  if (!isPortableImportNativeAvailable()) return { ok: false, error: unavailable() };
  try {
    return (await PortableImport.copyPayload({ stagingPath })) ?? { ok: false, error: "没有返回结果" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativeBeginPortableImport(stagingPath: string): Promise<PortableBeginResult> {
  if (!isPortableImportNativeAvailable()) return { ok: false, error: unavailable() };
  try {
    return (await PortableImport.beginImport({ stagingPath })) ?? { ok: false, error: "没有返回结果" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativeCommitPortableImport(): Promise<{ ok: boolean }> {
  if (!isPortableImportNativeAvailable()) return { ok: false };
  try {
    return (await PortableImport.commitImport()) ?? { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function nativeRollbackPortableImport(): Promise<PortableRecoverResult> {
  if (!isPortableImportNativeAvailable()) return { ok: false, error: unavailable() };
  try {
    return (await PortableImport.rollbackImport()) ?? { ok: false };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativeRecoverPortableImport(): Promise<PortableRecoverResult> {
  if (!isPortableImportNativeAvailable()) return { ok: false };
  try {
    return (await PortableImport.recoverPending()) ?? { ok: false };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function nativePortablePendingInfo(): Promise<PortablePendingInfo> {
  if (!isPortableImportNativeAvailable()) return { pending: false };
  try {
    return (await PortableImport.pendingInfo()) ?? { pending: false };
  } catch {
    return { pending: false };
  }
}

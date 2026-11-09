/**
 * 应用内更新：Capacitor 原生插件 Update 的 JS 封装（Android）。
 *
 * 口径（docs/UPDATE-CENTER.md）：
 *  · 清单只回原始 JSON —— 解析/校验在 src/core/update/updateManifest.ts（两端单一来源）；
 *  · sha256 与证书指纹由原生校验（期望值从 core 传入，Kotlin 不复制第二份常量）；
 *  · 浏览器预览 / vitest 没有原生插件 ⇒ isUpdateNativeAvailable() 为 false，所有方法
 *    返回「无原生能力」而不是 throw（设置页据此显示说明）。
 */
import { registerPlugin } from "@capacitor/core";

export interface NativeUpdateManifestResult {
  ok: boolean;
  status?: number;
  body?: string;
  code?: string;
  detail?: string;
}

export interface NativeUpdateDownloadStart {
  ok: boolean;
  downloadId?: string;
  code?: string;
  detail?: string;
}

export interface NativeUpdateDownloadStatus {
  state: "idle" | "running" | "paused" | "downloaded" | "failed";
  path?: string;
  filename?: string;
  size?: number;
  sha256?: string;
  version?: string;
  received?: number;
  total?: number;
  code?: string;
  detail?: string;
}

export interface NativeUpdateVerifyResult {
  ok: boolean;
  code?: string;
  sha256?: string;
  signerSha256?: string;
  versionCode?: number;
  versionName?: string;
  detail?: string;
}

export interface NativeUpdateInstallResult {
  ok: boolean;
  code?: string;
  openedSettings?: boolean;
  detail?: string;
}

export interface NativeUpdateNetwork {
  wifi: boolean;
  metered: boolean;
  online?: boolean;
}

interface UpdatePluginApi {
  check(options: { url: string }): Promise<NativeUpdateManifestResult>;
  download(options: {
    url: string;
    filename: string;
    sha256: string;
    size: number;
    version: string;
  }): Promise<NativeUpdateDownloadStart>;
  status(): Promise<NativeUpdateDownloadStatus>;
  cancel(): Promise<{ ok: boolean }>;
  cleanup(): Promise<{ ok: boolean }>;
  verify(options: { path: string; sha256: string; certSha256: string }): Promise<NativeUpdateVerifyResult>;
  install(options: { path: string }): Promise<NativeUpdateInstallResult>;
  isWifi(): Promise<NativeUpdateNetwork>;
}

const Update = registerPlugin<UpdatePluginApi>("Update");

/** 是否运行在 Capacitor 原生平台（Android）。看 Capacitor 标志而不是 window.lakeNative（后者启动后才注入）。 */
export function isUpdateNativeAvailable(): boolean {
  try {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown");
}

export async function nativeCheckUpdateManifest(url: string): Promise<NativeUpdateManifestResult> {
  if (!isUpdateNativeAvailable()) return { ok: false, code: "no_native" };
  try {
    return (await Update.check({ url })) ?? { ok: false, code: "no_response" };
  } catch (error) {
    return { ok: false, code: "plugin_error", detail: errorDetail(error) };
  }
}

export async function nativeStartUpdateDownload(options: {
  url: string;
  filename: string;
  sha256: string;
  size: number;
  version: string;
}): Promise<NativeUpdateDownloadStart> {
  if (!isUpdateNativeAvailable()) return { ok: false, code: "no_native" };
  try {
    return (await Update.download(options)) ?? { ok: false, code: "no_response" };
  } catch (error) {
    return { ok: false, code: "plugin_error", detail: errorDetail(error) };
  }
}

export async function nativeUpdateDownloadStatus(): Promise<NativeUpdateDownloadStatus | null> {
  if (!isUpdateNativeAvailable()) return null;
  try {
    return (await Update.status()) ?? null;
  } catch {
    return null;
  }
}

export async function nativeCancelUpdateDownload(): Promise<void> {
  if (!isUpdateNativeAvailable()) return;
  try {
    await Update.cancel();
  } catch {
    /* 取消失败不影响 UI：下次 status() 会收敛 */
  }
}

/** 清 staging + cache/updates 的更新残留（设置页「清理缓存」与取消下载共用）。 */
export async function nativeCleanupUpdateFiles(): Promise<void> {
  if (!isUpdateNativeAvailable()) return;
  try {
    await Update.cleanup();
  } catch {
    /* 清理失败只留日志：下次启动/清理会再试 */
  }
}

export async function nativeVerifyUpdate(options: {
  path: string;
  sha256: string;
  certSha256: string;
}): Promise<NativeUpdateVerifyResult> {
  if (!isUpdateNativeAvailable()) return { ok: false, code: "no_native" };
  try {
    return (await Update.verify(options)) ?? { ok: false, code: "no_response" };
  } catch (error) {
    return { ok: false, code: "plugin_error", detail: errorDetail(error) };
  }
}

export async function nativeInstallUpdate(path: string): Promise<NativeUpdateInstallResult> {
  if (!isUpdateNativeAvailable()) return { ok: false, code: "no_native" };
  try {
    return (await Update.install({ path })) ?? { ok: false, code: "no_response" };
  } catch (error) {
    return { ok: false, code: "plugin_error", detail: errorDetail(error) };
  }
}

export async function nativeUpdateNetwork(): Promise<NativeUpdateNetwork | null> {
  if (!isUpdateNativeAvailable()) return null;
  try {
    return (await Update.isWifi()) ?? null;
  } catch {
    return null;
  }
}

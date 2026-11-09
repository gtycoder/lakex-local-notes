/**
 * 更新中心的**判据**（纯函数，无 IO）：
 *   · 自动检查节流（启动 + 回前台按 24h/6h/12h）—— docs/UPDATE-CENTER.md §2/§4；
 *   · 忽略版本（该版本不再提示、不自动下载；下个版本恢复）；
 *   · Android 资产选择（只取 os=android、https、.apk）；
 *   · 自动下载闸门（默认开；Android 仅 Wi-Fi）。
 * 单测见 updatePolicy.test.ts。
 */
import { pickAsset, type UpdateAsset, type UpdateManifest } from "../../core/update/updateManifest";
import type { UpdateSettings } from "./updateSettings";

export const HOUR_MS = 60 * 60 * 1000;

/** 是否到期该自动检查：关掉/间隔 0 一律 false；从未检查过直接 true。 */
export function shouldAutoCheck(settings: UpdateSettings, lastCheckAt: number, now: number): boolean {
  if (!settings.autoCheck) return false;
  if (!Number.isFinite(settings.checkIntervalHours) || settings.checkIntervalHours <= 0) return false;
  if (!Number.isFinite(lastCheckAt) || lastCheckAt <= 0) return true;
  if (!Number.isFinite(now)) return false;
  return now - lastCheckAt >= settings.checkIntervalHours * HOUR_MS;
}

/** 该版本是否被用户「忽略此版本」。 */
export function isVersionIgnored(settings: UpdateSettings, version: string): boolean {
  const target = version.trim();
  return target !== "" && settings.ignoredVersion === target;
}

/** 返回新设置（不改入参）：记住被忽略的版本。 */
export function ignoreVersion(settings: UpdateSettings, version: string): UpdateSettings {
  const target = version.trim();
  return target === "" ? settings : { ...settings, ignoredVersion: target };
}

/** Android 安装包：只认 os=android、https、.apk（清单里其它平台的包一律不碰）。 */
export function androidUpdateAsset(manifest: UpdateManifest): UpdateAsset | null {
  const asset = pickAsset(manifest, "android", null);
  if (!asset) return null;
  if (!asset.url.startsWith("https://")) return null;
  if (!/\.apk$/i.test(asset.filename)) return null;
  return asset;
}

export interface UpdateNetworkState {
  wifi: boolean;
  metered: boolean;
}

export type AutoDownloadRefusal = "disabled" | "ignored" | "no_asset" | "no_native" | "offline" | "wifi_required";

export type AutoDownloadDecision = { download: true } | { download: false; reason: AutoDownloadRefusal };

/**
 * 自动下载闸门：默认开，Android 仅 Wi-Fi（默认开）。
 * 顺序 = 忽略 → 开关 → 原生 → 有包 → 在线 → 仅 Wi-Fi 约束（先排除「用户已经不想看」的情况）。
 */
export function decideAutoDownload(input: {
  settings: UpdateSettings;
  manifest: UpdateManifest;
  isNative: boolean;
  network: UpdateNetworkState | null;
}): AutoDownloadDecision {
  const { settings, manifest, isNative, network } = input;
  if (isVersionIgnored(settings, manifest.version)) return { download: false, reason: "ignored" };
  if (!settings.autoDownload) return { download: false, reason: "disabled" };
  if (!isNative) return { download: false, reason: "no_native" };
  if (!androidUpdateAsset(manifest)) return { download: false, reason: "no_asset" };
  if (!network || (!network.wifi && !network.metered)) return { download: false, reason: "offline" };
  if (settings.autoDownloadWifiOnly && !network.wifi) return { download: false, reason: "wifi_required" };
  return { download: true };
}

/**
 * 更新中心：清单类型 / 解析 / 版本比较 / 资产选择（两端共用的纯逻辑）。
 *
 * 口径见 docs/UPDATE-CENTER.md；本文件不得 import node:*（renderer 与 main 两侧共用）。
 */

export const UPDATE_MANIFEST_URL =
  "https://github.com/gtycoder/lakex-local-notes/releases/latest/download/latest.json";

export const RELEASE_PAGE_BASE = "https://github.com/gtycoder/lakex-local-notes/releases/tag/";

/** Android release 证书 SHA-256（与 GitHub 发布一致，2026-11-09 核对）。 */
export const ANDROID_RELEASE_CERT_SHA256 =
  "A8BA87F7F7A5E06871CBCF4EEF1078A03801E2B5B6DD3C8255516AB5CF212E35";

export type UpdateOs = "macos" | "windows" | "android";
export type UpdateArch = "x64" | "arm64";

export interface UpdateAsset {
  os: UpdateOs;
  arch: UpdateArch | null;
  filename: string;
  url: string;
  sha256: string;
  size: number;
}

export interface UpdateManifest {
  schemaVersion: 1;
  version: string;
  versionCode: number;
  publishedAt: string;
  notes: string;
  releasePageUrl: string;
  assets: UpdateAsset[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /^[0-9a-f]{64}$/i;

/** 解析并校验清单；不合法直接抛错（调用方按「检查更新失败」处理）。 */
export function parseUpdateManifest(raw: unknown): UpdateManifest {
  if (!raw || typeof raw !== "object") throw new Error("更新清单不是对象");
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) throw new Error("更新清单 schemaVersion 不支持");
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) throw new Error("更新清单 version 非法");
  if (!Number.isInteger(value.versionCode) || (value.versionCode as number) <= 0) throw new Error("更新清单 versionCode 非法");
  if (typeof value.publishedAt !== "string" || value.publishedAt.length === 0) throw new Error("更新清单 publishedAt 非法");
  if (typeof value.notes !== "string") throw new Error("更新清单 notes 非法");
  if (typeof value.releasePageUrl !== "string" || !value.releasePageUrl.startsWith("https://")) throw new Error("更新清单 releasePageUrl 非法");
  if (!Array.isArray(value.assets) || value.assets.length === 0) throw new Error("更新清单 assets 为空");
  const assets = value.assets.map((item) => {
    if (!item || typeof item !== "object") throw new Error("更新清单 asset 非法");
    const a = item as Record<string, unknown>;
    if (a.os !== "macos" && a.os !== "windows" && a.os !== "android") throw new Error("更新清单 asset.os 非法");
    if (a.arch !== null && a.arch !== "x64" && a.arch !== "arm64") throw new Error("更新清单 asset.arch 非法");
    if (typeof a.filename !== "string" || a.filename.length === 0) throw new Error("更新清单 asset.filename 非法");
    if (typeof a.url !== "string" || !a.url.startsWith("https://")) throw new Error("更新清单 asset.url 非法");
    if (typeof a.sha256 !== "string" || !SHA256.test(a.sha256)) throw new Error("更新清单 asset.sha256 非法");
    if (!Number.isInteger(a.size) || (a.size as number) <= 0) throw new Error("更新清单 asset.size 非法");
    return { os: a.os, arch: a.arch, filename: a.filename, url: a.url, sha256: a.sha256.toLowerCase(), size: a.size } as UpdateAsset;
  });
  return {
    schemaVersion: 1,
    version: value.version.replace(/^v/, ""),
    versionCode: value.versionCode as number,
    publishedAt: value.publishedAt,
    notes: value.notes,
    releasePageUrl: value.releasePageUrl,
    assets,
  };
}

/** semver 数值比较：a>b 返回正数，a<b 负数，相等 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error("版本号不是 x.y.z：" + a + " / " + b);
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface CurrentVersion {
  version: string;
  /** Android 以 versionCode 为主；桌面可不传。 */
  versionCode?: number;
}

/** 是否有新版本。优先 versionCode（Android），缺失时回退 semver。 */
export function isNewerManifest(manifest: UpdateManifest, current: CurrentVersion): boolean {
  if (typeof current.versionCode === "number" && Number.isInteger(current.versionCode)) {
    if (manifest.versionCode !== current.versionCode) return manifest.versionCode > current.versionCode;
    return compareVersions(manifest.version, current.version) > 0;
  }
  return compareVersions(manifest.version, current.version) > 0;
}

/** 资产选择：先按 os+arch 精确匹配，再按 os 取第一个（arch=null 的通用包）。 */
export function pickAsset(manifest: UpdateManifest, os: UpdateOs, arch: UpdateArch | null): UpdateAsset | null {
  const sameOs = manifest.assets.filter((a) => a.os === os);
  if (arch) {
    const exact = sameOs.find((a) => a.arch === arch);
    if (exact) return exact;
  }
  return sameOs.find((a) => a.arch === null) ?? sameOs[0] ?? null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + " " + units[unit];
}

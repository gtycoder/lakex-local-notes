/**
 * 更新中心状态机（设备本地；单飞；无 React 依赖，便于自动检查与设置页共用同一份状态）。
 *
 * 流程（docs/UPDATE-CENTER.md）：
 *   检查（原生 check 拉 latest.json）→ core 解析/比较 → 发现新版本 available
 *   → 自动下载闸门（仅原生 + Wi-Fi 判据）→ 原生 DownloadManager 下载 → 轮询进度
 *   → 原生 sha256 + 证书指纹校验 → downloaded（等用户点「安装」→ 系统安装器）
 * 失败面：检查失败只提示、保留旧状态；下载失败/校验失败删坏包；不做静默安装。
 *
 * 状态只存内存 + 设置/运行态存 localStorage（src/mobile/update/updateSettings.ts），
 * 不写正文、不进 S3。
 */
import {
  ANDROID_RELEASE_CERT_SHA256,
  UPDATE_MANIFEST_URL,
  isNewerManifest,
  parseUpdateManifest,
  type UpdateManifest,
} from "../../core/update/updateManifest";
import { mobileAppInfoPort } from "../native/appInfoPort";
import {
  isUpdateNativeAvailable,
  nativeCancelUpdateDownload,
  nativeCheckUpdateManifest,
  nativeInstallUpdate,
  nativeStartUpdateDownload,
  nativeUpdateDownloadStatus,
  nativeUpdateNetwork,
  nativeVerifyUpdate,
} from "../native/updateManager";
import { androidUpdateAsset, decideAutoDownload, ignoreVersion, isVersionIgnored, shouldAutoCheck } from "./updatePolicy";
import {
  loadUpdateRuntimeState,
  loadUpdateSettings,
  saveUpdateRuntimeState,
  saveUpdateSettings,
  patchUpdateSettings,
  type UpdateRuntimeState,
} from "./updateSettings";

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateCenterSnapshot {
  status: UpdateStatus;
  manifest: UpdateManifest | null;
  checkedAt: number | null;
  error: string | null;
  progress: { received: number; total: number } | null;
  downloadedPath: string;
  downloadedVersion: string;
  downloadedSha256: string;
  /** 是否具备原生更新能力（浏览器预览为 false）。 */
  native: boolean;
}

function initialState(): UpdateCenterSnapshot {
  return {
    status: "idle",
    manifest: null,
    checkedAt: null,
    error: null,
    progress: null,
    downloadedPath: "",
    downloadedVersion: "",
    downloadedSha256: "",
    native: isUpdateNativeAvailable(),
  };
}

let snapshot: UpdateCenterSnapshot = initialState();
const listeners = new Set<() => void>();

export function subscribeUpdateCenter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUpdateCenterSnapshot(): UpdateCenterSnapshot {
  return snapshot;
}

function emit(patch: Partial<UpdateCenterSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

let checking = false;
let downloading = false;
let pollTimer: number | null = null;
let retryTimer: number | null = null;
let moveRetries = 0;

function saveRuntime(patch: Partial<UpdateRuntimeState>): void {
  saveUpdateRuntimeState({ ...loadUpdateRuntimeState(), ...patch });
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function versionCodeOf(build: string | undefined): number | undefined {
  if (!build) return undefined;
  const parsed = Number.parseInt(build, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function checkFailureText(code: string | undefined, status: number | undefined): string {
  if (code === "timeout") return "检查更新超时，请稍后重试";
  if (code === "network") return "网络不可用，检查更新失败";
  if (code === "http_404") return "还没有可用的更新清单";
  if (status !== undefined && status >= 500) return "更新服务器暂时不可用，请稍后重试";
  return "检查更新失败，请稍后重试";
}

/** 检查更新（手动/自动共用；同一时刻只跑一个）。 */
export async function checkForUpdates(options: { manual: boolean }): Promise<void> {
  if (checking || downloading) return;
  if (!isUpdateNativeAvailable()) {
    if (options.manual) {
      emit({ status: "error", error: "浏览器预览不支持应用内更新，请在 Android 上检查", checkedAt: Date.now() });
    }
    return;
  }
  checking = true;
  emit({ status: "checking", error: null });
  try {
    const result = await nativeCheckUpdateManifest(UPDATE_MANIFEST_URL);
    const checkedAt = Date.now();
    if (!result.ok || !result.body) {
      emit({ status: "error", error: checkFailureText(result.code, result.status), checkedAt });
      return;
    }
    let manifest: UpdateManifest;
    try {
      manifest = parseUpdateManifest(JSON.parse(result.body));
    } catch {
      emit({ status: "error", error: "更新清单格式不合法", checkedAt });
      return;
    }
    const appInfo = await mobileAppInfoPort.getAppInfo();
    const versionCode = versionCodeOf(appInfo.build);
    const current = versionCode === undefined ? { version: appInfo.version } : { version: appInfo.version, versionCode };
    saveRuntime({ lastCheckAt: checkedAt });
    if (!isNewerManifest(manifest, current)) {
      emit({ status: "up-to-date", manifest: null, checkedAt });
      return;
    }
    emit({ status: "available", manifest, checkedAt, error: null });
    // 261109 用户定稿：**手动检查只提示、不自动下载**（与桌面同口径）——
    // 下载 / 前往发布页由用户点；自动下载只服务后台自动检查（含仅 Wi-Fi 约束）。
    if (options.manual) return;
    const settings = loadUpdateSettings();
    if (isVersionIgnored(settings, manifest.version)) return;
    const network = await nativeUpdateNetwork();
    const decision = decideAutoDownload({
      settings,
      manifest,
      isNative: true,
      network: network ? { wifi: network.wifi, metered: network.metered } : null,
    });
    if (decision.download) void startUpdateDownload();
  } finally {
    checking = false;
  }
}

/** 按 24h/6h/12h 节流触发一次自动检查（启动 + 回前台调用）。 */
export async function runScheduledUpdateCheck(): Promise<void> {
  if (!isUpdateNativeAvailable()) return;
  const settings = loadUpdateSettings();
  const state = loadUpdateRuntimeState();
  if (!shouldAutoCheck(settings, state.lastCheckAt, Date.now())) return;
  // 先落检查时间：本轮失败也不在同一个间隔内反复重试（规格 §5「不重试风暴」）。
  saveRuntime({ lastCheckAt: Date.now() });
  await checkForUpdates({ manual: false });
}

/** 开始下载当前 available 清单里的 Android 安装包。 */
export async function startUpdateDownload(): Promise<void> {
  const manifest = snapshot.manifest;
  if (!manifest || downloading) return;
  const asset = androidUpdateAsset(manifest);
  if (!asset) {
    emit({ status: "error", error: "更新清单里没有可用的 Android 安装包" });
    return;
  }
  const result = await nativeStartUpdateDownload({
    url: asset.url,
    filename: asset.filename,
    sha256: asset.sha256,
    size: asset.size,
    version: manifest.version,
  });
  if (!result.ok) {
    emit({ status: "error", error: result.code === "no_native" ? "当前环境不支持应用内下载" : "开始下载失败，请稍后重试" });
    return;
  }
  downloading = true;
  moveRetries = 0;
  emit({ status: "downloading", progress: { received: 0, total: asset.size }, error: null });
  startDownloadPolling(asset.size);
}

function startDownloadPolling(expectedSize: number): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void pollDownloadOnce(expectedSize);
  }, 800);
}

async function pollDownloadOnce(expectedSize: number): Promise<void> {
  const status = await nativeUpdateDownloadStatus();
  if (!status) return;
  if (status.state === "running" || status.state === "paused") {
    emit({
      progress: {
        received: Math.max(0, status.received ?? 0),
        total: status.total && status.total > 0 ? status.total : expectedSize,
      },
    });
    return;
  }
  stopPolling();
  downloading = false;
  if (status.state === "downloaded" && status.path) {
    await finalizeDownload(status.path, status.sha256 ?? "", status.version ?? "");
    return;
  }
  if (status.state === "failed") {
    if (status.code === "move_failed") {
      // 原生已回滚半成品并保留 staging：再查一次会重试搬运（最多 3 次）。
      moveRetries += 1;
      if (moveRetries <= 3) {
        downloading = true;
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          if (downloading) startDownloadPolling(expectedSize);
        }, 1200);
        return;
      }
      emit({ status: "error", error: "安装包写入失败，请重试（暂存文件已保留）" });
      return;
    }
    emit({ status: "error", error: "下载失败，请重试" });
    return;
  }
  emit({ status: snapshot.manifest ? "available" : "idle", progress: null });
}

let finalizing = false;

async function finalizeDownload(path: string, sha256: string, version: string): Promise<void> {
  // 轮询与「回前台恢复」可能同时命中同一个完成态：校验只跑一份（35MB sha256 不重复算）。
  if (finalizing) return;
  finalizing = true;
  try {
    await runFinalizeDownload(path, sha256, version);
  } finally {
    finalizing = false;
  }
}

async function runFinalizeDownload(path: string, sha256: string, version: string): Promise<void> {
  const expectedSha = (sha256 || loadUpdateRuntimeState().downloadedSha256 || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
    emit({ status: "error", error: "缺少安装包校验信息，请重新下载" });
    return;
  }
  const verify = await nativeVerifyUpdate({ path, sha256: expectedSha, certSha256: ANDROID_RELEASE_CERT_SHA256 });
  if (!verify.ok) {
    await nativeCancelUpdateDownload();
    emit({
      status: "error",
      error: verify.code === "cert_mismatch" ? "安装包签名校验失败，已删除，请重新下载" : "安装包校验失败，已删除，请重新下载",
    });
    return;
  }
  saveRuntime({
    downloadedVersion: version || snapshot.manifest?.version || "",
    downloadedPath: path,
    downloadedSha256: expectedSha,
  });
  emit({
    status: "downloaded",
    downloadedPath: path,
    downloadedVersion: version || snapshot.manifest?.version || "",
    downloadedSha256: expectedSha,
    progress: null,
    error: null,
  });
}

/** App 重启 / 回前台：恢复「下载中 / 已下载待安装」状态（原生按 downloadId + 文件存在性判定）。 */
export async function restoreDownloadedUpdate(): Promise<void> {
  if (!isUpdateNativeAvailable()) return;
  if (checking || downloading) return;
  const status = await nativeUpdateDownloadStatus();
  if (!status || status.state === "idle") return;
  if (status.state === "running" || status.state === "paused") {
    downloading = true;
    emit({
      status: "downloading",
      progress: { received: Math.max(0, status.received ?? 0), total: Math.max(0, status.total ?? 0) },
      downloadedVersion: status.version ?? snapshot.downloadedVersion,
    });
    startDownloadPolling(Math.max(0, status.total ?? 0));
    return;
  }
  if (status.state === "downloaded" && status.path) {
    // 同一路径已经校验过（state downloaded）⇒ 不重复算 35MB sha256。
    if (snapshot.status === "downloaded" && snapshot.downloadedPath === status.path) return;
    await finalizeDownload(status.path, status.sha256 ?? "", status.version ?? "");
    return;
  }
  if (status.state === "failed") {
    emit({ status: snapshot.manifest ? "available" : "idle", error: "上次下载失败，可重试" });
  }
}

/** 取消下载（删除 staging + cache 单文件）。 */
export async function cancelUpdateDownload(): Promise<void> {
  stopPolling();
  downloading = false;
  await nativeCancelUpdateDownload();
  emit({ status: snapshot.manifest ? "available" : "idle", progress: null, error: null });
}

/** 调用系统安装器（不静默安装；未授权「安装未知应用」时原生会把用户送到系统设置页）。 */
export async function installDownloadedUpdate(): Promise<void> {
  const path = snapshot.downloadedPath || loadUpdateRuntimeState().downloadedPath;
  if (!path) {
    emit({ status: "error", error: "没有可安装的更新包" });
    return;
  }
  const result = await nativeInstallUpdate(path);
  if (result.ok) return;
  if (result.code === "install_permission") {
    emit({ error: result.openedSettings ? "请在系统设置里允许安装未知应用，然后回来再点「安装」" : "请先在系统设置里允许安装未知应用" });
    return;
  }
  emit({ error: "拉起系统安装器失败，请到文件管理器手动安装" });
}

/** 忽略当前新版本：该版本不再提示、不自动下载（下个版本恢复）。 */
export function ignoreCurrentVersion(): void {
  const manifest = snapshot.manifest;
  if (!manifest) return;
  const settings = loadUpdateSettings();
  saveUpdateSettings(ignoreVersion(settings, manifest.version));
  emit({ status: "idle", manifest: null, progress: null, error: null });
}

/** 记住某个版本已经弹过更新窗口（每个版本最多自动弹一次）。 */
export function markUpdatePrompted(version: string): void {
  saveRuntime({ promptedVersion: version });
}

/** 打开 GitHub release 页（系统浏览器）。 */
export function openUpdateReleasePage(): void {
  const manifest = snapshot.manifest;
  const url = manifest?.releasePageUrl || "https://github.com/gtycoder/lakex-local-notes/releases";
  try {
    window.open(url, "_blank", "noopener");
  } catch {
    /* 弹窗被拦：无副作用（设置行里也能看到版本） */
  }
}

/** 设置页读取当前设置 / 写入设置（设备本地）。 */
export function readUpdateSettings(): ReturnType<typeof loadUpdateSettings> {
  return loadUpdateSettings();
}

export function writeUpdateSettings(patch: Parameters<typeof patchUpdateSettings>[1]): void {
  const next = patchUpdateSettings(loadUpdateSettings(), patch);
  saveUpdateSettings(next);
}

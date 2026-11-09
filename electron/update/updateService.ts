/**
 * 桌面更新服务（主进程；**不 import electron**，便于单测）。
 *
 * 口径见 docs/UPDATE-CENTER.md：
 * - 只认 GitHub 稳定版 latest.json；不做静默安装（下载后由用户打开安装包）；
 * - 自动检查默认开（启动一次 + 每 N 小时），自动下载默认开；
 * - 网络失败/404/坏清单 ⇒ 只提示「检查更新失败」，保留旧状态；下载失败最多重试 3 次（2s/8s/30s）；
 * - sha256 校验失败 ⇒ 删除坏包并提示重新下载（不重试）；检查/下载都单飞。
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isNewerManifest,
  parseUpdateManifest,
  pickAsset,
  UPDATE_MANIFEST_URL,
  type UpdateArch,
  type UpdateAsset,
  type UpdateManifest,
  type UpdateOs,
} from "../../src/core/update/updateManifest.js";
import {
  applyUpdateSettingsPatch,
  normalizeUpdateSettings,
  type UpdateSettings,
  type UpdateSettingsPatch,
  type UpdateState,
  type UpdateStatus,
} from "../../src/core/update/updateTypes.js";

/** 下载失败重试间隔（spec §5：2s / 8s / 30s，即最多重试 3 次）。 */
export const UPDATE_DOWNLOAD_RETRY_DELAYS_MS = [2000, 8000, 30000] as const;
const FETCH_TIMEOUT_MS = 30_000;
/** 启动后首次自动检查延迟：给首屏/首次同步让路（AGENTS §7#18「后台工作排到首屏之后」）。 */
const DEFAULT_STARTUP_CHECK_DELAY_MS = 10_000;

/** 校验失败（sha256 / 大小不符）：重试也不会变好，直接失败。 */
export class UpdateChecksumError extends Error {}

export interface UpdateHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  /** 下载响应的字节流（Web ReadableStream 在 Node 24 可直接 for-await）。 */
  body?: AsyncIterable<Uint8Array> | null;
}

/** 下载落盘 IO 端口（生产 = node:fs；测试 = 内存实现）。 */
export interface UpdateDownloadIo {
  ensureDir(dir: string): Promise<void>;
  openWrite(file: string): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }>;
  rename(from: string, to: string): Promise<void>;
  remove(file: string): Promise<void>;
  exists(file: string): Promise<boolean>;
  readText(file: string): Promise<string | null>;
  writeText(file: string, text: string): Promise<void>;
}

export interface UpdateSha256 {
  update(chunk: Uint8Array): void;
  digestHex(): string;
}

export interface UpdateServiceDeps {
  userData: string;
  currentVersion: string;
  /** process.platform（注入便于单测；不直接读全局）。 */
  platform: string;
  /** process.arch。 */
  arch: string;
  settings: {
    get(): UpdateSettings;
    save(settings: UpdateSettings): UpdateSettings;
  };
  fetchImpl?: (url: string) => Promise<UpdateHttpResponse>;
  io?: UpdateDownloadIo;
  createSha256?: () => UpdateSha256;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** 状态变化广播（主进程 → 所有窗口 + Web 客户端）。 */
  onState?: (state: UpdateState) => void;
  log?: { info(message: string): void; warn(message: string): void };
  startupCheckDelayMs?: number;
}

/**
 * 网络错误的**可操作说明**（261109 实测坑：VPN 开着时 undici 连接超时，界面上只显示
 * 裸的 "fetch failed"，既看不出原因、主进程也没留日志 —— 用户只能猜）。
 *
 * undici 把真实原因放在 `error.cause`（带 `code`）；按 code 翻译成人话 + 保留原始码便于排障。
 */
const NETWORK_HINTS: Record<string, string> = {
  ETIMEDOUT: "连接 GitHub 超时 · 请检查代理 / VPN 后重试",
  UND_ERR_CONNECT_TIMEOUT: "连接 GitHub 超时 · 请检查代理 / VPN 后重试",
  UND_ERR_HEADERS_TIMEOUT: "等待 GitHub 响应超时 · 请稍后重试",
  UND_ERR_BODY_TIMEOUT: "读取清单超时 · 请稍后重试",
  UND_ERR_SOCKET: "连接中断 · 请稍后重试",
  ENOTFOUND: "域名解析失败（DNS）· 请检查网络 / 代理",
  EAI_AGAIN: "DNS 暂时不可用 · 请稍后重试",
  ECONNREFUSED: "连接被拒绝（可能被代理 / 防火墙拦截）",
  ECONNRESET: "连接被重置 · 请稍后重试",
  EHOSTUNREACH: "网络不可达 · 请检查网络 / 代理",
  ENETUNREACH: "网络不可达 · 请检查网络 / 代理",
  CERT_HAS_EXPIRED: "HTTPS 证书已过期（检查本机时间）",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "HTTPS 证书链无法校验（代理可能在做中间人）",
  DEPTH_ZERO_SELF_SIGNED_CERT: "HTTPS 证书链无法校验（代理可能在做中间人）",
  SELF_SIGNED_CERT_IN_CHAIN: "HTTPS 证书链无法校验（代理可能在做中间人）",
  ERR_TLS_CERT_ALTNAME_INVALID: "HTTPS 证书与域名不匹配（代理可能在做中间人）",
};

function errorCodeOf(error: unknown): string | null {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : null;
  const direct = (error as { code?: unknown } | null)?.code;
  const fromCause = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : null;
  const code = typeof fromCause === "string" ? fromCause : typeof direct === "string" ? direct : null;
  return code;
}

function describeError(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : String(error);
  if (error instanceof Error && error.name === "TimeoutError") return "请求超时 · 请检查网络后重试";
  const code = errorCodeOf(error);
  const hint = code ? NETWORK_HINTS[code] : undefined;
  if (hint) return code ? hint + "（" + code + "）" : hint;
  return code && !message.includes(code) ? message + "（" + code + "）" : message;
}

/** 清单里的 filename 只允许纯文件名（禁止路径穿越）。 */
export function safeAssetFilename(filename: string): string {
  const base = path.basename(filename);
  if (!base || base === "." || base === ".." || base !== filename || base.includes("\0")) {
    throw new Error("安装包文件名非法");
  }
  return base;
}

function defaultFetch(url: string): Promise<UpdateHttpResponse> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((response) => ({
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    body: response.body as unknown as AsyncIterable<Uint8Array> | null,
  }));
}

const nodeIo: UpdateDownloadIo = {
  ensureDir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
  async openWrite(file) {
    const stream = createWriteStream(file);
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    return {
      write: (chunk) => new Promise<void>((resolve, reject) => {
        stream.once("error", reject);
        if (stream.write(chunk)) resolve();
        else stream.once("drain", () => resolve());
      }),
      close: () => new Promise<void>((resolve, reject) => {
        stream.once("error", reject);
        stream.end(() => resolve());
      }),
    };
  },
  rename: (from, to) => rename(from, to),
  remove: (file) => rm(file, { force: true }),
  exists: (file) => stat(file).then(() => true).catch(() => false),
  readText: (file) => readFile(file, "utf8").catch(() => null),
  writeText: (file, text) => writeFile(file, text, "utf8"),
};

function nodeSha256(): UpdateSha256 {
  const hash = createHash("sha256");
  return { update: (chunk) => hash.update(chunk), digestHex: () => hash.digest("hex") };
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps;
  private readonly fetchImpl: (url: string) => Promise<UpdateHttpResponse>;
  private readonly io: UpdateDownloadIo;
  private readonly sha256: () => UpdateSha256;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startupCheckDelayMs: number;
  private readonly downloadsDir: string;
  private readonly metaPath: string;

  private settings: UpdateSettings;
  private state: UpdateState;
  private checkInFlight: Promise<UpdateState> | null = null;
  /** 本轮检查开始前的状态（失败时「保留旧状态」用；显式声明类型避免 TS 把字面量收窄）。 */
  private statusBeforeCheck: UpdateStatus = "idle";
  private downloadInFlight: Promise<UpdateState> | null = null;
  private started = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? defaultFetch;
    this.io = deps.io ?? nodeIo;
    this.sha256 = deps.createSha256 ?? nodeSha256;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.startupCheckDelayMs = deps.startupCheckDelayMs ?? DEFAULT_STARTUP_CHECK_DELAY_MS;
    this.downloadsDir = path.join(deps.userData, "updates");
    this.metaPath = path.join(this.downloadsDir, "downloaded.json");
    this.settings = normalizeUpdateSettings(deps.settings.get());
    this.state = {
      status: "idle",
      currentVersion: deps.currentVersion,
      lastCheckAt: null,
      lastCheckWasAuto: false,
      lastError: null,
      manifest: null,
      asset: null,
      ignored: false,
      progress: null,
      downloadedPath: null,
      settings: { ...this.settings },
    };
  }

  /** 当前状态快照（IPC 返回 / 事件负载同形，纯 JSON）。 */
  getState(): UpdateState {
    return {
      ...this.state,
      settings: { ...this.settings },
      progress: this.state.progress ? { ...this.state.progress } : null,
    };
  }

  getSettings(): UpdateSettings {
    return { ...this.settings };
  }

  /** 保存设置；频率变化会重排定时器。返回保存后的设置（已归一化）。 */
  setSettings(patch: UpdateSettingsPatch): UpdateSettings {
    const next = applyUpdateSettingsPatch(this.settings, patch ?? {});
    this.settings = this.deps.settings.save(next);
    this.state.settings = { ...this.settings };
    if (this.state.manifest) this.state.ignored = this.settings.ignoredVersion === this.state.manifest.version;
    this.rescheduleTimers();
    this.emit();
    return this.getSettings();
  }

  /** 忽略当前检测到的版本（只能忽略当前清单里的版本）。 */
  ignoreVersion(version: string): UpdateState {
    if (typeof version !== "string" || version.trim().length === 0) throw new Error("版本号无效");
    const current = this.state.manifest?.version;
    if (!current) throw new Error("当前没有可忽略的更新");
    if (version.trim() !== current) throw new Error("只能忽略当前检测到的新版本");
    this.setSettings({ ignoredVersion: current });
    return this.getState();
  }

  /** 启动调度：恢复「已下载未安装」状态 + 启动后延迟一次 + 每 N 小时。幂等。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.restoreDownloadedState();
    if (this.settings.autoCheck && this.settings.checkIntervalHours > 0) {
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        void this.check({ manual: false }).catch(() => undefined);
      }, this.startupCheckDelayMs);
      this.startupTimer.unref?.();
    }
    this.rescheduleTimers();
  }

  stop(): void {
    this.started = false;
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
  }

  private rescheduleTimers(): void {
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
    if (!this.started) return;
    if (!this.settings.autoCheck || this.settings.checkIntervalHours <= 0) {
      if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
      return;
    }
    this.intervalTimer = setInterval(() => {
      void this.check({ manual: false }).catch(() => undefined);
    }, this.settings.checkIntervalHours * 3600 * 1000);
    this.intervalTimer.unref?.();
  }

  /** 检查更新（单飞；manual=true 时不算「自动检查」，不触发每版本自动弹窗）。 */
  check(options: { manual?: boolean } = {}): Promise<UpdateState> {
    if (this.checkInFlight) return this.checkInFlight;
    this.checkInFlight = this.runCheck(!options.manual).finally(() => { this.checkInFlight = null; });
    return this.checkInFlight;
  }

  private async runCheck(wasAuto: boolean): Promise<UpdateState> {
    this.statusBeforeCheck = this.state.status;
    this.state.status = "checking";
    this.state.lastError = null;
    this.state.lastCheckWasAuto = wasAuto;
    this.emit();
    this.state.lastCheckAt = this.now().toISOString();

    let manifest: UpdateManifest;
    try {
      const response = await this.fetchImpl(UPDATE_MANIFEST_URL);
      if (!response.ok) throw new Error("检查更新失败（HTTP " + response.status + "）");
      let raw: unknown;
      try { raw = JSON.parse(await response.text()); } catch { throw new Error("更新清单不是合法 JSON"); }
      manifest = parseUpdateManifest(raw);
    } catch (error) {
      // 网络失败/404/坏清单：只提示失败，保留旧状态（available/downloading/downloaded 不被清掉）。
      this.state.lastError = describeError(error);
      // 261109：失败必须留日志（此前只有 IPC 慢调用告警，现场无法复盘）。
      this.deps.log?.warn("[update] 检查更新失败：" + this.state.lastError);
      const keep: UpdateStatus[] = ["available", "downloading", "downloaded"];
      this.state.status = keep.includes(this.statusBeforeCheck) ? this.statusBeforeCheck : "error";
      this.emit();
      return this.getState();
    }

    if (!isNewerManifest(manifest, { version: this.deps.currentVersion })) {
      this.state.status = "up-to-date";
      this.state.manifest = null;
      this.state.asset = null;
      this.state.ignored = false;
      this.state.progress = null;
      this.state.downloadedPath = null;
      this.state.lastError = null;
      this.emit();
      return this.getState();
    }

    const os = this.platformOs();
    const asset = os ? pickAsset(manifest, os, this.platformArch()) : null;
    if (!asset) {
      this.state.lastError = "没有适用于当前系统的安装包";
      this.state.status = "error";
      this.state.manifest = null;
      this.state.asset = null;
      this.emit();
      return this.getState();
    }

    const sameVersion = this.state.manifest?.version === manifest.version;
    const keepDownloading = sameVersion && this.statusBeforeCheck === "downloading";
    const alreadyDownloaded = sameVersion && this.statusBeforeCheck === "downloaded";
    this.state.manifest = manifest;
    this.state.asset = asset;
    this.state.ignored = this.settings.ignoredVersion === manifest.version;
    this.state.lastError = null;
    if (!keepDownloading && !alreadyDownloaded) this.state.status = "available";
    this.emit();

    // 261109 用户定稿：**手动检查只提示、绝不自动下载**（手动 = 用户自己决定何时下、从哪下）；
    // 只有后台/启动的自动检查才按「自动下载」设置后台拉包。
    if (wasAuto && !this.state.ignored && this.settings.autoDownload && !keepDownloading && !alreadyDownloaded) {
      // 自动下载失败只记状态（download 内部已 emit+记录），不向调度器抛。
      void this.download().catch(() => undefined);
    }
    return this.getState();
  }

  /** 下载当前检测到的安装包（单飞）。成功后状态 = downloaded，供 UI「打开安装包」。 */
  download(): Promise<UpdateState> {
    if (this.downloadInFlight) return this.downloadInFlight;
    this.downloadInFlight = this.runDownload().finally(() => { this.downloadInFlight = null; });
    return this.downloadInFlight;
  }

  private async runDownload(): Promise<UpdateState> {
    const manifest = this.state.manifest;
    const asset = this.state.asset;
    if (!manifest || !asset) throw new Error("没有可下载的更新");
    if (this.state.ignored) throw new Error("该版本已被忽略，不再自动下载");
    try {
      if (this.state.status === "downloaded" && this.state.downloadedPath && await this.io.exists(this.state.downloadedPath)) {
        return this.getState();
      }
      await this.io.ensureDir(this.downloadsDir);
      const target = path.join(this.downloadsDir, safeAssetFilename(asset.filename));
      this.state.status = "downloading";
      this.state.progress = { received: 0, total: asset.size };
      this.state.lastError = null;
      this.emit();
      await this.transferWithRetry(asset, target);
      this.state.status = "downloaded";
      this.state.downloadedPath = target;
      this.state.progress = { received: asset.size, total: asset.size };
      this.state.lastError = null;
      await this.io.writeText(this.metaPath, JSON.stringify({ manifest, filename: asset.filename })).catch(() => undefined);
      this.emit();
      this.deps.log?.info("[update] 已下载 " + manifest.version + " → " + target);
      return this.getState();
    } catch (error) {
      this.state.lastError = describeError(error);
      this.state.progress = null;
      this.state.status = this.state.manifest ? "available" : "error";
      this.emit();
      this.deps.log?.warn("[update] 下载失败：" + describeError(error));
      throw error;
    }
  }

  private async transferWithRetry(asset: UpdateAsset, target: string): Promise<void> {
    const part = target + ".part";
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= UPDATE_DOWNLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await this.sleep(UPDATE_DOWNLOAD_RETRY_DELAYS_MS[attempt - 1]!);
      try {
        await this.transfer(asset, part);
        await this.io.rename(part, target);
        return;
      } catch (error) {
        lastError = error;
        await this.io.remove(part).catch(() => undefined);
        // 校验失败重试无意义（spec §5：删除坏包 + 提示重新下载）。
        if (error instanceof UpdateChecksumError) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async transfer(asset: UpdateAsset, part: string): Promise<void> {
    const response = await this.fetchImpl(asset.url);
    if (!response.ok) throw new Error("下载失败（HTTP " + response.status + "）");
    if (!response.body) throw new Error("下载响应为空");
    const hasher = this.sha256();
    const sink = await this.io.openWrite(part);
    let received = 0;
    let lastReported = 0;
    try {
      for await (const chunk of response.body) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as unknown as ArrayBufferLike);
        received += bytes.byteLength;
        hasher.update(bytes);
        await sink.write(bytes);
        this.reportProgress(received, asset.size, lastReported);
        lastReported = received;
      }
      await sink.close();
    } catch (error) {
      await Promise.resolve(sink.close()).catch(() => undefined);
      throw error;
    }
    const digest = hasher.digestHex().toLowerCase();
    if (digest !== asset.sha256.toLowerCase()) throw new UpdateChecksumError("安装包校验失败（sha256 不匹配），已删除");
    if (received !== asset.size) throw new UpdateChecksumError("安装包大小不符（下载 " + received + " / 清单 " + asset.size + " 字节）");
  }

  /** 进度事件节流：每 1% 或每 256KiB 一次（下载大包时避免 IPC 刷屏）。 */
  private reportProgress(received: number, total: number, lastReported: number): void {
    const step = Math.max(256 * 1024, Math.floor(total / 100));
    if (received !== total && received - lastReported < step) return;
    this.state.progress = { received, total };
    this.emit();
  }

  /** 重启后恢复「已下载未安装」：downloaded.json + 安装包都在 ⇒ 直接是 downloaded。 */
  private async restoreDownloadedState(): Promise<void> {
    try {
      const raw = await this.io.readText(this.metaPath);
      if (!raw) return;
      const meta = JSON.parse(raw) as { manifest?: unknown; filename?: unknown };
      if (typeof meta.filename !== "string") return;
      const manifest = parseUpdateManifest(meta.manifest);
      const os = this.platformOs();
      const asset = os ? pickAsset(manifest, os, this.platformArch()) : null;
      if (!asset || asset.filename !== meta.filename) return;
      if (!isNewerManifest(manifest, { version: this.deps.currentVersion })) return;
      const target = path.join(this.downloadsDir, safeAssetFilename(asset.filename));
      if (!(await this.io.exists(target))) return;
      this.state.manifest = manifest;
      this.state.asset = asset;
      this.state.ignored = this.settings.ignoredVersion === manifest.version;
      this.state.status = "downloaded";
      this.state.downloadedPath = target;
      this.state.progress = { received: asset.size, total: asset.size };
      this.emit();
    } catch {
      // 坏 meta / 坏清单：忽略（下次检查会重建状态），不阻断启动。
    }
  }

  private platformOs(): UpdateOs | null {
    if (this.deps.platform === "darwin") return "macos";
    if (this.deps.platform === "win32") return "windows";
    return null;
  }

  private platformArch(): UpdateArch | null {
    if (this.deps.arch === "arm64") return "arm64";
    if (this.deps.arch === "x64") return "x64";
    return null;
  }

  private emit(): void {
    this.deps.onState?.(this.getState());
  }
}

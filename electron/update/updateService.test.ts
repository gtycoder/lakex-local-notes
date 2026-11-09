import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UpdateChecksumError, UpdateService, type UpdateDownloadIo, type UpdateHttpResponse, type UpdateServiceDeps } from "./updateService.js";
import { normalizeUpdateSettings, type UpdateSettings } from "../../src/core/update/updateTypes.js";

const CONTENT = new TextEncoder().encode("hello");
const SHA_HELLO = createHash("sha256").update(CONTENT).digest("hex");

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: "1.0.5",
    versionCode: 11005,
    publishedAt: "2026-11-09T00:00:00Z",
    notes: "## 更新\n- 修复",
    releasePageUrl: "https://github.com/gtycoder/lakex-local-notes/releases/tag/v1.0.5",
    assets: [
      { os: "macos", arch: "arm64", filename: "LakexLocalNotes-1.0.5-arm64.dmg", url: "https://example.com/a.dmg", sha256: SHA_HELLO, size: CONTENT.byteLength },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): UpdateHttpResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function bytesResponse(chunks: Uint8Array[]): UpdateHttpResponse {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    body: (async function* () { for (const chunk of chunks) yield chunk; })(),
  };
}

function statusResponse(status: number): UpdateHttpResponse {
  return { ok: false, status, text: async () => "" };
}

class MemoryIo implements UpdateDownloadIo {
  files = new Map<string, Uint8Array[]>();
  dirs = new Set<string>();
  removed: string[] = [];
  async ensureDir(dir: string): Promise<void> { this.dirs.add(dir); }
  async openWrite(file: string) {
    const chunks: Uint8Array[] = [];
    this.files.set(file, chunks);
    return {
      write: async (chunk: Uint8Array) => { chunks.push(chunk); },
      close: async () => undefined,
    };
  }
  async rename(from: string, to: string): Promise<void> {
    const chunks = this.files.get(from);
    if (!chunks) throw new Error("ENOENT " + from);
    this.files.delete(from);
    this.files.set(to, chunks);
  }
  async remove(file: string): Promise<void> { this.removed.push(file); this.files.delete(file); }
  async exists(file: string): Promise<boolean> { return this.files.has(file) || this.dirs.has(file); }
  async readText(file: string): Promise<string | null> {
    const chunks = this.files.get(file);
    return chunks ? Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") : null;
  }
  async writeText(file: string, text: string): Promise<void> { this.files.set(file, [new TextEncoder().encode(text)]); }
  content(file: string): string {
    const chunks = this.files.get(file) ?? [];
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }
}

interface Harness {
  service: UpdateService;
  io: MemoryIo;
  calls: string[];
  sleeps: number[];
  states: Array<{ status: string; ignored: boolean }>;
}

function makeService(options: {
  fetchImpl: (url: string) => Promise<UpdateHttpResponse>;
  settings?: Partial<UpdateSettings>;
  platform?: string;
  arch?: string;
}): Harness {
  const io = new MemoryIo();
  const calls: string[] = [];
  const sleeps: number[] = [];
  const states: Array<{ status: string; ignored: boolean }> = [];
  const deps: UpdateServiceDeps = {
    userData: "/tmp/lake-update-test",
    currentVersion: "1.0.4",
    platform: options.platform ?? "darwin",
    arch: options.arch ?? "arm64",
    settings: {
      get: () => normalizeUpdateSettings({ autoDownload: false, ...options.settings }),
      save: (settings) => settings,
    },
    fetchImpl: async (url) => { calls.push(url); return options.fetchImpl(url); },
    io,
    createSha256: () => {
      const hash = createHash("sha256");
      return { update: (chunk) => hash.update(chunk), digestHex: () => hash.digest("hex") };
    },
    now: () => new Date("2026-11-09T00:00:00Z"),
    sleep: async (ms) => { sleeps.push(ms); },
    onState: (state) => { states.push({ status: state.status, ignored: state.ignored }); },
  };
  return { service: new UpdateService(deps), io, calls, sleeps, states };
}

describe("UpdateService", () => {
  it("检查成功：识别新版本并按平台选包（手动检查不算自动）", async () => {
    const h = makeService({ fetchImpl: async () => jsonResponse(manifest()) });
    const state = await h.service.check({ manual: true });
    expect(state.status).toBe("available");
    expect(state.manifest?.version).toBe("1.0.5");
    expect(state.asset?.filename).toBe("LakexLocalNotes-1.0.5-arm64.dmg");
    expect(state.lastCheckWasAuto).toBe(false);
    expect(state.lastCheckAt).not.toBeNull();
    expect(state.lastError).toBeNull();
    expect(h.calls).toEqual(["https://github.com/gtycoder/lakex-local-notes/releases/latest/download/latest.json"]);
  });

  it("检查失败（404）只提示失败，保留已检测到的可用状态", async () => {
    let mode: "ok" | "404" = "ok";
    const h = makeService({ fetchImpl: async () => (mode === "ok" ? jsonResponse(manifest()) : statusResponse(404)) });
    await h.service.check();
    mode = "404";
    const state = await h.service.check();
    expect(state.status).toBe("available");
    expect(state.lastError).toContain("HTTP 404");
    expect(state.manifest?.version).toBe("1.0.5");
  });

  it("坏清单（非法 JSON / 校验失败）⇒ error + 可读原因", async () => {
    const h = makeService({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not json", body: null }) });
    const badJson = await h.service.check();
    expect(badJson.status).toBe("error");
    expect(badJson.lastError).toContain("JSON");

    const invalid = makeService({ fetchImpl: async () => jsonResponse({ schemaVersion: 1, version: "1.0" }) });
    const badManifest = await invalid.service.check();
    expect(badManifest.status).toBe("error");
    expect(badManifest.lastError).toContain("version");
  });

  it("下载成功：写盘 + sha256 校验 + 记录 downloaded.json，重启后可恢复 downloaded", async () => {
    const h = makeService({ fetchImpl: async (url) => (url.endsWith(".dmg") ? bytesResponse([CONTENT.subarray(0, 2), CONTENT.subarray(2)]) : jsonResponse(manifest())) });
    await h.service.check();
    const state = await h.service.download();
    expect(state.status).toBe("downloaded");
    expect(state.downloadedPath).toContain("LakexLocalNotes-1.0.5-arm64.dmg");
    expect(h.io.content(state.downloadedPath!)).toBe("hello");
    expect(state.progress).toEqual({ received: CONTENT.byteLength, total: CONTENT.byteLength });

    // 同一 io 上新建服务（模拟重启）⇒ restoreDownloadedState 恢复 downloaded。
    const restarted = new UpdateService({
      userData: "/tmp/lake-update-test",
      currentVersion: "1.0.4",
      platform: "darwin",
      arch: "arm64",
      settings: { get: () => normalizeUpdateSettings({ autoDownload: false }), save: (s) => s },
      io: h.io,
      fetchImpl: async () => jsonResponse(manifest()),
      createSha256: () => ({ update: () => undefined, digestHex: () => SHA_HELLO }),
    });
    restarted.start();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restored = restarted.getState();
    expect(restored.status).toBe("downloaded");
    expect(restored.manifest?.version).toBe("1.0.5");
    restarted.stop();
  });

  it("坏 sha256：删除坏包、不重试、状态回到 available", async () => {
    const badSha = manifest({ assets: [{ os: "macos", arch: "arm64", filename: "a.dmg", url: "https://example.com/a.dmg", sha256: "a".repeat(64), size: CONTENT.byteLength }] });
    const h = makeService({ fetchImpl: async (url) => (url.endsWith(".dmg") ? bytesResponse([CONTENT]) : jsonResponse(badSha)) });
    await h.service.check();
    await expect(h.service.download()).rejects.toBeInstanceOf(UpdateChecksumError);
    const state = h.service.getState();
    expect(state.status).toBe("available");
    expect(state.lastError).toContain("校验失败");
    expect(h.io.files.size).toBe(0);
    // 清单 1 次 + 下载 1 次（校验失败不重试）
    expect(h.calls.filter((url) => url.endsWith(".dmg"))).toHaveLength(1);
  });

  it("下载失败重试：前两次断流、第三次成功（退避 2s/8s）", async () => {
    let attempts = 0;
    const h = makeService({
      fetchImpl: async (url) => {
        if (!url.endsWith(".dmg")) return jsonResponse(manifest());
        attempts += 1;
        if (attempts < 3) {
          return {
            ok: true,
            status: 200,
            text: async () => "",
            body: (async function* () { throw new Error("connection reset"); })(),
          };
        }
        return bytesResponse([CONTENT]);
      },
    });
    await h.service.check();
    const state = await h.service.download();
    expect(state.status).toBe("downloaded");
    expect(attempts).toBe(3);
    expect(h.sleeps).toEqual([2000, 8000]);
  });

  it("检查单飞：并发两次 check 只发一次清单请求", async () => {
    const h = makeService({ fetchImpl: async () => jsonResponse(manifest()) });
    await Promise.all([h.service.check(), h.service.check()]);
    expect(h.calls).toHaveLength(1);
  });

  it("忽略版本：不弹/不自动下载（ignored=true），清除忽略后恢复", async () => {
    let downloadCalls = 0;
    const h = makeService({
      fetchImpl: async (url) => {
        if (url.endsWith(".dmg")) { downloadCalls += 1; return bytesResponse([CONTENT]); }
        return jsonResponse(manifest());
      },
      settings: { ignoredVersion: "1.0.5", autoDownload: true },
    });
    const state = await h.service.check();
    expect(state.status).toBe("available");
    expect(state.ignored).toBe(true);
    expect(downloadCalls).toBe(0);
    // 清除忽略（下个版本恢复提示）
    h.service.setSettings({ ignoredVersion: "" });
    expect(h.service.getState().ignored).toBe(false);
  });

  it("不支持的平台 / 无匹配安装包 ⇒ error", async () => {
    const linux = makeService({ fetchImpl: async () => jsonResponse(manifest()), platform: "linux" });
    const state = await linux.service.check();
    expect(state.status).toBe("error");
    expect(state.lastError).toContain("当前系统");
  });

  it("已是最新 / 版本撤回（清单低于当前版本）不提示降级", async () => {
    const h = makeService({ fetchImpl: async () => jsonResponse(manifest({ version: "1.0.3", versionCode: 11003 })) });
    const state = await h.service.check();
    expect(state.status).toBe("up-to-date");
    expect(state.manifest).toBeNull();
  });

  it("设置归一化：非法频率回 24h，合法 0 保留", async () => {
    const h = makeService({ fetchImpl: async () => jsonResponse(manifest()) });
    expect(h.service.setSettings({ checkIntervalHours: 7 }).checkIntervalHours).toBe(24);
    expect(h.service.setSettings({ checkIntervalHours: 0 }).checkIntervalHours).toBe(0);
  });
});

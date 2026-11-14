import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceRepository } from "./resourceRepository";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface FetchOptions { timeoutMs: number; maxRedirects: number }
function makeRepo(fetcher: { fetch: (url: string, options: FetchOptions) => Promise<unknown> }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-resource-limits-"));
  tempRoots.push(root);
  return {
    root,
    repo: new ResourceRepository({
      noteAssetsDirFor: (noteId) => path.join(root, noteId),
      assetUrl: (noteId, filename) => "http://127.0.0.1:19876/" + noteId + "/" + filename,
      registerOrphan: () => undefined,
      fetcher: fetcher as unknown as ConstructorParameters<typeof ResourceRepository>[0]["fetcher"],
    }),
  };
}

const makeFetch = () => vi.fn(async (_url: string, _options: FetchOptions) => pngResponse());

function pngResponse() {
  return {
    status: 200,
    headers: {},
    body: (async function* () { yield PNG_1X1; })(),
    abort: () => undefined,
  };
}

describe("ResourceRepository.downloadRemote 预算（261114 粘贴图片收窄）", () => {
  it("调用方传 limits：用更短的超时且只尝试一次（不再叠加 3×30s）", async () => {
    const fetch = makeFetch();
    const { repo } = makeRepo({ fetch });
    const output = await repo.downloadRemote("https://cdn.example/a.png", "n1", { timeoutMs: 5000, maxAttempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 5000, maxRedirects: 5 });
    expect(output.url).toBe("http://127.0.0.1:19876/n1/" + output.filename);
    expect(output.mimeType).toBe("image/png");
  });

  it("不传 limits：保持默认预算（30s），调用方不会意外缩短别的下载路径", async () => {
    const fetch = makeFetch();
    const { repo } = makeRepo({ fetch });
    await repo.downloadRemote("https://cdn.example/b.png", "n1");
    expect(fetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 30_000 });
  });

  it("目标返回网页（防盗链/登录墙）→ 立刻失败并给可读原因，不把 HTML 当图片写盘", async () => {
    const fetch = vi.fn(async (_url: string, _options: FetchOptions) => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: (async function* () { yield Buffer.from("<html>blocked</html>"); })(),
      abort: () => undefined,
    }));
    const { root, repo } = makeRepo({ fetch });
    await expect(repo.downloadRemote("https://cdn.example/x.png", "n1", { timeoutMs: 5000, maxAttempts: 1 }))
      .rejects.toThrow(/网页而不是图片/);
    expect(fs.existsSync(path.join(root, "n1"))).toBe(false);
  });

  it("5xx 可重试：按 maxAttempts 用完才报错（临时服务端问题不立刻判失败）", async () => {
    const fetch = vi.fn(async (_url: string, _options: FetchOptions) => ({
      status: 503,
      headers: {},
      body: (async function* () { /* empty */ })(),
      abort: () => undefined,
    }));
    const { repo } = makeRepo({ fetch });
    await expect(repo.downloadRemote("https://cdn.example/e.png", "n1", { timeoutMs: 5000, maxAttempts: 3 }))
      .rejects.toThrow(/HTTP 503/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("404 属于永久失败：只尝试一次，不浪费重试预算", async () => {
    const fetch = vi.fn(async (_url: string, _options: FetchOptions) => ({
      status: 404,
      headers: {},
      body: (async function* () { /* empty */ })(),
      abort: () => undefined,
    }));
    const { repo } = makeRepo({ fetch });
    await expect(repo.downloadRemote("https://cdn.example/g.png", "n1", { timeoutMs: 5000, maxAttempts: 3 }))
      .rejects.toThrow(/不再重试/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("超范围的 limits 会被夹回安全区间（最少 1s，最多 60s）", async () => {
    const fetch = makeFetch();
    const { repo } = makeRepo({ fetch });
    await repo.downloadRemote("https://cdn.example/c.png", "n1", { timeoutMs: 10, maxAttempts: 1 });
    expect(fetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 1000 });
    fetch.mockClear();
    await repo.downloadRemote("https://cdn.example/d.png", "n1", { timeoutMs: 10_000_000, maxAttempts: 1 });
    expect(fetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 60_000 });
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./imageFormat", () => ({
  normalizeImageInput: (bytes: Uint8Array, filename: string) => ({ bytes, filename }),
  imageDataUrl: (input: { bytes: Uint8Array; filename: string }) => ({
    url: "data:image/png;base64,AAAA",
    resourceRef: "data:image/png;base64,AAAA",
    filename: input.filename,
    mimeType: "image/png",
    size: input.bytes.length,
  }),
}));

import { uploadLakeResource } from "./resourceUpload";

interface FakeWin {
  lakeNative?: unknown;
  Capacitor?: { isNativePlatform?: () => boolean };
}

const fakeWin = () => window as unknown as FakeWin;
const PNG = new Uint8Array([1, 2, 3]);

function stubImageResponse() {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })
  ));
}

beforeEach(() => {
  delete fakeWin().lakeNative;
  delete fakeWin().Capacitor;
  vi.unstubAllGlobals();
});

describe("外链图片上传：移动端落盘 vs 纯 web 内嵌", () => {
  it("移动端（Capacitor 原生）→ 下载后交 native.uploadResource，不内嵌 data URL", async () => {
    const uploadResource = vi.fn(async (_input: { bytes: Uint8Array; filename: string }, _noteId: string) => ({
      url: "http://127.0.0.1:19876/n1/asset.png",
      resourceRef: "http://127.0.0.1:19876/n1/asset.png",
      filename: "asset.png",
      mimeType: "image/png",
      size: 3,
    }));
    fakeWin().lakeNative = { uploadResource };
    fakeWin().Capacitor = { isNativePlatform: () => true };
    stubImageResponse();

    const out = await uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1");

    expect(uploadResource).toHaveBeenCalledTimes(1);
    expect(uploadResource.mock.calls[0][1]).toBe("n1");
    expect(out.resourceRef).toContain("/n1/asset.png");
    expect(out.url.startsWith("data:")).toBe(false);
  });

  it("移动端新 APK：走原生 downloadRemoteAsset（字节不过桥，不 fetch、不再 uploadResource）", async () => {
    const downloadRemoteAsset = vi.fn(async (_url: string, _noteId: string, _limits?: unknown) => ({
      url: "http://127.0.0.1:19876/n1/native.png",
      resourceRef: "http://127.0.0.1:19876/n1/native.png",
      filename: "native.png",
      mimeType: "image/png",
      size: 9,
    }));
    const uploadResource = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fakeWin().lakeNative = { uploadResource, downloadRemoteAsset };
    fakeWin().Capacitor = { isNativePlatform: () => true };

    const out = await uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1", {
      downloadLimits: { timeoutMs: 15_000, maxAttempts: 3 },
    });

    expect(downloadRemoteAsset).toHaveBeenCalledTimes(1);
    expect(downloadRemoteAsset.mock.calls[0][0]).toBe("https://example.com/pic.png");
    expect(downloadRemoteAsset.mock.calls[0][1]).toBe("n1");
    expect(downloadRemoteAsset.mock.calls[0][2]).toMatchObject({ timeoutMs: 15_000, maxAttempts: 3 });
    expect(uploadResource).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.resourceRef).toContain("/n1/native.png");
  });

  it("纯 web 演示：无原生桥 → 内嵌 data URL", async () => {
    stubImageResponse();
    const out = await uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1");
    expect(out.url.startsWith("data:image/png")).toBe(true);
  });

  it("临时失败（5xx）会重试，第 2 次成功后正常落盘（不一次失败就判死刑）", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("temporary", { status: 503, headers: { "content-type": "text/plain" } });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }));
    const uploadResource = vi.fn(async (_input: { bytes: Uint8Array; filename: string }, _noteId: string) => ({
      url: "http://127.0.0.1:19876/n1/retry.png",
      resourceRef: "http://127.0.0.1:19876/n1/retry.png",
      filename: "retry.png",
      mimeType: "image/png",
      size: 3,
    }));
    fakeWin().lakeNative = { uploadResource };
    fakeWin().Capacitor = { isNativePlatform: () => true };
    const out = await uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1");
    expect(calls).toBe(2);
    expect(out.resourceRef).toContain("/n1/retry.png");
  });

  it("目标返回网页（防盗链/登录墙）→ 永久失败且不重试", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return new Response("<html>blocked</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }));
    await expect(uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1"))
      .rejects.toThrow(/网页而不是图片/);
    expect(calls).toBe(1);
  });
});

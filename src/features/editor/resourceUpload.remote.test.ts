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

  it("纯 web 演示：无原生桥 → 内嵌 data URL", async () => {
    stubImageResponse();
    const out = await uploadLakeResource({ type: "url", data: "https://example.com/pic.png" }, "n1");
    expect(out.url.startsWith("data:image/png")).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { addAssetAccessToken, stripAssetAccessToken } from "./assetPort";

afterEach(() => {
  vi.resetModules();
  if ("window" in globalThis) delete (globalThis as { window?: unknown }).window;
});

describe("asset access token rewriting", () => {
  it("keeps persisted content token-free while adding a runtime token", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { lakeNative: { assetPort: 19876, assetToken: "runtime-secret" } },
    });
    vi.resetModules();
    const runtimeAssetPort = await import("./assetPort");
    const content = '<p><img src="http://127.0.0.1:19876/note/image.webp?date=1"></p> and https://example.test/a.png';
    const runtime = runtimeAssetPort.addAssetAccessToken(content);

    expect(runtime).toContain("token=runtime-secret");
    expect(runtimeAssetPort.stripAssetAccessToken(runtime)).toBe(content);
  });

  it("does not rewrite external URLs", () => {
    const content = "![x](https://example.test/image.png)";
    expect(addAssetAccessToken(content)).toBe(content);
    expect(stripAssetAccessToken(content)).toBe(content);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bridge", () => ({
  bridge: {
    getAssetBytes: vi.fn(() => new Uint8Array([137, 80, 78, 71])),
  },
}));
vi.mock("./cachePort.js", () => ({
  registerRuntimeBlob: vi.fn(),
  unregisterRuntimeBlob: vi.fn(),
}));
// cardBlobInject 引用 lakeRuntime（加载 lakex 编辑器，node 环境会崩）——仅需 lakeBridge 桩
vi.mock("../features/editor/lakeRuntime.js", () => ({
  lakeBridge: vi.fn(() => ({ renderer: null })),
}));

import { injectAssetBlobs } from "./blobInject.js";
import { createCardBlobInjector } from "./cardBlobInject.js";

const CANONICAL = "http://127.0.0.1:19876/note-1/17877322062846_ffb54fbf.png";
const FAKE_BLOB = "blob:https://localhost/10002f23-d394-4df9-bb95-48aac08c57d6";

// node 内置 URL.createObjectURL 生成的 URL 形态与 WebView 不同；mock 成确定性值，
// 使 blobToCanonical 映射的 key 可预测（保存还原必须精确命中注入时创建的 blob URL）。
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => FAKE_BLOB);
});

describe("移动端 blob 保存还原（显示层 blob，保存 canonical——污染回归）", () => {
  it("blobInject.restore：明文 blob（含 ?date= 后缀）还原为 canonical", () => {
    const { restore } = injectAssetBlobs(`<img src="${CANONICAL}">`);
    const dirty = `<img src="${FAKE_BLOB}?date=123">`;
    const restored = restore(dirty);
    expect(restored).toContain(`src="${CANONICAL}"`);
    expect(restored).not.toContain("blob");
  });

  it("blobInject.restore：card value 内 URI 编码的 blob 还原为编码 canonical（污染根因）", () => {
    const { restore } = injectAssetBlobs(`<card name="image" value="data:${encodeURIComponent(JSON.stringify({ src: CANONICAL }))}"></card>`);
    const encodedBlob = encodeURIComponent(JSON.stringify({ src: FAKE_BLOB, originalType: "binary" }));
    const dirty = `<card name="image" value="data:${encodedBlob}"></card>`;
    const restored = restore(dirty);
    expect(restored).not.toContain("blob");
    // 还原后 src 是编码 canonical（其余字段如 originalType 保留）
    expect(restored).toContain(encodeURIComponent(CANONICAL));
    expect(restored).not.toContain("blob%3A");
  });

  it("cardBlobInject.restore：编码 blob 还原（不残留 blob 污染存储）", () => {
    const injector = createCardBlobInjector(`<card name="image" value="data:${encodeURIComponent(JSON.stringify({ src: CANONICAL }))}"></card>`);
    const encodedBlob = encodeURIComponent(JSON.stringify({ src: FAKE_BLOB }));
    const restored = injector.restore(`<card name="image" value="data:${encodedBlob}"></card>`);
    expect(restored).not.toContain("blob");
    expect(restored).toContain(encodeURIComponent(CANONICAL));
    injector.revoke();
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMissingAssetPlaceholders,
  restoreMissingAssets,
  MISSING_ASSET_CLASS,
} from "./missingAssetPlaceholder.js";

const NOTE_SRC = "http://127.0.0.1:19876/note-1/a.png?w=512";
const QUICK_SRC = "http://127.0.0.1:19876/quick-notes/q1/b.png";

beforeEach(() => { document.body.innerHTML = ""; });

function makeImg(src: string): HTMLImageElement {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  document.body.appendChild(img);
  return img;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("按需资产占位（261027）", () => {
  it("本地资产加载失败 → 标记占位并写 alt（不识别外链/纯坏链）", () => {
    const uninstall = installMissingAssetPlaceholders(document, { download: async () => ({ downloaded: 0, failed: 0 }) });
    try {
      const img = makeImg(NOTE_SRC);
      img.dispatchEvent(new Event("error"));
      expect(img.classList.contains(MISSING_ASSET_CLASS)).toBe(true);
      expect(img.getAttribute("alt")).toContain("图片未下载");
      expect(img.getAttribute("data-mb-missing-key")).toBe("note-1");

      const external = makeImg("https://cdn.example.com/x.png");
      external.dispatchEvent(new Event("error"));
      expect(external.classList.contains(MISSING_ASSET_CLASS)).toBe(false);
    } finally { uninstall(); }
  });

  it("点击占位图 → 按空间补拉对应条目，成功后恢复真实 src（带 cache-bust）", async () => {
    const seen: Array<Array<{ space: string; noteId: string }>> = [];
    const download = vi.fn(async (refs: Array<{ space: string; noteId: string }>) => { seen.push(refs); return { downloaded: 1, failed: 0 }; });
    const uninstall = installMissingAssetPlaceholders(document, { download });
    try {
      const img = makeImg(QUICK_SRC);
      img.dispatchEvent(new Event("error"));
      expect(img.getAttribute("data-mb-missing-key")).toBe("quick-notes/q1");

      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
      expect(download).toHaveBeenCalledTimes(1);
      expect(seen[0]?.[0]).toMatchObject({ space: "quick-notes", noteId: "q1" });

      expect(img.classList.contains(MISSING_ASSET_CLASS)).toBe(false);
      expect(img.getAttribute("src")).toMatch(/^http:\/\/127\.0\.0\.1:19876\/quick-notes\/q1\/b\.png\?r=\d+$/);
    } finally { uninstall(); }
  });

  it("补拉返回 0（离线/未配置）→ 保留占位并提示", async () => {
    const download = vi.fn(async () => ({ downloaded: 0, failed: 0 }));
    const showToast = vi.fn();
    const uninstall = installMissingAssetPlaceholders(document, { download, showToast });
    try {
      const img = makeImg(NOTE_SRC);
      img.dispatchEvent(new Event("error"));
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("图片暂未下载"), "error");
      expect(img.classList.contains(MISSING_ASSET_CLASS)).toBe(true);
    } finally { uninstall(); }
  });

  it("恢复只影响同一条目：同 key 的占位图一起恢复，其它条目不变量", async () => {
    const uninstall = installMissingAssetPlaceholders(document, { download: async () => ({ downloaded: 2, failed: 0 }) });
    try {
      const a = makeImg(NOTE_SRC);
      const b = makeImg(NOTE_SRC);
      const other = makeImg("http://127.0.0.1:19876/note-2/c.png");
      for (const img of [a, b, other]) img.dispatchEvent(new Event("error"));
      expect(restoreMissingAssets(document, "note-1", 1234)).toBe(2);
      expect(a.getAttribute("src")).toContain("r=1234");
      expect(b.classList.contains(MISSING_ASSET_CLASS)).toBe(false);
      expect(other.classList.contains(MISSING_ASSET_CLASS)).toBe(true);
    } finally { uninstall(); }
  });

  it("卸载后不再标记", () => {
    const uninstall = installMissingAssetPlaceholders(document, { download: async () => ({ downloaded: 0, failed: 0 }) });
    uninstall();
    const img = makeImg(NOTE_SRC);
    img.dispatchEvent(new Event("error"));
    expect(img.classList.contains(MISSING_ASSET_CLASS)).toBe(false);
  });
});

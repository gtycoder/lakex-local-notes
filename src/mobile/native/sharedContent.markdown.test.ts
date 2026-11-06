// @vitest-environment jsdom
/**
 * 261106 task-86：分享 Markdown（SEND / SEND_MULTIPLE、冷热启动）接入。
 * 覆盖：manifest/intent 过滤器、原生插件分类（kind=markdown + displayName）、JS 分类与文件清单、
 * 文本读取（UTF-8，读成功才消费 inbox 文件）。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), deleteFile: vi.fn(), addListener: vi.fn(async () => ({ remove: vi.fn() })) }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    readFile: (...args: unknown[]) => mocks.readFile(...args),
    deleteFile: (...args: unknown[]) => mocks.deleteFile(...args),
  },
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8", ASCII: "ascii" },
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ consume: vi.fn(), addListener: mocks.addListener }) }));

import {
  isMarkdownMimeOrName,
  readSharedContentText,
  sharedContentKind,
  sharedContentUnsupportedHint,
  sharedMarkdownFiles,
} from "./sharedContent";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

beforeEach(() => {
  mocks.readFile.mockReset();
  mocks.deleteFile.mockReset();
  mocks.deleteFile.mockResolvedValue(undefined);
});

describe("Android 分享入口（261106 markdown）", () => {
  it("manifest 声明了 markdown 的 SEND 与 SEND_MULTIPLE", () => {
    const mf = read("../../../android/app/src/main/AndroidManifest.xml");
    expect(mf).toContain("android.intent.action.SEND_MULTIPLE");
    expect(mf).toMatch(/android:mimeType="text\/markdown"/);
    expect(mf).toMatch(/android:mimeType="text\/x-markdown"/);
  });

  it("插件支持 ACTION_SEND_MULTIPLE、markdown 分类、以及原始显示名（标题用）", () => {
    const kt = read("../../../android/app/src/main/java/com/lakexlocalnotes/android/SharedContentPlugin.kt");
    expect(kt).toContain("Intent.ACTION_SEND_MULTIPLE");
    expect(kt).toContain("KIND_MARKDOWN");
    expect(kt).toContain("displayName");
    expect(kt).toContain("\"files\"");
  });
});

describe("JS 分类与文件清单", () => {
  it("kind=markdown 优先；旧 APK 按 mime/后缀兜底（含 text/plain + .md）", () => {
    expect(sharedContentKind({ kind: "markdown", filename: "u.bin" })).toBe("markdown");
    expect(sharedContentKind({ filename: "u.bin", mimeType: "text/markdown" })).toBe("markdown");
    expect(sharedContentKind({ filename: "笔记.md" })).toBe("markdown");
    expect(sharedContentKind({ filename: "笔记.markdown" })).toBe("markdown");
    expect(sharedContentKind({ filename: "笔记.md", mimeType: "text/plain" })).toBe("markdown");
    expect(isMarkdownMimeOrName("text/x-markdown", "u.bin")).toBe(true);
    expect(isMarkdownMimeOrName("text/plain", "u.txt")).toBe(false);
  });

  it("markdown 不算「不支持」；pdf 仍走原提示（分流）", () => {
    expect(sharedContentUnsupportedHint({ filename: "a.md", mimeType: "text/markdown" })).toBeNull();
    expect(sharedContentUnsupportedHint({ filename: "a.bin", mimeType: "application/pdf" })).not.toBeNull();
  });

  it("多文件：只取 markdown 项，保留 displayName；单文件走旧字段", () => {
    const multi = sharedMarkdownFiles({
      files: [
        { filename: "u1.md", kind: "markdown", mimeType: "text/markdown", displayName: "第一篇.md" },
        { filename: "u2.pdf", kind: "pdf", mimeType: "application/pdf" },
        { filename: "u3.md", kind: "markdown", mimeType: "text/markdown", displayName: "第三篇.md" },
      ],
    });
    expect(multi).toEqual([
      { filename: "u1.md", mimeType: "text/markdown", displayName: "第一篇.md" },
      { filename: "u3.md", mimeType: "text/markdown", displayName: "第三篇.md" },
    ]);
    expect(sharedMarkdownFiles({ filename: "u9.md", mimeType: "text/markdown", displayName: "标题.md" }))
      .toEqual([{ filename: "u9.md", mimeType: "text/markdown", displayName: "标题.md" }]);
    expect(sharedMarkdownFiles({ filename: "a.pdf", mimeType: "application/pdf" })).toEqual([]);
  });
});

describe("readSharedContentText", () => {
  it("UTF-8 读 inbox 临时文件；读成功才删（消费语义）", async () => {
    mocks.readFile.mockResolvedValue({ data: "# 标题\n\n正文" });
    const text = await readSharedContentText("u1.md");
    expect(text).toBe("# 标题\n\n正文");
    expect(mocks.readFile).toHaveBeenCalledWith(expect.objectContaining({ path: "shared-inbox/u1.md", encoding: "utf8" }));
    expect(mocks.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: "shared-inbox/u1.md" }));
  });

  it("读失败/空内容 ⇒ null 且保留文件（可重试）", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("no such file"));
    expect(await readSharedContentText("u2.md")).toBeNull();
    expect(mocks.deleteFile).not.toHaveBeenCalled();

    mocks.readFile.mockResolvedValueOnce({ data: "" });
    expect(await readSharedContentText("u3.md")).toBeNull();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});

/**
 * 手写板 v2 图片页导入管线（纯逻辑）单测。
 *
 * 钉住四件事：
 * ① 超限（25 MiB / 5000 万像素）与坏图给逐文件错误，但**不影响其它文件成页**；
 * ② 上传结果必须是本笔记空间 canonical 本地资产 URL（外部 http / data / 小记空间一律拒绝写正文）；
 * ③ 成页 = A4（794×1123）+ fit=contain + 记录 pixelWidth/Height；
 * ④ 正文一定出现磁盘名（extractAssetRefs 可提取），缩略图走 ?w=256 低清档。
 */
import { describe, expect, it, vi } from "vitest";
import { extractAssetRefs } from "../../core/assetNaming.js";
import { localAssetHttpUrl, parseLocalAssetUrl } from "../../core/assetUrl.js";
import { INK_PAGE_HEIGHT, INK_PAGE_WIDTH, createInkDoc, inkToBody, type InkDoc } from "../../core/inkDoc.js";
import {
  INK_IMAGE_MAX_BYTES,
  INK_IMAGE_MAX_PIXELS,
  importInkImagePages,
  inkBackgroundImageFromUpload,
  inkImageImportError,
  inkImagePage,
  inkThumbUrl,
} from "./inkImageImport.js";

function fakeFile(name: string, size: number, bytes = new Uint8Array([1, 2, 3])): File {
  const file = new File([bytes], name, { type: "image/png" });
  // jsdom/node 的 File.size 由内容决定；这里只测校验分支，直接重定义 size 模拟大文件
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const ASSET_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.png");

describe("inkImageImportError", () => {
  it("体积/像素上限与坏图（复用 core 的 25 MiB / 5000 万像素事实源）", () => {
    expect(INK_IMAGE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(INK_IMAGE_MAX_PIXELS).toBe(50_000_000);
    expect(inkImageImportError(0, { pixelWidth: 1, pixelHeight: 1 })).toBe("图片为空");
    expect(inkImageImportError(INK_IMAGE_MAX_BYTES + 1, { pixelWidth: 1, pixelHeight: 1 })).toBe("超过 25 MiB 上限");
    expect(inkImageImportError(1024, null)).toContain("无法读取图片尺寸");
    expect(inkImageImportError(1024, { pixelWidth: 0, pixelHeight: 10 })).toContain("无法读取图片尺寸");
    expect(inkImageImportError(1024, { pixelWidth: 10_000, pixelHeight: 10_000 })).toBe("超过 5000 万像素上限");
    expect(inkImageImportError(1024, { pixelWidth: 1200, pixelHeight: 1600 })).toBeNull();
  });
});

describe("inkBackgroundImageFromUpload", () => {
  it("只接受本笔记空间 canonical 本地资产 URL；其它形态返回 null", () => {
    expect(inkBackgroundImageFromUpload({ url: ASSET_URL }, { pixelWidth: 1200, pixelHeight: 1600 })).toEqual({
      url: ASSET_URL,
      fit: "contain",
      pixelWidth: 1200,
      pixelHeight: 1600,
    });
    expect(parseLocalAssetUrl(ASSET_URL)?.space).toBe("note");
    expect(inkBackgroundImageFromUpload({ url: "https://example.com/a.png" }, { pixelWidth: 1, pixelHeight: 1 })).toBeNull();
    expect(inkBackgroundImageFromUpload({ url: "data:image/png;base64,AAAA" }, { pixelWidth: 1, pixelHeight: 1 })).toBeNull();
    expect(inkBackgroundImageFromUpload({ url: localAssetHttpUrl("q1", "1700000000000_abcdef12.png", { space: "quick-notes" }) }, null)).toBeNull();
  });
});

describe("inkImagePage / inkThumbUrl", () => {
  it("成页是 A4、fit=contain、带像素尺寸", () => {
    const page = inkImagePage({ url: ASSET_URL, fit: "contain", pixelWidth: 1200, pixelHeight: 1600 }, "p-img");
    expect(page).toMatchObject({ id: "p-img", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank" });
    expect(page.backgroundImage).toEqual({ url: ASSET_URL, fit: "contain", pixelWidth: 1200, pixelHeight: 1600 });
    expect(page.strokes).toEqual([]);
  });

  it("缩略图走资产服务的 ?w=256 低清档（N 张图页不整图解码）；非本地 URL 原样", () => {
    expect(inkThumbUrl(ASSET_URL)).toBe(ASSET_URL + "?w=256");
    expect(inkThumbUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
});

describe("importInkImagePages", () => {
  it("多选：每张成页、记录像素尺寸；正文带磁盘名可被 extractAssetRefs 提取", async () => {
    const files = [fakeFile("a.png", 1024), fakeFile("b.jpg", 2048)];
    const upload = vi.fn(async (input: { bytes: Uint8Array; filename: string }) => ({
      url: input.filename === "a.png" ? ASSET_URL : localAssetHttpUrl("note-1", "1700000000001_abcdef13.png"),
    }));
    const outcome = await importInkImagePages(files, {
      upload,
      probe: async (file) => (file.name === "a.png" ? { pixelWidth: 1200, pixelHeight: 1600 } : { pixelWidth: 800, pixelHeight: 600 }),
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.pages).toHaveLength(2);
    expect(outcome.pages.every((page) => page.width === INK_PAGE_WIDTH && page.height === INK_PAGE_HEIGHT)).toBe(true);
    expect(outcome.pages[0].backgroundImage).toMatchObject({ url: ASSET_URL, fit: "contain", pixelWidth: 1200, pixelHeight: 1600 });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][0].filename).toBe("a.png");
    expect(outcome.pages.every((page) => page.id.startsWith("page-"))).toBe(true);

    const doc: InkDoc = { ...createInkDoc("p0"), pages: [...createInkDoc("p0").pages, ...outcome.pages] };
    const refs = extractAssetRefs(inkToBody(doc));
    expect(refs.has("1700000000000_abcdef12.png")).toBe(true);
    expect(refs.has("1700000000001_abcdef13.png")).toBe(true);
  });

  it("单张超限/坏图/上传结果非法：给逐文件错误，其余文件照常成页", async () => {
    const files = [fakeFile("big.png", INK_IMAGE_MAX_BYTES + 1), fakeFile("ok.png", 1024), fakeFile("bad.png", 1024)];
    const outcome = await importInkImagePages(files, {
      upload: async (input) => (input.filename === "ok.png" ? { url: ASSET_URL } : { url: "https://example.com/x.png" }),
      probe: async (file) => (file.name === "bad.png" ? null : { pixelWidth: 640, pixelHeight: 480 }),
    });
    expect(outcome.pages).toHaveLength(1);
    expect(outcome.pages[0].backgroundImage?.url).toBe(ASSET_URL);
    expect(outcome.errors).toHaveLength(2);
    expect(outcome.errors[0]).toContain("big.png");
    expect(outcome.errors[0]).toContain("25 MiB");
    expect(outcome.errors[1]).toContain("bad.png");
  });

  it("上传抛错不打断其它文件（逐文件容错）", async () => {
    const files = [fakeFile("boom.png", 100), fakeFile("ok.png", 100)];
    const outcome = await importInkImagePages(files, {
      upload: async (input) => {
        if (input.filename === "boom.png") throw new Error("落盘失败");
        return { url: ASSET_URL };
      },
      probe: async () => ({ pixelWidth: 10, pixelHeight: 10 }),
    });
    expect(outcome.pages).toHaveLength(1);
    expect(outcome.errors[0]).toContain("boom.png");
    expect(outcome.errors[0]).toContain("落盘失败");
  });
});

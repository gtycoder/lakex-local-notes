import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetDisplayUrl, assetKindBucket, assetPreviewKind } from "./AssetsBrowser";

const SRC = readFileSync(new URL("./AssetsBrowser.tsx", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../styles/feature.css", import.meta.url), "utf8");
const SCROLL = readFileSync(new URL("../styles/app/settings.css", import.meta.url), "utf8");

/**
 * 设置 · 资源 的未引用资源浏览器（用户 261006 定稿）结构护栏：
 * 双栏、按文档分组、只留「清理选中」+ 全选、删除二次确认、预览类型全带。
 * 这是结构护栏，真实观感/交互由 CDP 真实验收覆盖。
 */
describe("未引用资源浏览器", () => {
  it("类型分桶与预览类型：MIME 优先、扩展名兜底（同一份 fileKindOf）", () => {
    expect(assetKindBucket("image")).toBe("image");
    expect(assetKindBucket("video")).toBe("media");
    expect(assetKindBucket("audio")).toBe("media");
    expect(assetKindBucket("pdf")).toBe("doc");
    expect(assetKindBucket("archive")).toBe("other");
    expect(assetKindBucket("file")).toBe("other");

    expect(assetPreviewKind({ filename: "a.png", mimeType: "image/png" })).toBe("image");
    expect(assetPreviewKind({ filename: "a.bin", mimeType: "video/mp4" })).toBe("video");
    expect(assetPreviewKind({ filename: "a.mp3", mimeType: "" })).toBe("audio");
    expect(assetPreviewKind({ filename: "报告.pdf", mimeType: "" })).toBe("pdf");
    expect(assetPreviewKind({ filename: "a.zip", mimeType: "" })).toBe("none");
  });

  it("预览直链走本地资产服务器：图片带 ?w= 档位、1:1 用原图", () => {
    const item = { noteId: "n1", filename: "a.png" };
    expect(assetDisplayUrl(item, 1024)).toContain("/n1/a.png");
    expect(assetDisplayUrl(item, 1024)).toContain("w=1024");
    const original = assetDisplayUrl(item, null);
    expect(original).toContain("/n1/a.png");
    expect(original).not.toContain("w=");
  });

  it("行 / 页签 / 空态全部复用 kit 原语，样式只加版面；不再带搜索框", () => {
    expect(SRC).toContain("ln-row asset-browser__row");
    expect(SRC).toContain("ln-iconbtn ln-iconbtn--compact");
    // 状态 = 三个大页签（kit 的分段控件 .seg，用户 261006 定稿：类似「未引用的资源文件/数据库/丢失的文件」那种）
    expect(SRC).toContain("b3-button b3-button--outline seg__item");
    expect(SRC).toContain("ln-tabs__count");
    expect(SRC).toContain('className="ln-empty"');
    // 用户 261006：去掉未引用资源的搜索框
    expect(SRC).not.toContain("ln-input__field");
    // 单栏上下分区（用户 261006）：上半列表自己滚、下半固定 1/3 高的纯预览
    expect(CSS).toContain(".asset-browser__status .seg__item");
    expect(CSS).toContain(".asset-browser__preview { flex: 0 0 33%");
    expect(CSS).toContain(".asset-browser__list { flex: 1 1 auto");
    expect(CSS).not.toContain(".settings-panel .asset-browser");
  });

  it("删除：只有可删项可勾选、逐条删、无「一键全清」、带二次确认", () => {
    expect(SRC).toContain("checked={selected.has(key)}");
    expect(SRC).toContain("native.deleteOrphanAsset(item.orphanId)");
    expect(SRC).not.toContain("cleanOrphanAssets");
    expect(SRC).toContain("pendingDelete && pendingDelete.length > 0");
    expect(SRC).toContain("全选可删");
  });

  it("「缺失」是一等分类（走主进程 fileMissing，非图片类型也准）；预览是纯内容", () => {
    expect(SRC).toContain("item.fileMissing === true");     // 分类与计数以主进程标志为准
    expect(SRC).toContain("文件缺失");                       // 行上红标
    expect(SRC).toContain("onError={() => markBroken(key)}"); // 缩略图仍留 onError 兜底
    expect(SRC).toContain("asset-browser__placeholder");      // 空/不支持/缺失：只给图标，不放字
    expect(SRC).not.toContain("asset-browser__meta");         // 预览区没有元信息与操作按钮
    expect(SRC).not.toContain("asset-browser__metacts");
  });

  it("设置面板不再自带旧实现；细滚动条选择器随类名收敛", () => {
    expect(PANEL).not.toContain("config-assets");
    expect(PANEL).toContain('<AssetsBrowser active={open && category === "resources"} />');
    expect(SCROLL).toContain(".asset-browser__list");
    expect(SCROLL).not.toContain("config-assets");
  });
});

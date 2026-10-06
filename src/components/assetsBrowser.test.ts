import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetDisplayUrl, assetKindBucket, assetPreviewKind } from "./AssetsBrowser";

const SRC = readFileSync(new URL("./AssetsBrowser.tsx", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../styles/feature.css", import.meta.url), "utf8");
const CHROME = readFileSync(new URL("../styles/chrome.css", import.meta.url), "utf8");
const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const SCROLL = readFileSync(new URL("../styles/app/settings.css", import.meta.url), "utf8");

/**
 * 资源空间（用户 261006：从设置里提出来、与回收站同级，套回收站版式）结构护栏：
 * 左 2/3 列表 / 右 1/3 纯预览、按文档分组、三分类页签、只留「清理选中」+ 全选、删除二次确认。
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
    // 分类页签走 kit 的横向页签原语 .ln-tabs（与回收站/历史面板同一套；用户 261006 定稿）
    expect(SRC).toContain("ln-tabs__item");
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain("ln-tabs__count");
    expect(SRC).toContain('className="ln-empty"');
    // 用户 261006：去掉未引用资源的搜索框
    expect(SRC).not.toContain("ln-input__field");
    // 版式宿主 = 与回收站同构的整页 pane：操作行 + 左 2/3 列表 / 右 1/3 纯预览
    expect(SRC).toContain('className="resources-space-pane"');
    expect(SRC).toContain("<SplitPane");
    expect(CHROME).toContain(".resources-space-pane > .history-split > .asset-browser__list { flex: 0 0 var(--split-left, 66%); }");
    expect(CSS).toContain(".asset-browser__preview { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr)");
    expect(CHROME).toContain(".resources-space-pane > .history-split > .asset-browser__preview { flex: 1 1 auto; }");
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
    expect(SRC).toContain('label: "缺失"');                  // 行上不再挂分类标签（页签已分类，用户 261006）
    expect(SRC).toContain("onError={onBroken}");                      // 预览媒体的 onError 兜底
    expect(SRC).toContain("onBroken={() => focusKey && markBroken(focusKey)}");
    expect(SRC).not.toContain("loading=\"lazy\"");                   // 行首不再渲染缩略图（用户 261006）
    expect(SRC).toContain("asset-browser__placeholder");      // 空/不支持/缺失：只给图标，不放字
    expect(SRC).not.toContain("asset-browser__meta");         // 预览区没有元信息与操作按钮
    expect(SRC).not.toContain("asset-browser__metacts");
  });

  it("已从设置里整项迁出：设置面板不再有「资源」分类，改由 App 挂到空间上", () => {
    expect(PANEL).not.toContain("config-assets");
    expect(PANEL).not.toContain("AssetsBrowser");            // 设置里没有它了
    expect(PANEL).not.toContain('"resources"');              // 分类与导航项一起删
    expect(APP).toContain('<AssetsBrowser active={desktopWorkspace === "resources"} />');
    expect(APP).toContain('desktopWorkspace === "resources" ? "resources-space-active"');
    expect(SCROLL).toContain(".asset-browser__list");
    expect(SCROLL).not.toContain("config-assets");
  });
});

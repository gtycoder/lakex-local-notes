// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachImagePreviewClick, closeImagePreview, subscribeImagePreview, type ImagePreviewState } from "./imagePreview";

/**
 * 261112 回归：文档图片预览的**画廊列表必须来自正文**，不是 DOM。
 *
 * 现场：107 张图的文档，桌面双击图片后预览显示「1 / 8」——只能说站视口内那几张。
 * 根因：桌面文档编辑器 = `EditorTab`（自己 createLakeDocument，不走 `LakeEditor` 组件），
 * 它调 `attachImagePreviewClick(host)` 时**没传 resolver** ⇒ 走 DOM 收集；而编辑态开了虚拟渲染 +
 * 卡片懒加载，DOM 里只有视口附近的图。（`LakeEditor` 那里早就有 resolver，所以只有桌面文档踩到；
 * 旧护栏读的也是 LakeEditor.tsx，故一直没抓到 —— 见下方 source 断言。）
 */

// jsdom 环境里 import.meta.url 不是 file: 协议（vite 注入 http 地址）⇒ 用仓库根拼绝对路径读源码。
const readSrc = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
// 读取面 = 三宿主全量（AGENTS §4 记录过「历史护栏只测 LakeEditor 漏 EditorTab」的同型事故：别只测一个宿主）
const EDITOR_TAB_SRC = readSrc("src/features/editor/EditorTab.tsx");
const LAKE_EDITOR_SRC = readSrc("src/features/editor/LakeEditor.tsx");
const NOTE_EDITOR_SRC = readSrc("src/features/quickNotes/QuickNoteEditor.tsx");

let host: HTMLDivElement | null = null;
let detach: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;
let state: ImagePreviewState | null = null;

function mountHost(srcs: string[]): HTMLDivElement {
  host = document.createElement("div");
  for (const src of srcs) {
    const img = document.createElement("img");
    img.className = "ne-image";
    img.src = src;
    host.append(img);
  }
  document.body.append(host);
  state = null;
  unsubscribe = subscribeImagePreview((next) => { state = next; });
  return host;
}

const doubleClick = (img: Element) => {
  img.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
};
/** pointerdown/pointermove：jsdom 没有 PointerEvent 构造器，用带坐标的 MouseEvent 顶 —— 判据只读 target/clientX/clientY */
const pointer = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });

afterEach(() => {
  detach?.();
  unsubscribe?.();
  host?.remove();
  closeImagePreview();
  detach = null;
  unsubscribe = null;
  host = null;
  vi.restoreAllMocks();
});

describe("文档图片预览：画廊列表来自正文（261112）", () => {
  it("桌面文档编辑器（EditorTab）必须传 resolver：现场序列化正文 + 取不到才回退", () => {
    expect(EDITOR_TAB_SRC).toMatch(/attachImagePreviewClick\(host, \(\) => \{/);
    expect(EDITOR_TAB_SRC).toContain('getDocument?.("text/lake")');
    expect(EDITOR_TAB_SRC).toContain("extractImagesFromContent(live)");
    // 不许退回裸调用（无 resolver = DOM 收集 = 数不到视口外的图）
    expect(EDITOR_TAB_SRC).not.toMatch(/attachImagePreviewClick\(host\)/);
    // 共享 LakeEditor 的 resolver 也在（移动端文档编辑器 / 回收站预览走这条），
    // 且移动端传 tap = 单击看大图、双击编辑（261112 用户定稿）
    expect(LAKE_EDITOR_SRC).toMatch(/attachImagePreviewClick\(\s*host,\s*\(\) => extractImagesFromContent\(latestDocumentRef\.current\),\s*\{ tap: tapToPreview \},/);
    expect(LAKE_EDITOR_SRC).toMatch(/const tapToPreview = !isDesktop\(\);/);
    // 移动端小记卡片：单击看大图、双击进编辑（首页卡片 + 标签详情都接上了）
    const homeSrc = readSrc("src/mobile/home/QuickNoteCard.tsx");   // M-06①：小记卡（含图片点按）已从 HomePage 尾部拆出
    const tagSrc = readSrc("src/mobile/tags/TagQuickNotePreview.tsx");
    expect(homeSrc).toContain("onImageClick={handleImageTap}");
    expect(homeSrc).toContain("openImagePreview(shots.map");
    expect(homeSrc).toMatch(/if \(doubleTap\) \{[\s\S]{0,220}onEdit\(cardRef\.current\)/);
    // 封面（qn-card__img）也是点按入口：单击预览、双击进编辑
    expect(homeSrc).toMatch(/className="qn-card__img"[\s\S]{0,400}handleImageTap\(\{ filename: note\.firstImage \?\? undefined \}\)/);
    // 选择态 / 长按刚进多选的那一下：与卡片同口径（切勾选 / 吞掉），不弹大图
    expect(homeSrc).toMatch(/if \(suppressTap\.current\) \{ suppressTap\.current = false; return; \}/);
    expect(homeSrc).toMatch(/if \(selecting\) \{ onToggleSelect\(\); return; \}/);
    expect(tagSrc).toContain("openImagePreview(shots.map");
    // 小记写作卡是独立内核实例（不走 LakeEditor/EditorTab）：移动端也要接 tap 预览，
    // 且画廊列表同样取自**正文**（resolver）——裸挂 = DOM 收集 = 虚拟渲染下数不到视口外的图
    expect(NOTE_EDITOR_SRC).toContain("attachImagePreviewClick(");
    expect(NOTE_EDITOR_SRC).toContain('extractImagesFromContent(editor.getDocument("text/lake"))');
    expect(NOTE_EDITOR_SRC).not.toMatch(/attachImagePreviewClick\(host\)/);
    expect(NOTE_EDITOR_SRC).toContain("{ tap: true }");
    expect(NOTE_EDITOR_SRC).toContain("isDesktop()");
  });

  it("resolver 给全量 ⇒ 条数 = 正文条数，索引按 DOM 子序列对齐（同一张图出现两次也不跳错）", () => {
    const h = mountHost(["https://ex.com/a.png", "https://ex.com/b.png", "https://ex.com/c.png"]);
    const all = ["https://ex.com/a.png", "https://ex.com/b.png", "https://ex.com/c.png", "https://ex.com/d.png", "https://ex.com/e.png"].map((src) => ({ src }));
    detach = attachImagePreviewClick(h, () => all);
    doubleClick(h.querySelectorAll("img.ne-image")[1]);
    expect(state?.images.length).toBe(5);
    expect(state?.index).toBe(1);
    expect(state?.images[1].src).toBe("https://ex.com/b.png");
  });

  it("resolver 返回空（实例不可读/未就绪）⇒ 按既有约定回退 DOM 收集，至少当前这张能看", () => {
    const h = mountHost(["https://ex.com/a.png", "https://ex.com/b.png"]);
    detach = attachImagePreviewClick(h, () => []);
    doubleClick(h.querySelectorAll("img.ne-image")[1]);
    expect(state?.images.length).toBe(2);
    expect(state?.index).toBe(1);
  });

  it("tap 模式（移动端）：按下后一个判定窗开预览（点击看图片；判据在 pointerdown，不等 WebView 的 click）", async () => {
    const h = mountHost(["https://ex.com/a.png", "https://ex.com/b.png"]);
    const all = ["https://ex.com/a.png", "https://ex.com/b.png", "https://ex.com/c.png"].map((src) => ({ src }));
    detach = attachImagePreviewClick(h, () => all, { tap: true });
    const img = h.querySelectorAll("img.ne-image")[1];
    act(() => { img.dispatchEvent(pointer("pointerdown", 10, 10)); });
    expect(state).toBeNull(); // 判定窗内先不开（等第二击）
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(state?.images.length).toBe(3);
    expect(state?.index).toBe(1);
  });

  it("tap 模式：窗口内同一位置再按下 = 双击 ⇒ 取消预览（双击编辑，交给宿主/内核）", async () => {
    const h = mountHost(["https://ex.com/a.png"]);
    detach = attachImagePreviewClick(h, () => [{ src: "https://ex.com/a.png" }], { tap: true });
    const img = h.querySelector("img.ne-image")!;
    act(() => { img.dispatchEvent(pointer("pointerdown", 10, 10)); });
    act(() => { img.dispatchEvent(pointer("pointerdown", 11, 12)); });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(state).toBeNull();
  });

  it("tap 模式：第一击后内核换掉图片元素（同位置同图）仍按双击处理（261112 设备实测：写作卡双击弹图）", async () => {
    const h = mountHost(["https://ex.com/a.png"]);
    detach = attachImagePreviewClick(h, () => [{ src: "https://ex.com/a.png" }], { tap: true });
    const first = h.querySelector("img.ne-image")!;
    act(() => { first.dispatchEvent(pointer("pointerdown", 10, 10)); });
    // 内核在第一次点按后会重渲染图片卡（选中态）：用新元素替换旧元素
    const clone = document.createElement("img");
    clone.className = "ne-image";
    clone.src = "https://ex.com/a.png";
    first.replaceWith(clone);
    act(() => { clone.dispatchEvent(pointer("pointerdown", 10, 11)); });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(state).toBeNull();
  });

  it("tap 模式：按下后手指移动（滚动/拖拽）⇒ 取消单击预览", async () => {
    const h = mountHost(["https://ex.com/a.png"]);
    detach = attachImagePreviewClick(h, () => [{ src: "https://ex.com/a.png" }], { tap: true });
    const img = h.querySelector("img.ne-image")!;
    act(() => { img.dispatchEvent(pointer("pointerdown", 10, 10)); });
    act(() => { img.dispatchEvent(pointer("pointermove", 10, 60)); });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(state).toBeNull();
  });

  it("不传 resolver 时仍是 DOM 收集（其它调用方保持原行为）", () => {
    const h = mountHost(["https://ex.com/a.png"]);
    detach = attachImagePreviewClick(h);
    doubleClick(h.querySelector("img.ne-image")!);
    expect(state?.images.length).toBe(1);
  });
});

/**
 * 三宿主「交互面挂载清单」（docs/audit-261125/02-desktop-ui.md D-03 保守护栏）：同一组 attach
 * 在三个宿主按**各宿主允许集**出现；差异 = 有意参数（QuickNoteEditor 不挂 file 卡/菜单/书签条），
 * 挂载清单本身不允许漏挂/误挂漂移。历史事故：护栏只测一个宿主 ⇒ 漏挂在别的宿主复发
 * （图片预览漏 EditorTab、书签条删挂载变「没有菜单的死卡」，见 AGENTS §4）。
 */
describe("三宿主交互面挂载清单（防漏挂/误挂漂移）", () => {
  const REQUIRED: Array<[string, string, string[]]> = [
    ["EditorTab（桌面文档编辑器）", EDITOR_TAB_SRC,
      ["upgradePastedHtml", "attachImagePreviewClick", "attachFileCardClick", "installMediaCardCategoryRouter", "BookmarkToolbar"]],
    ["LakeEditor（共享文档编辑器）", LAKE_EDITOR_SRC,
      ["upgradePastedHtml", "attachImagePreviewClick", "attachFileCardClick", "installMediaCardCategoryRouter", "BookmarkToolbar"]],
    ["QuickNoteEditor（小记写作卡）", NOTE_EDITOR_SRC,
      ["attachImagePreviewClick", "installMediaCardCategoryRouter"]],
  ];

  it("必须出现的挂载按各宿主允许集齐装（漏挂 = 能力丢失）", () => {
    for (const [host, src, names] of REQUIRED) {
      for (const name of names) {
        expect(src, host + " 必须挂 " + name + "（漏挂只会在运行时以死卡/丢能力形式复发）").toContain(name);
      }
    }
  });

  it("允许集外不得出现（有意不挂 = 参数差异；确实要加就先改这里再改宿主）", () => {
    for (const name of ["attachFileCardClick", "BookmarkToolbar", "upgradePastedHtml", "createCardHoverResidueCleaner"]) {
      expect(NOTE_EDITOR_SRC, "QuickNoteEditor（小记写作卡）不挂 " + name + "（有意差异，见 D-03）").not.toContain(name);
    }
  });
});
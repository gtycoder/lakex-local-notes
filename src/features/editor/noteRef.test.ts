/**
 * 「文档引用」卡（R2）护栏（261008）：纯逻辑用真单测；接线用源码级断言（与项目其它 UI 护栏同套路）。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  NOTE_REF_CARD_META, NOTE_REF_CARD_NAME, NOTE_REF_ICON_ID, NOTE_REF_SLASH_GROUP_TITLE, NOTE_REF_SLASH_ITEM,
  appendNoteRefCard, isNoteRefGone, noteKindLabel, noteRefUrl, parseNoteRef, setNoteRefHost, withNoteRefSlashItem,
} from "./noteRef";
import type { NoteSummary } from "../../lib/types";

const CARD = readFileSync(new URL("./noteRefCard.tsx", import.meta.url), "utf8");
const ICON = readFileSync(new URL("./noteRefIcon.tsx", import.meta.url), "utf8");
const RUNTIME = readFileSync(new URL("./lakeRuntime.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

const note = (over: Partial<NoteSummary> = {}): NoteSummary => ({
  id: "n-1", title: "标题", parentId: "nb-1", sortOrder: 0,
  updatedAt: "2026-10-08T00:00:00.000Z", syncState: "synced", isConflict: false, kind: "doc", ...over,
});

afterEach(() => setNoteRefHost(null));

describe("文档引用卡：纯逻辑", () => {
  it("noteRefUrl / parseNoteRef 往返；对象形态与非法输入都处理", () => {
    const id = "03b36b4b-9e79-4591-8858-228e0baadc50";
    expect(noteRefUrl(id)).toBe("lake-note://" + id);
    expect(parseNoteRef(noteRefUrl(id))).toBe(id);
    expect(parseNoteRef({ noteId: id })).toBe(id);
    expect(parseNoteRef({ noteId: "  " })).toBeNull();
    expect(parseNoteRef("https://example.com/x")).toBeNull();
    expect(parseNoteRef("")).toBeNull();
    expect(parseNoteRef(null)).toBeNull();
  });

  it("isNoteRefGone：不在库里 / 回收站 / purged 都算失效，正常在库不算", () => {
    setNoteRefHost({ listNotes: () => [note()], openNote: () => {} });
    expect(isNoteRefGone("n-1")).toBe(false);
    expect(isNoteRefGone("no-such")).toBe(true);
    expect(isNoteRefGone(null)).toBe(false);
    setNoteRefHost({ listNotes: () => [note({ parentId: "notebook-trash" })], openNote: () => {} });
    expect(isNoteRefGone("n-1")).toBe(true);
    setNoteRefHost({ listNotes: () => [note({ syncState: "purged" })], openNote: () => {} });
    expect(isNoteRefGone("n-1")).toBe(true);
  });

  it("类型中文名", () => {
    expect(noteKindLabel("sheet")).toBe("表格");
    expect(noteKindLabel("bitable")).toBe("多维表");
    expect(noteKindLabel("board")).toBe("画板");
    expect(noteKindLabel(undefined)).toBe("文档");
  });

  it("斜杠项：只动「小工具」组、幂等、其它组一字不动", () => {
    const groups = [
      { title: "基础", name: "group-base", items: ["p"] },
      { title: NOTE_REF_SLASH_GROUP_TITLE, name: "group-files", items: ["calendar"] },
    ];
    const once = withNoteRefSlashItem(groups) as Array<{ title: string; items: string[] }>;
    expect(once[1].items).toEqual(["calendar", NOTE_REF_SLASH_ITEM]);
    expect(once[0].items).toEqual(["p"]);
    const twice = withNoteRefSlashItem(once) as Array<{ items: string[] }>;
    expect(twice[1].items).toEqual(["calendar", NOTE_REF_SLASH_ITEM]);   // 幂等
    // 找不到该组时原样返回
    expect(withNoteRefSlashItem([{ title: "别的", items: [] }])).toEqual([{ title: "别的", items: [] }]);
  });

  it("appendNoteRefCard：幂等追加到 customCard.cards", () => {
    const config: Record<string, unknown> = { customCard: { cards: [{ config: { name: "mindmap-card" } }] } };
    appendNoteRefCard(config, { name: NOTE_REF_CARD_NAME });
    appendNoteRefCard(config, { name: NOTE_REF_CARD_NAME });
    const cards = (config.customCard as { cards: Array<{ config: { name: string } }> }).cards;
    expect(cards.map((c) => c.config.name)).toEqual(["mindmap-card", NOTE_REF_CARD_NAME]);
    // 没有 customCard 配置时安全早退
    const empty: Record<string, unknown> = {};
    appendNoteRefCard(empty, { name: NOTE_REF_CARD_NAME });
    expect(empty.customCard).toBeUndefined();
  });

  it("卡片描述：区块卡 + 官方要求的 custom- 前缀 + 复制/导出文本", () => {
    expect(NOTE_REF_CARD_META.name).toBe(NOTE_REF_CARD_NAME);
    expect(NOTE_REF_CARD_META.cardType).toBe("block");
    expect(NOTE_REF_SLASH_ITEM).toBe("custom-" + NOTE_REF_CARD_NAME);
    expect(NOTE_REF_CARD_META.writeText({ noteId: "n-1", title: "标题" })).toBe("标题");
    expect(NOTE_REF_CARD_META.writeText({ noteId: "n-1" })).toBe("lake-note://n-1");
    expect(NOTE_REF_CARD_META.writeText(null)).toBe("");
    expect(NOTE_REF_CARD_META.writeHtml({ noteId: "n-1", title: "标题" })).toBe('<a href="lake-note://n-1">标题</a>');
    expect(NOTE_REF_CARD_META.writeHtml(null)).toBe("");
  });
});

describe("文档引用卡：接线护栏", () => {
  it("lakeRuntime 必须注册卡片 + 把斜杠项加进分组（否则 / 面板里根本看不到）", () => {
    expect(RUNTIME).toContain("registerNoteRefCard(mergedOptions)");
    expect(RUNTIME).toMatch(/withNoteRefSlashItem\(/);
    // 注册要发生在 prepareCustomCards（归一化 label/description）之前
    expect(RUNTIME.indexOf("registerNoteRefCard(mergedOptions)")).toBeLessThan(RUNTIME.indexOf("prepareCustomCards(mergedOptions)"));
  });

  it("交互与内核链接一致：**悬停**出动作条 + **点击文字直接打开文档**（261008 四改）", () => {
    expect(CARD).toContain("<HoverPopover");            // 悬停触发（不再是点击开菜单）
    expect(CARD).toContain("anchorRef={anchorRef}");    // 悬停区 = 标题文字元素
    expect(CARD).toContain("openDelayMs");
    expect(CARD).toContain("onOpenChange=");
    expect(CARD).toContain("const openTarget");         // 点击 = 直接访问
    expect(CARD).toContain("onClick={openTarget}");
    expect(CARD).toMatch(/noteRefHost\(\)\?\.openNote\(noteId\)/);
    // 编辑/选择器打开期间不许再弹动作条（否则悬停会盖住编辑面板）
    expect(CARD).toContain("next && !editing && !picking");
    // HoverPopover 的悬停监听只读一次 anchorRef ⇒ 换态必须靠 key 重挂
    expect(CARD).toMatch(/key=\{noteId \? \(gone \? "linked-gone" : "linked"\) : "plain"\}/);
    // 不再有"点一下出菜单"的旧交互
    expect(CARD).not.toContain("onClick={() => setMenuOpen(true)}");
  });

  it("动作条 / 编辑浮层：几何**全部复用内核类**（.ne-card-toolbar / .ne-link-editor），四个动作与内核链接一致", () => {
    // 四个动作（访问 / 编辑 / 复制 / 取消链接）
    expect(CARD).toContain('label="访问"');
    expect(CARD).toContain('label="编辑（改展示名称 / 换文档）"');
    expect(CARD).toContain("复制引用路径");
    expect(CARD).toContain('label="取消链接（转为正文）"');
    // ⚠️ 几何单一来源 = **内核自己那套类**，不许自造尺寸/间距（261008 三改：用户要求「大小和间距也要复刻」）
    expect(CARD).toContain('surfaceClassName="ne-card-toolbar"');
    expect(CARD).toContain('className="ne-card-toolbar-item"');
    expect(CARD).toContain('surfaceClassName="ne-link-editor"');
    expect(CARD).toContain('className="ne-link-editor-field"');
    expect(CARD).toContain('className="ne-link-editor-field-title"');
    // 两个浮层 portal 到 body（已在编辑器树之外）⇒ 必须带 lakex-default-theme 才吃得到 --lakex-editor-* 主题桥
    expect(CARD.match(/className="lakex-default-theme"/g)?.length).toBe(2);
    // 定位单一来源 + 贴文字（gap 2 = 内核卡片工具栏的默认 offset）
    expect(CARD).toContain("usePopoverPosition");
    expect(CARD).toContain("gap: 2");
    expect(CARD).toContain("<HoverPopover");   // 动作条走 **HoverPopover**（悬停开）；Menu 是竖向菜单原语，会把图标排成竖列
    expect(CARD).toContain('className="ne-link"');     // 正文用内核链接类 ⇒ 样式复刻链接
    // 取消链接 = **转为正文**（内核命令；失败才退回"保留卡片"）
    expect(CARD).toContain("unlinkCardToText(editor, cardEl, title)");
    expect(CARD).toMatch(/update\(\{ noteId: "", title \}\)/);   // 兜底路径
    expect(CARD).toContain("编辑文档引用");
    expect(CARD).toContain(">文本");      // 字段名复刻内核链接编辑
    expect(CARD).toContain(">链接");
    expect(CARD).toMatch(/const readonly = mode === "view"/);       // 阅读态不给写操作
    // 展示文本 = 卡里存的 title（用户填的「文本」），不是目标的实时标题 —— 否则"改文本"等于没改
    expect(CARD).toContain("value?.title || note?.title");
  });

  it("取消链接 = 转为正文（261008 九改）；复制引用 = 资料库全路径（261008 十改）", () => {
    // ① 转正文：先 insertAtPosition 再 deleteCard（顺序反了落点会变末位），文本走 text/html 且必须转义
    expect(CARD).toContain('ed.execCommand("focusCard", cardId)');   // 用内核自己的命令把选区落到卡上（自建 BFS 找模型节点实测失败）
    expect(CARD).toContain("positionAfterModelRange(captureModelRange(editor))");
    expect(CARD).toContain('"insertAtPosition"');
    expect(CARD).toContain("deleteCardNative(cardEl, cardId, editor)");
    expect(CARD.indexOf('"insertAtPosition"')).toBeLessThan(CARD.lastIndexOf("deleteCardNative(cardEl, cardId, editor)"));
    expect(CARD).toContain('"text/html"');
    expect(CARD).toContain("escapeHtml(text)");
    // 卡片自己的 editor 由内核 editorComponent props 传入（转正文要用它跑命令）
    expect(CARD).toContain("editor={props.editor}");
    // ② 复制引用：优先**资料库全路径**（宿主注入 pathOf = treeNodePath 拼 笔记本/分组/文档），回退 展示名 → lake-note://<id>
    expect(CARD).toContain("await noteRefHost()?.pathOf?.(noteId)");
    expect(CARD).toContain("path || title || noteRefUrl(noteId)");
    expect(APP).toContain("pathOf: (noteId)");
    expect(APP).toContain("treeNodePath(treeNodes, noteId)");
    // 宿主接口里 pathOf 必须是可选的（老注入点/单测不带它也要能跑）
    expect(readFileSync(new URL("./noteRef.ts", import.meta.url), "utf8")).toContain("pathOf?(noteId: string)");
  });

  it("插入面板图标：**自绘 symbol**（用户设计稿）+ 主题调色板（浅色原值 / 深色重绘）（261008 五/六改）", () => {
    // 面板按 slash.icon 直接解析成 use href="#<id>" ⇒ 必须是全限定 id
    expect(NOTE_REF_ICON_ID).toBe("icon-lake-note-ref");
    expect(NOTE_REF_CARD_META.slash.icon).toBe(NOTE_REF_ICON_ID);
    // 图标组件必须渲染**一个 symbol**（不是可见 svg），否则 sprite 里没有可引用的符号
    expect(ICON).toContain("export function NoteRefIconSymbol");
    expect(ICON).toMatch(/<symbol id=\{NOTE_REF_ICON_ID\} viewBox="0 0 72 72"/);
    // 颜色只能走自定义属性：<use> 的 shadow 树里选择器打不到，var() 也不能写进 presentation attribute
    expect(ICON).not.toMatch(/(fill|stroke)="#/);
    expect(ICON).toContain("--lake-note-ref-icon-");
    expect(ICON).toContain("style={{");
    const usedNames = [...ICON.matchAll(/iconVar\("([a-z-]+)"\)/g)].map((m) => m[1]);
    expect(usedNames.length).toBeGreaterThan(0);
    // 每个用到的调色板变量都必须在 base.css 定义、且 dark.css 逐一同名覆盖（缺一个 = 深色下变透明/黑）
    const themesBase = readFileSync(new URL("../../styles/themes/base.css", import.meta.url), "utf8");
    const themesDark = readFileSync(new URL("../../styles/themes/dark.css", import.meta.url), "utf8");
    for (const name of new Set(usedNames)) {
      expect(themesBase).toContain(`--lake-note-ref-icon-${name}:`);
      expect(themesDark).toContain(`--lake-note-ref-icon-${name}:`);
    }
    // 注册时必须把图标组件交给 { config, icon } 包装（ensureCustomCardIcons 从这里取）
    expect(CARD).toContain("appendNoteRefCard(config, noteRefCardConfig, NoteRefIconSymbol)");
    expect(RUNTIME).toContain("ensureCustomCardIcons(mergedOptions)");
    expect(RUNTIME.indexOf("registerNoteRefCard(mergedOptions)")).toBeLessThan(RUNTIME.indexOf("ensureCustomCardIcons(mergedOptions)"));
  });

  it("插入后自动打开编辑浮层（261008 七改）：认 ne-focused + 轮询 + WeakSet 去重；打开即聚焦等 placed", () => {
    // 判据：内核给"刚插入"的卡挂的 ne-focused（打开既有文档时没有）
    expect(CARD).toContain('classList.contains("ne-focused")');
    expect(CARD).toContain("window.setInterval");            // 插入可能先进游离节点 ⇒ 轮询而不是一次性判定
    expect(CARD).toContain("new WeakSet<Element>()");        // 按 DOM 元素去重（重渲染不重复弹）
    expect(CARD).toContain("autoOpenedCards");
    expect(CARD).toContain("if (readonly || noteId) return;");
    // 打开即聚焦：不能用 autoFocus（首帧表面 visibility:hidden，focus() 被静默忽略 ⇒ 必须等 placed）
    expect(CARD).toContain("pos.placed");
    expect(CARD).toContain("(hasRef ? textRef : linkRef).current?.focus()");
    expect(CARD).toContain("ref={textRef}");
    expect(CARD).toContain("ref={linkRef}");
    expect(CARD).toContain("ref={searchRef}");   // 选择器搜索框同理：下一帧再聚焦
  });

  it("卡片实现：编辑/阅读两态、失效占位、不静默", () => {
    expect(CARD).toContain("editorComponent");
    expect(CARD).toContain("viewerComponent");
    expect(CARD).toContain("文档已删除");
    expect(CARD).toContain("noteRefHost()?.openNote(noteId)");
    expect(CARD).toContain('className="ln-btn"');
    expect(CARD).toContain("选择文档…");
    expect(CARD).toContain("setNoteRefHost");
    // 宿主由 App 注入（卡片在内核 React 树里，拿不到我们的 context）
    expect(APP).toContain("listNotes: () => notes,");
    expect(APP).toContain("openNote,");
    expect(APP).toContain("pathOf: (noteId)");
  });
});
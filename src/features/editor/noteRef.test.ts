/**
 * 「文档引用」卡（R2）护栏（261008）：纯逻辑用真单测；接线用源码级断言（与项目其它 UI 护栏同套路）。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  NOTE_REF_CARD_META, NOTE_REF_CARD_NAME, NOTE_REF_SLASH_GROUP_TITLE, NOTE_REF_SLASH_ITEM,
  appendNoteRefCard, isNoteRefGone, noteKindLabel, noteRefUrl, parseNoteRef, setNoteRefHost, withNoteRefSlashItem,
} from "./noteRef";
import type { NoteSummary } from "../../lib/types";

const CARD = readFileSync(new URL("./noteRefCard.tsx", import.meta.url), "utf8");
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

  it("悬停动作与内核链接一致：访问 / 编辑（改展示名称 + 换文档）/ 复制 / 取消链接", () => {
    expect(CARD).toContain('title="访问"');
    expect(CARD).toContain('title="编辑（改展示名称 / 换文档）"');
    expect(CARD).toContain("复制引用");
    expect(CARD).toContain('title="取消链接（保留展示名）"');
    expect(CARD).toContain("<Popover open={menuOpen}");  // 动作条走 **Popover**（中性表面）；Menu 是竖向菜单原语，会把图标排成竖列
    expect(CARD).toContain("usePopoverPosition");     // 定位单一来源
    expect(CARD).toContain('className="ne-link"');     // 正文用内核链接类 ⇒ 样式复刻链接
    expect(CARD).toContain("onClick={() => setMenuOpen(true)}");   // 点卡片打开菜单（不是悬停）
    expect(CARD).toMatch(/update\(\{ noteId: "", title \}\)/);   // 取消链接 = 清引用、保留展示名
    expect(CARD).toContain("编辑文档引用");
    expect(CARD).toContain(">文本");      // 字段名复刻内核链接编辑
    expect(CARD).toContain(">链接");
    expect(CARD).toMatch(/const readonly = mode === "view"/);       // 阅读态不给写操作
  });

  it("卡片实现：编辑/阅读两态、失效占位、点击打开、不静默", () => {
    expect(CARD).toContain("editorComponent");
    expect(CARD).toContain("viewerComponent");
    expect(CARD).toContain("文档已删除");
    expect(CARD).toContain("noteRefHost()?.openNote(noteId)");
    expect(CARD).toContain('className="ln-btn"');
    expect(CARD).toContain("选择文档…");
    expect(CARD).toContain("setNoteRefHost");
    // 宿主由 App 注入（卡片在内核 React 树里，拿不到我们的 context）
    expect(APP).toContain("setNoteRefHost({ listNotes: () => notes, openNote })");
  });
});
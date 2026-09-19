/**
 * 小记「+」插入面板白名单过滤（零内核，纯函数）。
 * 口径：预览渲染器支持的才给插；其余（表格/代码块/公式/画板/日历…）隐藏，但**卡片注册照旧全量**。
 */
import { describe, expect, it } from "vitest";
import { filterQuickNoteInsert, isQuickNoteInsertAllowed } from "./quickNoteInsertFilter";

describe("小记插入白名单", () => {
  it("按 mainSearch 命中：图片/附件/视频/音频/列表/待办/引用/分割线", () => {
    for (const item of [
      { mainSearch: "/tp", label: "图片" },
      { mainSearch: "/wj", label: "附件" },
      { mainSearch: "/sp", label: "本地视频" },
      { mainSearch: "/yp", label: "本地音频" },
      { mainSearch: "/wx", label: "无序列表" },
      { mainSearch: "/yx", label: "有序列表" },
      { mainSearch: "/rw", label: "任务列表" },
      { mainSearch: "/yinyong", label: "引用" },
      { mainSearch: "/fgx", label: "分割线" },
    ]) {
      expect(isQuickNoteInsertAllowed(item), `${item.label} 应可插入`).toBe(true);
    }
  });

  it("按 label 兜底命中（内核改 search 也不会误伤）", () => {
    expect(isQuickNoteInsertAllowed({ label: "标题" })).toBe(true);
    expect(isQuickNoteInsertAllowed({ label: "正文" })).toBe(true);
  });

  it("预览还原不了的条目一律隐藏", () => {
    for (const item of [
      { mainSearch: "/bg", label: "表格" },
      { mainSearch: "/dmk", label: "代码块" },
      { mainSearch: "/gs", label: "公式" },
      { mainSearch: "/hb", label: "画板" },
      { mainSearch: "/dht", label: "思维导图" },
      { mainSearch: "/rl", label: "日历" },
      { mainSearch: "/zdk", label: "折叠块" },
      { label: "第三方服务" },
    ]) {
      expect(isQuickNoteInsertAllowed(item), `${item.label} 应被隐藏`).toBe(false);
    }
  });

  it("过滤分组：空分组丢掉、结构保持、未知结构原样返回", () => {
    const config = {
      groups: [
        { name: "general", items: [{ label: "图片", mainSearch: "/tp" }, { label: "表格", mainSearch: "/bg" }] },
        { name: "third-party-services", items: [{ label: "第三方服务" }] },
      ],
    };
    expect(filterQuickNoteInsert(config)).toEqual({
      groups: [{ name: "general", items: [{ label: "图片", mainSearch: "/tp" }] }],
    });
    expect(filterQuickNoteInsert({ something: 1 })).toEqual({ something: 1 });
    expect(filterQuickNoteInsert(null)).toBeNull();
  });
});

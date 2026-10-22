// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syncScrollFade } from "./useScrollFade";

/**
 * 滚动边缘渐隐（261017 B）的行为 + 接线护栏。
 * 判据只看两件事：① 纯函数在四种边缘态算得对；② 三个调用点都真的接上了 hook/类名，
 * 且遮罩采样只来自 themes 令牌（不在组件里写颜色）。
 */

function fakeList(init: { scrollTop: number; clientHeight: number; scrollHeight: number }): HTMLElement {
  const el = document.createElement("div");
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
  return el;
}

describe("syncScrollFade", () => {
  it("顶/中/底/不可滚四种状态", () => {
    const top = fakeList({ scrollTop: 0, clientHeight: 300, scrollHeight: 1000 });
    syncScrollFade(top);
    expect(top.dataset.fadeTop).toBe("0");
    expect(top.dataset.fadeBottom).toBe("1");

    const mid = fakeList({ scrollTop: 300, clientHeight: 300, scrollHeight: 1000 });
    syncScrollFade(mid);
    expect(mid.dataset.fadeTop).toBe("1");
    expect(mid.dataset.fadeBottom).toBe("1");

    const bottom = fakeList({ scrollTop: 700, clientHeight: 300, scrollHeight: 1000 });
    syncScrollFade(bottom);
    expect(bottom.dataset.fadeTop).toBe("1");
    expect(bottom.dataset.fadeBottom).toBe("0");

    const noScroll = fakeList({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 });
    syncScrollFade(noScroll);
    expect(noScroll.dataset.fadeTop).toBe("0");
    expect(noScroll.dataset.fadeBottom).toBe("0");
  });

  it("1px 余量：亚像素滚动不把顶边误判成「被裁」", () => {
    const a = fakeList({ scrollTop: 1, clientHeight: 300, scrollHeight: 1000 });
    syncScrollFade(a);
    expect(a.dataset.fadeTop).toBe("0");
    const b = fakeList({ scrollTop: 2, clientHeight: 300, scrollHeight: 1000 });
    syncScrollFade(b);
    expect(b.dataset.fadeTop).toBe("1");
  });
});

describe("接线与令牌", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("样式：两个接入点共用 7 档遮罩 + 两侧只在 data-fade 时出现（目录树不渐隐）", () => {
    const kit = read("../styles/kit.css");
    expect(kit).toContain(".ln-select__list,\n.quick-notes-index {");
    expect(kit).toContain("mask-image: linear-gradient(to bottom");
    // 选择器组里不能再出现目录树（注释里提到它不算）
    expect(kit).not.toContain(".note-list.tree-list,");
    expect(kit).not.toContain(".note-list.tree-list[");
    expect(kit).toContain('.quick-notes-index[data-fade-bottom="1"]');
    expect(kit).toContain("--ln-fade-top: 28px");
    expect(kit).toContain("--ln-fade-bottom: 28px");
    // 采样色只来自 theme 令牌，不在 kit 里写颜色字面量
    expect(kit).not.toMatch(/\.quick-notes-index[^}]*rgba?\(/);
  });

  it("令牌：7 档 alpha 定义在 themes/base.css", () => {
    const base = read("../styles/themes/base.css");
    for (const step of ["05", "15", "30", "50", "70", "85", "100"]) {
      expect(base).toContain(`--lake-scroll-fade-${step}:`);
    }
  });

  it("两个列表都接上了 hook + 类名，目录树已摘除，且不在滚动回调里用 rAF（隐藏窗口不触发）", () => {
    const hook = read("./useScrollFade.ts");
    expect(hook).not.toContain("requestAnimationFrame");
    expect(read("../components/ui/Select.tsx")).toContain("useScrollFade(listRef, open)");
    expect(read("../components/app/QuickNotesWorkspace.tsx")).toContain("useScrollFade(indexListRef, viewMode)");
    // 261022 用户点单：目录栏上下边缘不再模糊（摘掉 hook 与选择器，别加回）
    expect(read("../components/app/Sidebar.tsx")).not.toContain("useScrollFade");
    expect(read("../components/app/Sidebar.tsx")).not.toContain("ln-scroll-fade");
    // 类名会进 stylesnap 的 key ⇒ 刻意不加工具类，样式靠上面的选择器组
    expect(read("../components/ui/Select.tsx")).not.toContain("ln-scroll-fade");
    expect(read("../components/app/QuickNotesWorkspace.tsx")).not.toContain("ln-scroll-fade");
  });
});

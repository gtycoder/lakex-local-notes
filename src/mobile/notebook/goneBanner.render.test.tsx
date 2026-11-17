// @vitest-environment jsdom
/**
 * P0-1（261117）tab gone 只读横幅渲染契约：
 *  · gone 标签显示只读横幅（.mobile-status-msg / role=status，与 editLocked 横幅同族）；
 *  · 正常文档不显示横幅；
 *  · 文案含「回收站」「保存会被拦」关键词（三事实：已被删除（云端/回收站）/ 保存会被拦截 / 可从回收站恢复）；
 *  · gone 强制只读：所有正文宿主收到 editing=false（与 editLocked 同一强制口径）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ editing: [] as Array<boolean | undefined> }));

vi.mock("../editor/DocumentEditor", () => ({
  DocumentEditor: (props: { editing?: boolean }) => {
    seen.editing.push(props.editing);
    return <div data-testid="doc-editor" data-editing={String(props.editing)} />;
  },
}));
vi.mock("../board/MobileBoardViewer", () => ({ MobileBoardViewer: () => <div data-testid="board" /> }));

import { NotePaneHost } from "./NotePaneHost";
import { GONE_BANNER_TEXT } from "./goneBanner";
import type { NotebookTab } from "./useNotebookTabs";

const tab = (id: string, overrides: Partial<NotebookTab> = {}): NotebookTab => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  editing: true,
  loaded: true,
  lastAccessedAt: 1,
  kind: "doc",
  ...overrides,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderTabs(tabs: NotebookTab[]): void {
  act(() => {
    root.render(
      <NotePaneHost
        tabs={tabs}
        active={tabs[0] ?? null}
        activeId={tabs[0]?.id ?? null}
        freshId={null}
        mountedIds={new Set(tabs.map((t) => t.id))}
        findOpen={false}
        onBodyChange={() => {}}
        onPersistBitableNow={async () => {}}
        onCapture={() => {}}
        onEditorInstance={() => {}}
        onFullscreenChange={() => {}}
        onCloseFind={() => {}}
      />,
    );
  });
}

const banners = (): HTMLElement[] => [...host.querySelectorAll(".mobile-status-msg")] as HTMLElement[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  seen.editing.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("tab gone 只读横幅（P0-1）", () => {
  it("gone：显示只读横幅（role=status），文案含「回收站」「保存会被拦」关键词", () => {
    renderTabs([tab("n-gone", { gone: true })]);
    const list = banners();
    expect(list).toHaveLength(1);
    const banner = list[0];
    expect(banner.getAttribute("role")).toBe("status");
    const text = banner.textContent ?? "";
    expect(text).toContain("回收站");
    expect(text).toContain("保存会被拦");
    // 三事实之一：文档已被删除（云端/回收站）。
    expect(text).toContain("已被删除");
    expect(text).toBe(GONE_BANNER_TEXT);
  });

  it("正常文档：不显示横幅", () => {
    renderTabs([tab("n-ok")]);
    expect(banners()).toHaveLength(0);
  });

  it("gone 强制只读：正文宿主收到 editing=false（即使 tab.editing=true）", () => {
    renderTabs([tab("n-gone", { gone: true, editing: true })]);
    expect(seen.editing).toContain(false);
    expect(host.querySelector("[data-testid=doc-editor]")?.getAttribute("data-editing")).toBe("false");
  });

  it("编辑锁横幅不回归；gone 与锁同在时 gone 优先（数据事实压用户锁）", () => {
    renderTabs([tab("n-locked", { editLocked: true, editing: true })]);
    const locked = banners();
    expect(locked).toHaveLength(1);
    expect(locked[0].textContent ?? "").toContain("锁定");

    renderTabs([tab("n-both", { gone: true, editLocked: true })]);
    const both = banners();
    expect(both).toHaveLength(1);
    expect(both[0].textContent).toBe(GONE_BANNER_TEXT);
  });
});

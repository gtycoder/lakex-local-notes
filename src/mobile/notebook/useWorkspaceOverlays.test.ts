// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { SELF_REGISTERED_OVERLAY_KINDS, useWorkspaceOverlays, type WorkspaceOverlays } from "./useWorkspaceOverlays";

/**
 * MOB-02（261027 审计）：工作区浮层从 10 个独立 useState 收成一个 owner（overlay）。
 * 本文件钉住 reducer 语义 —— **互斥**（打开一个先收其它）、**顺序**（最后打开的赢）、
 * **载荷随值**（新建的父节点 / 菜单指向的节点不会残留旧值）、条件关闭（close(kind)）与 toggle。
 * 组件级接线（浮层真的只渲染一个）在设备走查里验，这里只验状态机（纯逻辑，node 可跑）。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string): NotebookTreeItem => ({ id, title: id, kind: "note", parentId: "nb1", sortOrder: 0, icon: null });

let host: HTMLDivElement;
let root: Root;
let api: WorkspaceOverlays;

function Harness() {
  api = useWorkspaceOverlays();
  return null;
}

const render = () => act(() => { root.render(createElement(Harness)); });

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("工作区浮层唯一 owner（MOB-02）", () => {
  it("初始无浮层；打开一个先收掉其它的（互斥、最后打开的赢）", () => {
    expect(api.overlay).toBeNull();
    act(() => api.open({ kind: "sidebar" }));
    expect(api.overlay).toEqual({ kind: "sidebar" });
    act(() => api.open({ kind: "outline" }));
    expect(api.overlay).toEqual({ kind: "outline" });
    act(() => api.open({ kind: "tabs" }));
    expect(api.overlay).toEqual({ kind: "tabs" });
    act(() => api.open({ kind: "notebookSwitch" }));
    expect(api.overlay).toEqual({ kind: "notebookSwitch" });
  });

  it("载荷随值：新建的父节点 / 菜单指向的节点 = overlay 自己的字段，不残留上一次", () => {
    act(() => api.open({ kind: "create", parentId: "g1" }));
    expect(api.overlay).toEqual({ kind: "create", parentId: "g1" });
    // 同一带载荷种类再打开 = 覆盖载荷（不是"再点一次就收起"）
    act(() => api.open({ kind: "create", parentId: "g2" }));
    expect(api.overlay).toEqual({ kind: "create", parentId: "g2" });
    act(() => api.open({ kind: "info", node: node("n1") }));
    expect(api.overlay).toEqual({ kind: "info", node: node("n1") });
    act(() => api.open({ kind: "menu", node: node("n2") }));
    expect(api.overlay).toEqual({ kind: "menu", node: node("n2") });
    expect(api.overlay && "parentId" in api.overlay).toBe(false);
  });

  it("close() 全关；close(kind) 只在当前正是它时才关（切文档收起查找条）", () => {
    act(() => api.open({ kind: "info", node: node("n1") }));
    act(() => api.close("find"));
    expect(api.overlay).toEqual({ kind: "info", node: node("n1") });
    act(() => api.close("info"));
    expect(api.overlay).toBeNull();
    act(() => api.open({ kind: "sidebar" }));
    act(() => api.close());
    expect(api.overlay).toBeNull();
  });

  it("toggle：再点同一入口 = 收起；换一个入口 = 打开它（抽屉 / 查找条）", () => {
    act(() => api.toggle("sidebar"));
    expect(api.overlay).toEqual({ kind: "sidebar" });
    act(() => api.toggle("sidebar"));
    expect(api.overlay).toBeNull();
    act(() => api.toggle("sidebar"));
    act(() => api.toggle("outline"));
    expect(api.overlay).toEqual({ kind: "outline" });
    act(() => api.toggle("find"));
    expect(api.overlay).toEqual({ kind: "find" });
  });

  it("自带返回栈的种类 = 菜单类 + MobileSheet（工作区不得重复登记）", () => {
    expect([...SELF_REGISTERED_OVERLAY_KINDS].sort()).toEqual(["create", "history", "icon", "info", "menu", "notebookSwitch"]);
  });
});

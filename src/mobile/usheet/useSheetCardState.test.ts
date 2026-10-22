// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSheetCardState } from "./useSheetCardState";

type Api = ReturnType<typeof useSheetCardState>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;

function Harness({ active, editing }: { active: boolean; editing: boolean }) {
  api = useSheetCardState({ active, editing });
  return null;
}

const render = (active = true, editing = true) => {
  act(() => root.render(createElement(Harness, { active, editing })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSheetCardState", () => {
  it("同一卡片二次点击关闭，切换卡片更新锚点", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    render();
    act(() => api.toggleCard("insert", first));
    expect(api.openCard).toBe("insert");
    expect(api.cardAnchor).toBe(first);

    act(() => api.toggleCard("insert", first));
    expect(api.openCard).toBeNull();
    expect(api.cardAnchor).toBeNull();

    act(() => api.toggleCard("more", second));
    expect(api.openCard).toBe("more");
    expect(api.cardAnchor).toBe(second);
  });

  it("工作表列表独立开合", () => {
    const anchor = document.createElement("button");
    render();
    act(() => api.openSheetList(anchor));
    expect(api.sheetListAnchor).toBe(anchor);
    act(() => api.closeSheetList());
    expect(api.sheetListAnchor).toBeNull();
  });

  it("切走 tab 或退出编辑时关闭锚定卡片", () => {
    const anchor = document.createElement("button");
    render(true, true);
    act(() => api.toggleCard("insert", anchor));
    expect(api.openCard).toBe("insert");
    render(true, false);
    expect(api.openCard).toBeNull();
    expect(api.cardAnchor).toBeNull();
  });
});

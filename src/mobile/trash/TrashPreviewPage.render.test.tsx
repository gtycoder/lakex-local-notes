// @vitest-environment jsdom
/**
 * 移动回收站预览页（Q04B / Q07A / Q05B）：
 *  · 打开回收站文档 = **只读预览**（不再拒绝），横幅明说「编辑与保存会被拦」；
 *  · LakeEditor 必须走 interaction="preview"（无卡片菜单 / 无 copy-cut 接管，能力来自 Q07A）；
 *  · 字号 = 统一预览档 LAKE_PREVIEW_FONT_SIZE（不跟用户正文字号设置走，Q05B）；
 *  · 「恢复」仍是显式动作（bridge.restoreTreeItem）。
 * 内核无法在 vitest 里实例化 ⇒ mock LakeEditor 只取 props（真机行为由 Lead 设备门禁验收）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({ ensureTrashNoteAssets: vi.fn(), readNote: vi.fn(), restoreTreeItem: vi.fn() }));
const lakeProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("../bridge", () => ({ bridge: bridgeMock }));
vi.mock("../../features/editor/LakeEditor", () => ({
  LAKE_PREVIEW_FONT_SIZE: 16,
  LakeEditor: (props: Record<string, unknown>) => { lakeProps.current = props; return <div data-testid="lake-editor" />; },
}));

import { TrashPreviewPage } from "./TrashPreviewPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  bridgeMock.ensureTrashNoteAssets.mockReset().mockResolvedValue(undefined);
  bridgeMock.readNote.mockReset();
  bridgeMock.restoreTreeItem.mockReset().mockResolvedValue(undefined);
  lakeProps.current = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("移动回收站预览（Q04B/Q07A/Q05B）", () => {
  it("doc：只读预览 + 横幅 + preview 交互档 + 预览字号", async () => {
    bridgeMock.readNote.mockResolvedValue({ id: "n1", title: "回收站文档", content: "<p>正文</p>", kind: "doc", cloudDeleted: false, parentId: "trash" });
    act(() => root.render(<TrashPreviewPage noteId="n1" onBack={() => undefined} onRestored={() => undefined} />));
    await flush();

    expect(container.textContent).toContain("只读预览");
    expect(container.textContent).toContain("编辑与保存会被拦截");
    expect(container.textContent).toContain("回收站文档");
    const props = lakeProps.current;
    expect(props).toBeTruthy();
    expect(props?.interaction).toBe("preview");
    expect((props?.prefs as { fontSize?: number }).fontSize).toBe(16);
    expect((props?.prefs as { disableVirtualRendering?: boolean }).disableVirtualRendering).toBe(true);
    expect(props?.mode).toBe("viewer");
  });

  it("非 doc：明确挡下（不挂内核）+ 横幅仍在", async () => {
    bridgeMock.readNote.mockResolvedValue({ id: "n2", title: "表格", content: "{}", kind: "usheet", cloudDeleted: false, parentId: "trash" });
    act(() => root.render(<TrashPreviewPage noteId="n2" onBack={() => undefined} onRestored={() => undefined} />));
    await flush();
    expect(lakeProps.current).toBeNull();
    expect(container.textContent).toContain("暂不支持在移动端预览");
    expect(container.textContent).toContain("只读预览");
  });

  it("恢复 = 显式动作（restoreTreeItem + onRestored）", async () => {
    const onRestored = vi.fn();
    bridgeMock.readNote.mockResolvedValue({ id: "n1", title: "回收站文档", content: "<p>正文</p>", kind: "doc", cloudDeleted: true, parentId: "trash" });
    act(() => root.render(<TrashPreviewPage noteId="n1" onBack={() => undefined} onRestored={onRestored} />));
    await flush();
    const restore = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("恢复"));
    expect(restore).toBeTruthy();
    await act(async () => { restore?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.restoreTreeItem).toHaveBeenCalledWith("n1", "note");
    expect(onRestored).toHaveBeenCalledTimes(1);
  });
});

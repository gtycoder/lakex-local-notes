// @vitest-environment jsdom
/**
 * 移动回收站预览页（Q04B / Q07A / Q05B）：
 *  · 打开回收站文档 = **只读预览**（不再拒绝），横幅明说「编辑与保存会被拦」；
 *  · LakeEditor 必须走 interaction="preview"（无卡片菜单 / 无 copy-cut 接管，能力来自 Q07A）；
 *  · 字号 = 统一预览档 LAKE_PREVIEW_FONT_SIZE（不跟用户正文字号设置走，Q05B）；
 *  · 「恢复」仍是显式动作（bridge.restoreTreeItem / 小记 = bridge.restoreQuickNote）。
 *  · 261124：itemKind="quick" = 小记回收站行的预览（同一 viewer / 同一版面，读本机 .qnote、不补拉资源）。
 * 内核无法在 vitest 里实例化 ⇒ mock LakeEditor 只取 props（真机行为由 Lead 设备门禁验收）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  ensureTrashNoteAssets: vi.fn(),
  readNote: vi.fn(),
  restoreTreeItem: vi.fn(),
  readQuickNote: vi.fn(),
  listQuickNoteTrash: vi.fn(),
  restoreQuickNote: vi.fn(),
}));
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
  bridgeMock.restoreTreeItem.mockReset().mockResolvedValue({ parentTitle: "原笔记本", fellBack: false }); // 261124 落点回执
  bridgeMock.readQuickNote.mockReset();
  bridgeMock.listQuickNoteTrash.mockReset().mockResolvedValue([]);
  bridgeMock.restoreQuickNote.mockReset().mockResolvedValue(undefined);
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

  it("quick（261124 小记预览）：读本机 .qnote 正文进同一个 viewer，标题=预览文字，不做资源补拉", async () => {
    bridgeMock.readQuickNote.mockResolvedValue({
      id: "q1",
      content: { version: 3, text: "小记正文", body: "<p>小记正文</p>", images: [], tagIds: [], tags: [] },
      tagIds: [], tags: [], previewText: "小记预览文字", updatedAt: "2026-11-24T00:00:00.000Z",
    });
    act(() => root.render(<TrashPreviewPage noteId="q1" itemKind="quick" onBack={() => undefined} onRestored={() => undefined} />));
    await flush();

    expect(bridgeMock.ensureTrashNoteAssets).not.toHaveBeenCalled(); // 小记资产本机保留，无补拉语义
    expect(bridgeMock.readNote).not.toHaveBeenCalled();
    expect(container.textContent).toContain("小记预览文字");
    expect(container.textContent).toContain("该小记在回收站");
    const props = lakeProps.current;
    expect(props?.content).toBe("<p>小记正文</p>");
    expect(props?.interaction).toBe("preview");
    expect(props?.mode).toBe("viewer");
  });

  it("quick 读不到（已被恢复/彻底删除）：不挂内核，给明确提示（不留空白预览）", async () => {
    bridgeMock.readQuickNote.mockResolvedValue(null);
    act(() => root.render(<TrashPreviewPage noteId="q1" itemKind="quick" onBack={() => undefined} onRestored={() => undefined} />));
    await flush();
    expect(lakeProps.current).toBeNull();
    expect(container.textContent).toContain("已不可预览");
  });

  it("quick 恢复 = restoreQuickNote（不是 restoreTreeItem）+ onRestored", async () => {
    const onRestored = vi.fn();
    bridgeMock.readQuickNote.mockResolvedValue({
      id: "q1",
      content: { version: 3, text: "小记正文", body: "<p>小记正文</p>", images: [], tagIds: [], tags: [] },
      tagIds: [], tags: [], previewText: "小记预览文字", updatedAt: "2026-11-24T00:00:00.000Z",
    });
    act(() => root.render(<TrashPreviewPage noteId="q1" itemKind="quick" onBack={() => undefined} onRestored={onRestored} />));
    await flush();
    const restore = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("恢复"));
    expect(restore).toBeTruthy();
    await act(async () => { restore?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect(bridgeMock.restoreQuickNote).toHaveBeenCalledWith("q1");
    expect(bridgeMock.restoreTreeItem).not.toHaveBeenCalled();
    expect(onRestored).toHaveBeenCalledTimes(1);
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

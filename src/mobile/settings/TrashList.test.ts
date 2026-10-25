// @vitest-environment jsdom
/** 总回收站「云端已删除 · 仅本地」徽标（261026）：远端 v3 彻底删除后本机仅保留副本，徽标可见且仍可恢复。 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listTrashTree = vi.fn();
const listQuickNoteTrash = vi.fn();
const restoreTreeItem = vi.fn(async (_id: string, _kind: string) => undefined);
const restoreQuickNote = vi.fn(async (_id: string) => undefined);
vi.mock("../bridge", () => ({
  bridge: {
    listTrashTree: () => listTrashTree(),
    listQuickNoteTrash: () => listQuickNoteTrash(),
    restoreTreeItem: (id: string, kind: string) => restoreTreeItem(id, kind),
    restoreQuickNote: (id: string) => restoreQuickNote(id),
    purgeTreeItem: () => Promise.resolve(),
    purgeQuickNote: () => Promise.resolve(),
  },
}));

import { TrashList } from "./TrashList";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  listTrashTree.mockResolvedValue([]);
  listQuickNoteTrash.mockResolvedValue([]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () => {
    root.render(createElement(TrashList, { onChanged: async () => undefined, onPreview: () => undefined }));
  });
  // 组件在 useEffect 里异步 load：等一轮微任务后再断言
  await act(async () => { await Promise.resolve(); });
};

const rows = () => [...host.querySelectorAll<HTMLElement>(".mobile-doc-row")];
const badgeCount = () => host.querySelectorAll(".mobile-trash-cloud").length;

describe("移动端总回收站 · 云端已删除徽标", () => {
  it("笔记/小记的 cloudDeleted 行显示「云端已删除 · 仅本地」，普通回收站行不显示", async () => {
    const ts = "2026-10-25T00:00:00.000Z";
    listTrashTree.mockResolvedValue([
      { id: "n1", title: "云端已删文档", kind: "note", parentId: null, deletedAt: ts, cloudDeleted: true },
      { id: "n2", title: "普通回收站文档", kind: "note", parentId: null, deletedAt: ts, cloudDeleted: false },
    ]);
    listQuickNoteTrash.mockResolvedValue([
      { id: "q1", createdAt: ts, updatedAt: ts, deletedAt: ts, previewText: "云端已删小记", cloudDeleted: true },
    ]);
    await render();
    expect(rows()).toHaveLength(3);
    expect(badgeCount()).toBe(2);
    const texts = [...host.querySelectorAll(".mobile-trash-cloud")].map((el) => el.textContent);
    expect(texts).toEqual(["云端已删除 · 仅本地", "云端已删除 · 仅本地"]);
    // 徽标所在的行分别是云端已删文档 / 云端已删小记
    const badged = rows().filter((r) => r.querySelector(".mobile-trash-cloud")).map((r) => r.textContent);
    expect(badged[0]).toContain("云端已删文档");
    expect(badged[1]).toContain("云端已删小记");
  });

  it("带徽标的行仍可恢复（不限制恢复）", async () => {
    listTrashTree.mockResolvedValue([
      { id: "n1", title: "云端已删文档", kind: "note", parentId: null, deletedAt: "2026-10-25T00:00:00.000Z", cloudDeleted: true },
    ]);
    await render();
    const restoreBtn = rows()[0].querySelector<HTMLButtonElement>('button[title="恢复"]');
    expect(restoreBtn).not.toBeNull();
    await act(async () => { restoreBtn!.click(); await Promise.resolve(); });
    expect(restoreTreeItem).toHaveBeenCalledWith("n1", "note");
  });
});

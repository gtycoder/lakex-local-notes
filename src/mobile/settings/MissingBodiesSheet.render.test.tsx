// @vitest-environment jsdom
/**
 * 「缺正文/缺小记」列表渲染护栏（261104 B-lite）。
 *
 * 判据：每一行只出现该行**真能执行**的动作（云端不可用不给「从云端拉回」；没有缓存不给「重建纯文本」）；
 * 危险动作必须走 confirmMobile，取消时**不得**发生任何写入；失败原因用统一文案（不能静默）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  trashNote: vi.fn(async () => {}),
  purgeTreeItem: vi.fn(async () => {}),
  restoreHistory: vi.fn(async () => {}),
  restoreMissingNoteBody: vi.fn(async (_id: string): Promise<{ ok: boolean; title?: string; reason?: string }> => ({ ok: true, title: "恢复的标题" })),
  restoreMissingQuickNoteFromCloud: vi.fn(async (_id: string): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  recoverMissingQuickNoteFromText: vi.fn(async (_id: string): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  purgeQuickNote: vi.fn(async () => {}),
  confirmMobile: vi.fn(async () => true),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    trashNote: mocks.trashNote,
    purgeTreeItem: mocks.purgeTreeItem,
    restoreHistory: mocks.restoreHistory,
    restoreMissingNoteBody: mocks.restoreMissingNoteBody,
    restoreMissingQuickNoteFromCloud: mocks.restoreMissingQuickNoteFromCloud,
    recoverMissingQuickNoteFromText: mocks.recoverMissingQuickNoteFromText,
    purgeQuickNote: mocks.purgeQuickNote,
  },
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import { MissingBodiesList } from "./MissingBodiesSheet";
import type { MissingNoteBody, MissingQuickNote } from "../data/missingBodies";

const doc = (patch: Partial<MissingNoteBody>): MissingNoteBody => ({
  id: "n1", title: "缺正文的一篇", kind: "doc", updatedAt: "2026-11-01T00:00:00.000Z", parentId: null,
  historyCount: 0, lastHistoryId: null, hasSyncBase: false, cloudConfigured: true, recovery: "none",
  ...patch,
});

const qn = (patch: Partial<MissingQuickNote>): MissingQuickNote => ({
  id: "q1", createdAt: "", updatedAt: "2026-11-01T00:00:00.000Z", previewText: "缺正文的小记", imageCount: 0, tags: "",
  hasSyncBase: false, cloudConfigured: true, hasTextCache: false, recovery: "none",
  ...patch,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let changed: Mock<() => Promise<void>>;

const renderDocs = (docs: MissingNoteBody[], cloudConfigured = true): void => {
  act(() => root.render(createElement(MissingBodiesList, {
    mode: "docs", cloudConfigured, docs, quickNotes: [], onChanged: changed,
  })));
};
const renderQuickNotes = (quickNotes: MissingQuickNote[], cloudConfigured = true): void => {
  act(() => root.render(createElement(MissingBodiesList, {
    mode: "quickNotes", cloudConfigured, docs: [], quickNotes, onChanged: changed,
  })));
};
const buttonByText = (text: string): HTMLButtonElement | null =>
  ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === text) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  changed = vi.fn<() => Promise<void>>(async () => {});
  mocks.confirmMobile.mockResolvedValue(true);
  mocks.restoreMissingNoteBody.mockResolvedValue({ ok: true, title: "恢复的标题" });
  mocks.restoreMissingQuickNoteFromCloud.mockResolvedValue({ ok: true });
  mocks.recoverMissingQuickNoteFromText.mockResolvedValue({ ok: true });
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

describe("缺正文列表（文档）", () => {
  it("按可恢复路径只给真能做的动作：cloud 有「从云端拉回」、history 有「恢复最新历史」、none 只有删除", () => {
    renderDocs([
      doc({ id: "n-cloud", title: "可云恢复", recovery: "cloud", hasSyncBase: true }),
      doc({ id: "n-history", title: "只有历史", recovery: "history", historyCount: 2, lastHistoryId: 7 }),
      doc({ id: "n-none", title: "没有备份", recovery: "none" }),
    ]);
    const titles = [...host.querySelectorAll(".mb-set-block__name")].map((el) => el.textContent);
    expect(titles).toEqual(["可云恢复", "只有历史", "没有备份"]);
    expect(buttonByText("从云端拉回")).not.toBeNull();
    expect(buttonByText("恢复最新历史")).not.toBeNull();
    // 三个「彻底删除」：每行都有
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "彻底删除")).toHaveLength(3);
    // 恢复路径说明走统一文案
    expect(host.textContent).toContain("可以从云端拉回");
    expect(host.textContent).toContain("只能恢复历史版本");
    expect(host.textContent).toContain("没有可用备份");
  });

  it("云同步不可用时「从云端拉回」置灰（不诱导点了才报错）", () => {
    renderDocs([doc({ recovery: "cloud" })], false);
    const cloud = buttonByText("从云端拉回");
    expect(cloud?.disabled).toBe(true);
  });

  it("彻底删除：先 confirmMobile，再走「移入回收站 + purge」，最后刷新计数", async () => {
    renderDocs([doc({ id: "n1" })]);
    await act(async () => { buttonByText("彻底删除")!.click(); });
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    expect(mocks.trashNote).toHaveBeenCalledWith("n1");
    expect(mocks.purgeTreeItem).toHaveBeenCalledWith("n1", "note");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith("已彻底删除");
  });

  it("取消删除时什么都不写（confirm 是硬前置）", async () => {
    mocks.confirmMobile.mockResolvedValue(false);
    renderDocs([doc({ id: "n1" })]);
    await act(async () => { buttonByText("彻底删除")!.click(); });
    expect(mocks.trashNote).not.toHaveBeenCalled();
    expect(mocks.purgeTreeItem).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("从云端拉回失败：用统一文案弹错误，且不刷新计数", async () => {
    mocks.restoreMissingNoteBody.mockResolvedValue({ ok: false, reason: "hash-mismatch" });
    renderDocs([doc({ recovery: "cloud" })]);
    await act(async () => { buttonByText("从云端拉回")!.click(); });
    expect(mocks.showToast).toHaveBeenCalledWith("云端内容校验失败，没有写入", { type: "error" });
    expect(changed).not.toHaveBeenCalled();
    // 失败原因还要**留在 sheet 里**（toast 6 秒就没了，用户回来可能看不到）
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("云端内容校验失败，没有写入");
  });

  it("恢复成功后：常驻结果行 + 刷新计数；条目处理完落到空态", async () => {
    renderDocs([doc({ id: "n1", recovery: "cloud" })]);
    await act(async () => { buttonByText("从云端拉回")!.click(); });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已从云端拉回：恢复的标题");
    // 宿主 reload 后清单为空 ⇒ 计数与列表一起归零（设置页那一行随之隐藏）
    renderDocs([]);
    expect(host.textContent).toContain("没有缺正文的文档");
  });

  it("恢复最新历史：带上该篇最新快照 id 调 restoreHistory", async () => {
    renderDocs([doc({ id: "n2", recovery: "history", historyCount: 1, lastHistoryId: 42 })]);
    await act(async () => { buttonByText("恢复最新历史")!.click(); });
    expect(mocks.restoreHistory).toHaveBeenCalledWith(42);
    expect(mocks.showToast).toHaveBeenCalledWith("已恢复最新历史版本");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("空清单给占位说明", () => {
    renderDocs([]);
    expect(host.textContent).toContain("没有缺正文的文档");
  });
});

describe("缺小记列表", () => {
  it("有搜索缓存才给「重建纯文本」；云端与删除按路径给", () => {
    renderQuickNotes([
      qn({ id: "q-cloud", previewText: "可云恢复的小记", recovery: "cloud", hasSyncBase: true }),
      qn({ id: "q-text", previewText: "可重建的小记", recovery: "text", hasTextCache: true }),
      qn({ id: "q-none", previewText: "没备份的小记", recovery: "none" }),
    ]);
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "重建纯文本")).toHaveLength(1);
    expect(buttonByText("从云端拉回")).not.toBeNull();
    expect(host.textContent).toContain("可以用搜索缓存重建纯文本");
  });

  it("重建纯文本：先确认（会覆盖云端版本的后果说清），再调桥并提示有损", async () => {
    renderQuickNotes([qn({ id: "q1", recovery: "text", hasTextCache: true })]);
    await act(async () => { buttonByText("重建纯文本")!.click(); });
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    const confirmArgs = mocks.confirmMobile.mock.calls[0] as unknown as [{ body?: string }];
    expect(String(confirmArgs[0].body)).toContain("可能覆盖云端版本");
    expect(mocks.recoverMissingQuickNoteFromText).toHaveBeenCalledWith("q1");
    expect(mocks.showToast).toHaveBeenCalledWith("已用搜索缓存重建纯文本，图片与格式会丢失");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("小记云端恢复失败：明确报原因；彻底删除走 purgeQuickNote（不读正文）", async () => {
    mocks.restoreMissingQuickNoteFromCloud.mockResolvedValue({ ok: false, reason: "cloud-off" });
    renderQuickNotes([qn({ id: "q1", recovery: "cloud" })]);
    await act(async () => { buttonByText("从云端拉回")!.click(); });
    expect(mocks.showToast).toHaveBeenCalledWith("云同步已关闭，无法从云端拉回", { type: "error" });

    await act(async () => { buttonByText("彻底删除")!.click(); });
    expect(mocks.purgeQuickNote).toHaveBeenCalledWith("q1");
    expect(mocks.trashNote).not.toHaveBeenCalled();
  });

  it("空清单给占位说明", () => {
    renderQuickNotes([]);
    expect(host.textContent).toContain("没有缺小记");
  });
});

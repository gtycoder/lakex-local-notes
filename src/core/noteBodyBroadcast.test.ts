import { describe, expect, it } from "vitest";
import { shouldReloadOnNoteBodyChanged } from "./noteBodyBroadcast";

const detail = (over: Partial<{ noteId: string; contentHash: string }> = {}) => ({ noteId: "n1", contentHash: "H2", ...over });
const tab = (over: Partial<{ noteId: string; dirty: boolean; deleted: boolean; baseHash: string }> = {}) =>
  ({ noteId: "n1", dirty: false, deleted: false, baseHash: "H1", ...over });

describe("正文变更广播判据（261110）", () => {
  it("没打开这篇 ⇒ 不重读（省资源）", () => {
    expect(shouldReloadOnNoteBodyChanged(tab({ noteId: "n2" }), detail())).toBe(false);
  });
  it("本地有未保存编辑 ⇒ 不覆盖（交给保存守卫冲突流程）", () => {
    expect(shouldReloadOnNoteBodyChanged(tab({ dirty: true }), detail())).toBe(false);
  });
  it("已删除标记的 tab ⇒ 不重读", () => {
    expect(shouldReloadOnNoteBodyChanged(tab({ deleted: true }), detail())).toBe(false);
  });
  it("baseHash 已经等于广播的 hash（自己的回声 / 已最新）⇒ 跳过", () => {
    expect(shouldReloadOnNoteBodyChanged(tab({ baseHash: "H2" }), detail())).toBe(false);
  });
  it("打开且干净且落后一个版本 ⇒ 重读", () => {
    expect(shouldReloadOnNoteBodyChanged(tab(), detail())).toBe(true);
  });
  it("老主进程不带 contentHash ⇒ 保守重读", () => {
    expect(shouldReloadOnNoteBodyChanged(tab(), { noteId: "n1" })).toBe(true);
  });
});

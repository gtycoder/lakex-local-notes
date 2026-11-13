/**
 * 删除后关标签的统一通道（261114 task-8）：注册/广播/注销；空 ids 不广播；多订阅者都收到。
 * 真接线行为（cancelAutoSave + 标签消失）在 useWorkspaceSession.test.ts 覆盖。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissNoteTabs, registerNoteTabDismisser } from "./tabDismissal";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  vi.restoreAllMocks();
});

describe("tabDismissal：删除入口 → 工作区关闭标签的单一通道", () => {
  it("每个注册者都收到同一份 note ids；注销后不再收到", () => {
    const first = vi.fn();
    const second = vi.fn();
    cleanups.push(registerNoteTabDismisser(first), registerNoteTabDismisser(second));
    dismissNoteTabs(["n1", "n2"]);
    expect(first).toHaveBeenCalledWith(["n1", "n2"]);
    expect(second).toHaveBeenCalledWith(["n1", "n2"]);

    cleanups.pop()?.(); // 注销 second
    dismissNoteTabs(["n3"]);
    expect(first).toHaveBeenCalledWith(["n3"]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("空 ids 不广播（删除没命中任何文档时不打扰工作区）", () => {
    const dismisser = vi.fn();
    cleanups.push(registerNoteTabDismisser(dismisser));
    dismissNoteTabs([]);
    expect(dismisser).not.toHaveBeenCalled();
  });

  it("没有订阅者（工作区未挂载）时是安全 no-op", () => {
    expect(() => dismissNoteTabs(["n1"])).not.toThrow();
  });
});

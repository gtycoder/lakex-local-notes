// @vitest-environment jsdom
/** 设备级「默认笔记本」设置（261106 task-86）：localStorage，不参与同步。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearImportDefaultNotebookForTest, readImportDefaultNotebook, writeImportDefaultNotebook } from "./importSettings";

afterEach(() => { clearImportDefaultNotebookForTest(); });

describe("默认笔记本（导入设置）", () => {
  it("未设置 ⇒ null；写入后可读；清空后回到 null", () => {
    expect(readImportDefaultNotebook()).toBeNull();
    writeImportDefaultNotebook("nb1");
    expect(readImportDefaultNotebook()).toBe("nb1");
    writeImportDefaultNotebook(null);
    expect(readImportDefaultNotebook()).toBeNull();
  });

  it("空串/空白不算已设置", () => {
    writeImportDefaultNotebook("");
    expect(readImportDefaultNotebook()).toBeNull();
    localStorage.setItem("lakex-local-notes-mobile.import.default-notebook", "   ");
    expect(readImportDefaultNotebook()).toBeNull();
  });

  it("存储不可用时不抛错（读取回落 null）", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(readImportDefaultNotebook()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

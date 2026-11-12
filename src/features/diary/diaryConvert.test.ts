import { describe, expect, it, vi } from "vitest";
import { convertDiaryEntryToDocument, type DiaryConvertIo } from "./diaryConvert";

/**
 * 「转为文档」执行序（261112 task-91）：先 move 再 rename（日记条目不接受改名），失败必须可见。
 * 这些用例就是 App 注入动作的契约：改名不能在校验/移动之前调用，失败不许静默假装成功。
 */
function makeIo(overrides: Partial<DiaryConvertIo> = {}) {
  const calls: string[] = [];
  const io: DiaryConvertIo = {
    move: vi.fn(async (id: string, target: string) => { calls.push("move:" + id + ">" + target); }),
    rename: vi.fn(async (id: string, title: string) => { calls.push("rename:" + id + ">" + title); }),
    refresh: vi.fn(async () => { calls.push("refresh"); }),
    notice: vi.fn((text: string) => { calls.push("notice:" + text); }),
    error: vi.fn((text: string) => { calls.push("error:" + text); }),
    ...overrides,
  };
  return { io, calls };
}

const input = (over: Partial<Parameters<typeof convertDiaryEntryToDocument>[1]> = {}) => ({
  nodeId: "e-old", targetNotebookId: "nb-doc", title: "去年总结", previousTitle: "2025-12-31", ...over,
});

describe("convertDiaryEntryToDocument（转为文档执行序）", () => {
  it("成功：先 move 再 rename，随后刷新并提示最终标题", async () => {
    const { io, calls } = makeIo();
    const outcome = await convertDiaryEntryToDocument(io, input());
    expect(calls).toEqual([
      "move:e-old>nb-doc",
      "rename:e-old>去年总结",
      "refresh",
      "notice:已转为文档：去年总结",
    ]);
    expect(io.move).toHaveBeenCalledWith("e-old", "nb-doc");
    expect(outcome).toEqual({ moved: true, renamed: true });
  });

  it("标题没改（仍是日期键）⇒ 不写盘改名，只移动 + 刷新 + 提示", async () => {
    const { io, calls } = makeIo();
    const outcome = await convertDiaryEntryToDocument(io, input({ title: "2025-12-31" }));
    expect(io.rename).not.toHaveBeenCalled();
    expect(calls).toEqual(["move:e-old>nb-doc", "refresh", "notice:已转为文档：2025-12-31"]);
    expect(outcome).toEqual({ moved: true, renamed: false });
  });

  it("空白标题（防御）当未改：不改名，提示用原日期标题", async () => {
    const { io, calls } = makeIo();
    const outcome = await convertDiaryEntryToDocument(io, input({ title: "   " }));
    expect(io.rename).not.toHaveBeenCalled();
    expect(calls).toContain("notice:已转为文档：2025-12-31");
    expect(outcome).toEqual({ moved: true, renamed: false });
  });

  it("移动失败：不动标题、不刷新、不假装成功（错误可见）", async () => {
    const { io, calls } = makeIo({ move: vi.fn(async () => { throw new Error("目标笔记本不存在"); }) });
    const outcome = await convertDiaryEntryToDocument(io, input());
    expect(calls).toEqual(["error:转为文档失败：目标笔记本不存在"]);
    expect(io.rename).not.toHaveBeenCalled();
    expect(io.refresh).not.toHaveBeenCalled();
    expect(outcome).toEqual({ moved: false, renamed: false });
  });

  it("改名失败：文档已移出 ⇒ 仍刷新并明确说「已移出、但改名失败」，不提示成功", async () => {
    const { io, calls } = makeIo({ rename: vi.fn(async () => { throw new Error("名称不能为空"); }) });
    const outcome = await convertDiaryEntryToDocument(io, input());
    expect(calls).toEqual([
      "move:e-old>nb-doc",
      "refresh",
      "error:已移出日记本，但改名失败：名称不能为空",
    ]);
    expect(io.notice).not.toHaveBeenCalled();
    expect(outcome).toEqual({ moved: true, renamed: false });
  });
});

import { describe, expect, it, vi } from "vitest";
import { installMediaCardCategoryRouter } from "./mediaCardRouting.js";

type ExecArgs = [unknown[], Record<string, unknown>?];

interface FakeEditing {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

interface FakeRenderer {
  execCommand: ReturnType<typeof vi.fn>;
}

interface FakeEditor {
  editing: FakeEditing;
  renderer: FakeRenderer;
}

/** 构造 mock 编辑器；返回 { editor, fire, dispatchLog }。 */
function makeEditor() {
  const editing: FakeEditing = { on: vi.fn(), off: vi.fn() };
  const renderer: FakeRenderer = { execCommand: vi.fn() };
  const editor = { editing, renderer } as unknown as Parameters<typeof installMediaCardCategoryRouter>[0];
  const fire = (commandName: string, args: unknown[]): void => {
    // 找到注册的 handler 并同步触发
    const calls = editing.on.mock.calls;
    for (const [event, handler] of calls) {
      if (event === "beforeExecCommand") {
        (handler as (e: { commandName: string; args: unknown[] }) => void)({ commandName, args });
      }
    }
  };
  const dispatchLog = (): Array<{ args0Len: number; opts: Record<string, unknown> | undefined }> =>
    renderer.execCommand.mock.calls.map((c) => {
      const args0 = c[1] as unknown[];
      const opts = c[2] as Record<string, unknown> | undefined;
      return { args0Len: args0.length, opts };
    });
  return { editor, fire, dispatchLog, editing, renderer };
}

const fileOf = (name: string): File => new File([new Uint8Array(4)], name);

describe("installMediaCardCategoryRouter", () => {
  it("routes all-audio attachment insert to native audio card via args rewrite", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("a.mp3"), fileOf("b.wav")], { from: "ui", category: "file" }];
    fire("insertFiles", args);
    // 原命令参数被改写为 audio 分类（单次事务，不异步重发）
    expect(renderer.execCommand).not.toHaveBeenCalled();
    expect(args[0]).toHaveLength(2);
    expect(args[1]).toMatchObject({ category: "audio", from: "ui" });
    dispose();
  });

  it("routes all-video attachment insert to native video card", () => {
    const { editor, fire } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("c.mp4")], { from: "ui", category: "file" }];
    fire("insertFiles", args);
    expect(args[1]).toMatchObject({ category: "video", from: "ui" });
    dispose();
  });

  it("routes all-image attachment insert to native image card", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("p.png"), fileOf("q.webp")], { from: "ui", category: "file" }];
    fire("insertFiles", args);
    expect(renderer.execCommand).not.toHaveBeenCalled();
    expect(args[1]).toMatchObject({ category: "image", from: "ui" });
    dispose();
  });

  it("routes mixed image+audio+pdf batch in original order", () => {
    vi.useFakeTimers();
    try {
      const { editor, fire, dispatchLog, renderer } = makeEditor();
      const dispose = installMediaCardCategoryRouter(editor);
      const args: ExecArgs = [[fileOf("a.mp3"), fileOf("b.png"), fileOf("c.pdf")], { from: "ui", category: "file" }];
      fire("insertFiles", args);
      expect(args[0]).toHaveLength(0);
      expect(renderer.execCommand).not.toHaveBeenCalled();
      vi.runAllTimers();
      const log = dispatchLog();
      expect(log).toEqual([
        { args0Len: 1, opts: { category: "audio", from: "ui" } },
        { args0Len: 1, opts: { category: "image", from: "ui" } },
        { args0Len: 1, opts: { category: "file", from: "ui" } },
      ]);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes mixed batch: no-op original, async re-dispatch in original order", () => {
    vi.useFakeTimers();
    try {
      const { editor, fire, dispatchLog, renderer } = makeEditor();
      const dispose = installMediaCardCategoryRouter(editor);
      const args: ExecArgs = [[fileOf("a.mp3"), fileOf("b.pdf"), fileOf("c.mp4"), fileOf("d.wav")], { from: "ui", category: "file" }];
      fire("insertFiles", args);
      // 原命令 no-op（空文件列表）
      expect(args[0]).toHaveLength(0);
      // 异步分批（audio → file → video → audio，保持原顺序）
      expect(renderer.execCommand).not.toHaveBeenCalled();
      vi.runAllTimers();
      const log = dispatchLog();
      expect(log).toEqual([
        { args0Len: 1, opts: { category: "audio", from: "ui" } },
        { args0Len: 1, opts: { category: "file", from: "ui" } },
        { args0Len: 1, opts: { category: "video", from: "ui" } },
        { args0Len: 1, opts: { category: "audio", from: "ui" } },
      ]);
      // 重发的 execCommand 都带 insertFiles 且文件保持原顺序
      const files = renderer.execCommand.mock.calls.map((c) => (c[1] as File[])[0].name);
      expect(files).toEqual(["a.mp3", "b.pdf", "c.mp4", "d.wav"]);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves non-media attachment insert untouched", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("a.pdf"), fileOf("b.zip")], { from: "ui", category: "file" }];
    fire("insertFiles", args);
    expect(renderer.execCommand).not.toHaveBeenCalled();
    // args 未被改写（引用同一批文件，无 category 注入）
    expect(args[0]).toHaveLength(2);
    expect(args[1]).toMatchObject({ category: "file" });
    dispose();
  });

  it("leaves already-categorized media insert untouched (no recursion)", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("a.mp3")], { category: "audio", from: "ui" }];
    fire("insertFiles", args);
    expect(renderer.execCommand).not.toHaveBeenCalled();
    expect(args[1]).toMatchObject({ category: "audio" });
    // 图片路径不动
    const imgArgs: ExecArgs = [[fileOf("p.png")], { category: "image", from: "ui" }];
    fire("insertFiles", imgArgs);
    expect(imgArgs[1]).toMatchObject({ category: "image" });
    dispose();
  });

  it("handles dropFile command the same way", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    const args: ExecArgs = [[fileOf("v.mp4")], undefined];
    fire("dropFile", args);
    expect(renderer.execCommand).not.toHaveBeenCalled();
    expect(args[1]).toMatchObject({ category: "video", from: "ui" });
    dispose();
  });

  it("ignores unknown commands and non-array args", () => {
    const { editor, fire, renderer } = makeEditor();
    const dispose = installMediaCardCategoryRouter(editor);
    fire("bold", [true]);
    const args: ExecArgs = [[fileOf("a.mp3")], undefined];
    fire("insertFiles", args);
    expect(renderer.execCommand).not.toHaveBeenCalled();
    expect(args[1]).toMatchObject({ category: "audio" });
    // 非数组 args 不崩溃
    fire("insertFiles", ["not-array" as unknown as unknown[]]);
    dispose();
  });

  it("cleanup removes the listener and cancels pending timers", () => {
    vi.useFakeTimers();
    try {
      const { editor, fire, renderer, editing } = makeEditor();
      const dispose = installMediaCardCategoryRouter(editor);
      const args: ExecArgs = [[fileOf("a.mp3"), fileOf("b.pdf")], { from: "ui", category: "file" }];
      fire("insertFiles", args);
      dispose();
      vi.runAllTimers();
      // dispose 后挂起的重发被取消
      expect(renderer.execCommand).not.toHaveBeenCalled();
      expect(editing.off).toHaveBeenCalledWith("beforeExecCommand", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op when editor has no editing bus", () => {
    const editor = { renderer: { execCommand: vi.fn() } } as unknown as Parameters<typeof installMediaCardCategoryRouter>[0];
    const dispose = installMediaCardCategoryRouter(editor);
    expect(() => dispose()).not.toThrow();
  });
});

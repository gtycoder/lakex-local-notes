import { describe, expect, it, vi } from "vitest";
import { MarkdownImportError, type MarkdownConvertOptions } from "../import/markdownImportPipeline";
import {
  AI_MARKDOWN_CONVERT_TIMEOUT_MS,
  AI_MARKDOWN_VISIBILITY_WAIT_MS,
  convertAiMarkdown,
  type ConvertVisibility,
} from "./convertAiMarkdown";

const result = { body: '<div data-lake-id="x">ok</div>', warnings: [], imageCount: 0, durationMs: 1 };

function visibility(overrides: Partial<ConvertVisibility> = {}): ConvertVisibility & { waits: number[] } {
  const waits: number[] = [];
  return {
    isHidden: () => false,
    waitVisible: async (timeoutMs: number) => { waits.push(timeoutMs); },
    waits,
    ...overrides,
  } as ConvertVisibility & { waits: number[] };
}

describe("convertAiMarkdown", () => {
  it("正常路径：单次调用，带 60s 预算与取消信号", async () => {
    const signal = new AbortController().signal;
    const convert = vi.fn(async (_options: MarkdownConvertOptions) => result);
    await expect(convertAiMarkdown("# hi", convert, { signal, visibility: visibility() })).resolves.toEqual(result);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert.mock.calls[0][0]).toMatchObject({ markdown: "# hi", convertTimeoutMs: AI_MARKDOWN_CONVERT_TIMEOUT_MS, signal });
  });

  it("窗口不可见：先等可见再转换（内核在遮挡窗口不推进，白等只会超时）", async () => {
    const vis = visibility({ isHidden: () => true });
    const convert = vi.fn(async () => result);
    await convertAiMarkdown("# hi", convert, { visibility: vis });
    expect(vis.waits).toEqual([AI_MARKDOWN_VISIBILITY_WAIT_MS]);
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("等可见超时 ⇒ 仍然尝试转换（可见性探测可能误判，硬失败会挡掉正常转换）", async () => {
    const vis = visibility({ isHidden: () => true });
    const convert = vi.fn(async (_options: MarkdownConvertOptions) => result);
    await expect(convertAiMarkdown("# hi", convert, { visibility: vis })).resolves.toEqual(result);
    expect(vis.waits).toEqual([AI_MARKDOWN_VISIBILITY_WAIT_MS]);
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("仍不可见时只跑一次（重试注定无意义，别把等待翻倍）", async () => {
    const vis = visibility({ isHidden: () => true });
    const convert = vi.fn().mockRejectedValue(new MarkdownImportError("render-timeout", "超时"));
    await expect(convertAiMarkdown("# hi", convert, { visibility: vis })).rejects.toMatchObject({ code: "render-timeout" });
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("render-timeout 重建一次后成功（临时内核卡死可自愈）", async () => {
    const convert = vi.fn()
      .mockRejectedValueOnce(new MarkdownImportError("render-timeout", "超时"))
      .mockResolvedValueOnce(result);
    await expect(convertAiMarkdown("# hi", convert, { visibility: visibility() })).resolves.toEqual(result);
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("两次都超时 ⇒ 给出可操作错误", async () => {
    const convert = vi.fn().mockRejectedValue(new MarkdownImportError("render-timeout", "超时"));
    await expect(convertAiMarkdown("# hi", convert, { visibility: visibility() })).rejects.toMatchObject({
      code: "render-timeout",
      message: expect.stringContaining("窗口在前台"),
    });
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("非超时错误（too-large / no-lake-id）不重试", async () => {
    const convert = vi.fn().mockRejectedValue(new MarkdownImportError("no-lake-id", "缺少 id"));
    await expect(convertAiMarkdown("# hi", convert, { visibility: visibility() })).rejects.toMatchObject({ code: "no-lake-id" });
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("取消：转换阶段 aborted 不重试", async () => {
    const controller = new AbortController();
    const convert = vi.fn(async () => { controller.abort(); throw new MarkdownImportError("aborted", "已取消"); });
    await expect(convertAiMarkdown("# hi", convert, { signal: controller.signal, visibility: visibility() })).rejects.toMatchObject({ code: "aborted" });
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("取消：等可见阶段 aborted 立即退出", async () => {
    const controller = new AbortController();
    const vis = visibility({
      isHidden: () => true,
      waitVisible: async () => { throw new MarkdownImportError("aborted", "已取消"); },
    });
    const convert = vi.fn(async () => result);
    await expect(convertAiMarkdown("# hi", convert, { signal: controller.signal, visibility: vis })).rejects.toMatchObject({ code: "aborted" });
    expect(convert).not.toHaveBeenCalled();
  });
});

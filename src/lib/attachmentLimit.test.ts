import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ maxAttachmentBytes: 25 * 1024 * 1024 }));

vi.mock("./settings", () => ({
  loadSettings: () => ({ maxAttachmentBytes: settings.maxAttachmentBytes }),
}));

import {
  assertAttachmentWithinLimit,
  AttachmentLimitExceededError,
  attachmentLimitMessage,
  effectiveAttachmentLimitBytes,
  formatAttachmentSize,
  subscribeAttachmentLimitErrors,
} from "./attachmentLimit";

afterEach(() => {
  settings.maxAttachmentBytes = 25 * 1024 * 1024;
});

describe("附件上限与超限提示", () => {
  it("读取设置并夹到协议上限；损坏值回落默认 25 MiB", () => {
    settings.maxAttachmentBytes = 50 * 1024 * 1024;
    expect(effectiveAttachmentLimitBytes()).toBe(50 * 1024 * 1024);
    settings.maxAttachmentBytes = 500 * 1024 * 1024;
    expect(effectiveAttachmentLimitBytes()).toBe(100 * 1024 * 1024);
    settings.maxAttachmentBytes = Number.NaN;
    expect(effectiveAttachmentLimitBytes()).toBe(25 * 1024 * 1024);
  });

  it("统一展示文件名、实际大小、当前上限和设置路径", () => {
    const message = attachmentLimitMessage("报告.pdf", 32.5 * 1024 * 1024, 25 * 1024 * 1024);
    expect(message).toContain("报告.pdf");
    expect(message).toContain("32.5 MiB");
    expect(message).toContain("25 MiB");
    expect(message).toContain("比上限多 7.5 MiB");
    expect(message).toContain("设置 → 常规 → 附件大小上限");
    expect(formatAttachmentSize(1536 * 1024)).toBe("1.5 MiB");
  });

  it("超限只通知一次并抛出可识别错误；等于上限允许", () => {
    const listener = vi.fn();
    const dispose = subscribeAttachmentLimitErrors(listener);
    expect(() => assertAttachmentWithinLimit(25 * 1024 * 1024, "ok.pdf", 25 * 1024 * 1024)).not.toThrow();
    expect(() => assertAttachmentWithinLimit(25 * 1024 * 1024 + 1, "big.pdf", 25 * 1024 * 1024))
      .toThrow(AttachmentLimitExceededError);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].message).toContain("big.pdf");
    expect(listener.mock.calls[0][0].message).toContain("比上限多 1 B");
    dispose();
  });
});

import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../core/storeLimits.js";

const settings = vi.hoisted(() => ({ maxAttachmentBytes: 1024 * 1024 }));

vi.mock("../../lib/settings", () => ({
  loadSettings: () => ({ maxAttachmentBytes: settings.maxAttachmentBytes }),
}));

import { assertResourceBytes, effectiveAttachmentLimitBytes } from "./context";

describe("移动端附件上限读设置（MOB-09）", () => {
  it("取设置里的 maxAttachmentBytes（与设置页同键），不再是固定 100MiB", () => {
    settings.maxAttachmentBytes = 1024 * 1024;
    expect(effectiveAttachmentLimitBytes()).toBe(1024 * 1024);
    // 非图片字节：1MiB 通过、超 1 字节拒绝，提示用设置档位
    expect(() => assertResourceBytes(new Uint8Array(1024 * 1024))).not.toThrow();
    expect(() => assertResourceBytes(new Uint8Array(1024 * 1024 + 1))).toThrow("附件超过 1 MiB 上传上限");
  });

  it("保留协议上限夹取（异常大/非法值不会放宽）", () => {
    settings.maxAttachmentBytes = 500 * 1024 * 1024;
    expect(effectiveAttachmentLimitBytes()).toBe(MAX_ATTACHMENT_BYTES);
    settings.maxAttachmentBytes = 0;
    expect(effectiveAttachmentLimitBytes()).toBe(MAX_ATTACHMENT_BYTES);
    settings.maxAttachmentBytes = Number.NaN;
    expect(effectiveAttachmentLimitBytes()).toBe(MAX_ATTACHMENT_BYTES);
  });
});

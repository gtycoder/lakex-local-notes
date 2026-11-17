// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ maxAttachmentBytes: 1024 * 1024 }));

vi.mock("../../lib/settings", () => ({
  loadSettings: () => ({ maxAttachmentBytes: settings.maxAttachmentBytes }),
}));

import { AttachmentLimitExceededError, subscribeAttachmentLimitErrors } from "../../lib/attachmentLimit";
import { uploadLakeResource } from "./resourceUpload";

afterEach(() => {
  settings.maxAttachmentBytes = 1024 * 1024;
});

describe("编辑器上传入口的超限提醒", () => {
  it.each([
    ["photo.png", "image/png"],
    ["clip.mp4", "video/mp4"],
    ["报告.pdf", "application/pdf"],
  ])("%s 超限时不进入上传，只发一次明确通知", async (filename, type) => {
    const listener = vi.fn();
    const dispose = subscribeAttachmentLimitErrors(listener);
    const file = new File([new Uint8Array(1024 * 1024 + 1)], filename, { type });

    await expect(uploadLakeResource(file, "note-1")).rejects.toBeInstanceOf(AttachmentLimitExceededError);

    expect(listener).toHaveBeenCalledTimes(1);
    const message = listener.mock.calls[0][0].message as string;
    expect(message).toContain(filename);
    expect(message).toContain("1 MiB");
    expect(message).toContain("设置 → 常规 → 附件大小上限");
    dispose();
  });
});

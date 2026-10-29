/**
 * 跨端「资源行为」契约装置（桌面 adapter + 移动 adapter 各跑一遍 vitest）。
 *
 * 位置说明（CORE-10）：本文件 import vitest，**不属于生产代码** ⇒ 放在 src/testing/（core 之外），
 * 防止被入口/组件误 import 时把测试框架打进产物。core 只放纯逻辑。
 */
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES } from "../core/storeLimits.js";

export interface ResourceBehaviorAdapter {
  upload(input: { bytes: Uint8Array; filename: string }, noteId: string): Promise<unknown>;
  dispose?(): Promise<void> | void;
}

export function defineResourceBehaviorContract(
  platformName: string,
  createAdapter: () => ResourceBehaviorAdapter | Promise<ResourceBehaviorAdapter>,
): void {
  describe(`${platformName} resource behavior contract`, () => {
    it("rejects oversized attachments and images before writing files", async () => {
      const adapter = await createAdapter();
      try {
        const oversizedAttachment = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
        oversizedAttachment.set(new TextEncoder().encode("%PDF"));
        // 上限文案按平台实际口径：桌面 = 协议上限 100 MiB，移动端 = 设置里的「附件大小上限」
        // （MOB-09 起读 loadSettings().maxAttachmentBytes，默认 25 MiB）⇒ 只校验"超过多少 MiB"这段。
        await expect(adapter.upload({ bytes: oversizedAttachment, filename: "big.pdf" }, "contract-note"))
          .rejects.toThrow(/附件超过 .* MiB/);

        const oversizedImage = new Uint8Array(MAX_IMAGE_BYTES + 1);
        oversizedImage.set(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
        await expect(adapter.upload({ bytes: oversizedImage, filename: "big.png" }, "contract-note"))
          .rejects.toThrow(/图片为空或超过 25 MiB/);
      } finally {
        await adapter.dispose?.();
      }
    });
  });
}

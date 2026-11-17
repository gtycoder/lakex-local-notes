/**
 * 跨端「资源行为」契约装置（桌面 adapter + 移动 adapter 各跑一遍 vitest）。
 *
 * 位置说明（CORE-10）：本文件 import vitest，**不属于生产代码** ⇒ 放在 src/testing/（core 之外），
 * 防止被入口/组件误 import 时把测试框架打进产物。core 只放纯逻辑。
 */
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../core/storeLimits.js";

export interface ResourceBehaviorAdapter {
  upload(input: { bytes: Uint8Array; filename: string }, noteId: string): Promise<unknown>;
  dispose?(): Promise<void> | void;
}

export function defineResourceBehaviorContract(
  platformName: string,
  createAdapter: () => ResourceBehaviorAdapter | Promise<ResourceBehaviorAdapter>,
): void {
  describe(`${platformName} resource behavior contract`, () => {
    it("rejects resources beyond the 100 MiB protocol limit before writing files", async () => {
      const adapter = await createAdapter();
      try {
        const oversizedAttachment = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
        oversizedAttachment.set(new TextEncoder().encode("%PDF"));
        // 本机 25/50/100 MiB 设置由各自上传入口先拦；本契约验证底层协议硬上限。
        await expect(adapter.upload({ bytes: oversizedAttachment, filename: "big.pdf" }, "contract-note"))
          .rejects.toThrow(/无法插入.*附件上限|附件.*上限/);

        const oversizedImage = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
        oversizedImage.set(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
        await expect(adapter.upload({ bytes: oversizedImage, filename: "big.png" }, "contract-note"))
          .rejects.toThrow(/无法插入.*附件上限|图片.*上限/);
      } finally {
        await adapter.dispose?.();
      }
    });
  });
}

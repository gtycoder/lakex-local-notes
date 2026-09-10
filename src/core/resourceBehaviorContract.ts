import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES } from "./storeLimits.js";

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
        await expect(adapter.upload({ bytes: oversizedAttachment, filename: "big.pdf" }, "contract-note"))
          .rejects.toThrow(/附件超过 100 MiB 协议上限/);

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerPickedLocalFile, registeredLocalFileReader, resetLocalAttachmentRegistryForTest } from "./localAttachments.js";
import { resolveAiMessages } from "./aiContentResolver.js";

/**
 * Phase 2 真实链路（不 mock unpdf）：真实 PDF → 选择时解析并缓存 → resolver 输出带文件名/页数/正文的 text 块。
 * 用内嵌的最小 PDF（1 页、Helvetica 文本），避免测试依赖外部文件。
 */
const PDF_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzNjggPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgo3MiA3NjAgVGQKKFBoYXNlIDIgUERGIEF0dGFjaG1lbnQgU2FtcGxlKSBUagowIC0yMCBUZAooVGhpcyBQREYgaXMgdXNlZCB0byB2ZXJpZnkgQUkgd3JpdGluZyBhdHRhY2htZW50IHBhcnNpbmcuKSBUagowIC0yMCBUZAooS2V5IHBvaW50OiBQREYgdGV4dCBpcyBleHRyYWN0ZWQgaW4gdGhlIG1haW4gcHJvY2VzcywpIFRqCjAgLTIwIFRkCih0aGVuIHNlbnQgdG8gdGhlIHByb3ZpZGVyIGFzIGEgcGxhaW4gdGV4dCBibG9jayB3aXRoIGZpbGVuYW1lIGFuZCBwYWdlIGNvdW50LikgVGoKMCAtMjAgVGQKKEJ1ZGdldDogbWF4IDMyTUIgc291cmNlLCA2MDAwMCBjaGFycyBleHRyYWN0ZWQsIDEwcyB0aW1lb3V0LikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA2NTkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo3MjkKJSVFT0YK";

const dirs: string[] = [];
afterEach(() => {
  resetLocalAttachmentRegistryForTest();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("PDF 本机附件真实链路（Phase 2）", () => {
  it("解析一次 → 缓存 → 发送为 text 块（含文件名/页数/正文），不是 image_url", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-pdf-e2e-"));
    dirs.push(dir);
    const file = path.join(dir, "phase2-report.pdf");
    fs.writeFileSync(file, Buffer.from(PDF_BASE64, "base64"));
    const picked = (await registerPickedLocalFile(file))!;
    expect(picked.kind).toBe("pdf");
    expect(picked.ref.pages).toBe(1);
    const out = await resolveAiMessages(
      [{ role: "user", content: [{ type: "local_file", file: picked.ref }] }],
      { readAssetBytes: () => null },
      registeredLocalFileReader,
    );
    const parts = out[0].content as Array<{ type: string; text?: string; image_url?: unknown }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect(parts[0].image_url).toBeUndefined();
    expect(parts[0].text).toContain("【附件：phase2-report.pdf（PDF，1 页）】");
    expect(parts[0].text).toContain("Phase 2 PDF Attachment Sample");
    expect(parts[0].text).toContain("PDF text is extracted in the main process");
    // 证据：真实链路产出的供应商消息（截图/报告用）
    console.log("PDF_E2E_PROVIDER_TEXT", JSON.stringify(parts[0].text));
  });
});

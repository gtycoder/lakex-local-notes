import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RESOLVER = readFileSync(new URL("./aiContentResolver.ts", import.meta.url), "utf8");
const REGISTER = readFileSync(new URL("../ipc/registerAi.ts", import.meta.url), "utf8");
const CORE = readFileSync(new URL("../../src/core/aiProviders.ts", import.meta.url), "utf8");
// 261023：入参护栏已上收 core（桌面/移动共用一份预算），静态断言跟随单一来源。
const MESSAGES = readFileSync(new URL("../../src/core/aiChatMessages.ts", import.meta.url), "utf8");

describe("多模态链路护栏（261006）", () => {
  it("ai_chat 先校验再解析内容块，才发给供应商", () => {
    expect(REGISTER).toContain("resolveAiMessages(assertMessages(messages), store)");
  });

  it("解析器：图片 → image_url；文档仅 PDF；附件缺失 / 超限明确报错", () => {
    expect(RESOLVER).toContain('type: "image_url"');
    expect(RESOLVER).toContain('"（当前仅支持 PDF）"');
    expect(RESOLVER).toContain("AI_MAX_TOTAL_IMAGE_BYTES");
    expect(RESOLVER).toContain('throw new AppError("NotFound"');
  });

  it("校验层：图片 / 文档只允许 user，且有数量上限", () => {
    expect(MESSAGES).toContain("图片 / 文档只能作为「用户」消息发送");
    expect(MESSAGES).toContain("AI_MAX_IMAGES");
    expect(MESSAGES).toContain("AI_MAX_DOCUMENTS");
  });

  it("core 内容块模型只有 text / image / document，且不引入 node/electron", () => {
    expect(CORE).toContain('| { type: "image"; asset: AiAssetRef }');
    expect(CORE).toContain('| { type: "document"; asset: AiAssetRef }');
    expect(CORE).not.toMatch(/from "node:|require\("node:/);
  });
});

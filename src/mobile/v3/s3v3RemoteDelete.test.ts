/**
 * 261124 ③P3-9（审计③发现 9）：移动 deleteMany 吞掉 DeleteObjects 的 Errors ⇒ 删除失败静默、
 * purge 计数/意图按「已删」结算（双端语义分叉；桌面逐键 DELETE 失败抛出）。
 * 「彻底删除 = 零痕迹」（AGENTS §3#15）不能靠静默失败糊过去。
 */
import { describe, expect, it } from "vitest";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

function fakeClient(responses: Array<{ Errors?: Array<{ Key?: string; Message?: string }> }>) {
  const sent: unknown[] = [];
  return {
    sent,
    async send(cmd: unknown) { sent.push(cmd); return responses.shift() ?? {}; },
  };
}

describe("③P3-9：deleteMany 必须检查 DeleteObjects 的 Errors（与桌面同口径）", () => {
  it("Errors 非空 ⇒ 抛错（不再静默）", async () => {
    const client = fakeClient([{ Errors: [{ Key: "prefix/objects/a.lake", Message: "AccessDenied" }] }]);
    const remote = createS3v3RemoteWithClient(client as never, "bucket", "prefix/");
    await expect(remote.deleteMany(["objects/a.lake"])).rejects.toThrow(/AccessDenied/);
  });

  it("对照：无 Errors 正常完成；空列表不发请求", async () => {
    const client = fakeClient([{}]);
    const remote = createS3v3RemoteWithClient(client as never, "bucket", "prefix/");
    await remote.deleteMany(["objects/a.lake"]);
    expect(client.sent).toHaveLength(1);
    await remote.deleteMany([]);
    expect(client.sent).toHaveLength(1);
  });
});

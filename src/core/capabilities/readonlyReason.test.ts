import { describe, expect, it } from "vitest";
import { READONLY_REASON_COPY, readonlyReasonCopy, readonlyReasonOf } from "./readonlyReason";

/**
 * 只读原因单一来源（261112 UI 审计 17 P1）：判据优先级 / 文案 / 动作。
 * 护栏目标：① 四种原因齐全且都可渲染；② 优先级稳定；③ 文案不含中点「·」（AGENTS 红线）。
 */
describe("readonlyReason（只读原因单一来源）", () => {
  it("四种原因都有可渲染文案 + 解除提示 + 动作约定", () => {
    const kinds = ["trashed", "cloud-deleted", "locked", "body-missing"] as const;
    for (const kind of kinds) {
      const copy = readonlyReasonCopy(kind);
      expect(copy.title.length, kind).toBeGreaterThan(0);
      expect(copy.releaseHint.length, kind).toBeGreaterThan(0);
      expect(["open-trash", "unlock", null], kind).toContain(copy.action);
      // 界面文案不用中点作分隔符（AGENTS §3#14 观感红线）
      expect(copy.title).not.toContain("·");
      expect(copy.releaseHint).not.toContain("·");
    }
    expect(READONLY_REASON_COPY["cloud-deleted"].title).toContain("云端已删除（仅本地）");
    expect(READONLY_REASON_COPY.trashed.action).toBe("open-trash");
    expect(READONLY_REASON_COPY.locked.action).toBe("unlock");
    expect(READONLY_REASON_COPY["body-missing"].action).toBeNull();
  });

  it("优先级：正文缺失 > 云端已删除 > 回收站 > 锁定", () => {
    expect(readonlyReasonOf({ bodyMissing: true, cloudDeleted: true, trashed: true, locked: true })?.reason).toBe("body-missing");
    expect(readonlyReasonOf({ cloudDeleted: true, trashed: true, locked: true })?.reason).toBe("cloud-deleted");
    expect(readonlyReasonOf({ trashed: true, locked: true })?.reason).toBe("trashed");
    expect(readonlyReasonOf({ locked: true })?.reason).toBe("locked");
    expect(readonlyReasonOf({})).toBeNull();
  });

  it("返回值已合并文案，调用方不需要再查表", () => {
    const reason = readonlyReasonOf({ trashed: true });
    expect(reason).toMatchObject({ reason: "trashed", action: "open-trash" });
    expect(reason?.title).toBe(READONLY_REASON_COPY.trashed.title);
  });
});

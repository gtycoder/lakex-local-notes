import { describe, expect, it } from "vitest";
import { READONLY_REASON_COPY, readonlyBannerReason, readonlyReasonCopy, readonlyReasonOf } from "./readonlyReason";

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
      expect(["open-trash", null], kind).toContain(copy.action);
      // 界面文案不用中点作分隔符（AGENTS §3#14 观感红线）
      expect(copy.title).not.toContain("·");
      expect(copy.releaseHint).not.toContain("·");
    }
    expect(READONLY_REASON_COPY["cloud-deleted"].title).toContain("云端已删除（仅本地）");
    expect(READONLY_REASON_COPY.trashed.action).toBe("open-trash");
    // 261116 文案清理：横幅不再承载「解锁」动作（入口在状态栏锁图标 /「更多」菜单）。
    expect(READONLY_REASON_COPY.locked.action).toBeNull();
    expect(READONLY_REASON_COPY.locked.releaseHint).toContain("「更多」菜单");
    expect(READONLY_REASON_COPY["body-missing"].action).toBeNull();
  });

  it("优先级：正文缺失 > 云端已删除 > 回收站 > 锁定", () => {
    expect(readonlyReasonOf({ bodyMissing: true, cloudDeleted: true, trashed: true, locked: true })?.reason).toBe("body-missing");
    expect(readonlyReasonOf({ cloudDeleted: true, trashed: true, locked: true })?.reason).toBe("cloud-deleted");
    expect(readonlyReasonOf({ trashed: true, locked: true })?.reason).toBe("trashed");
    expect(readonlyReasonOf({ locked: true })?.reason).toBe("locked");
    expect(readonlyReasonOf({})).toBeNull();
  });

  it("横幅判据：编辑锁不弹横幅（261116 用户裁决），数据事实类照旧弹", () => {
    // 用户主动锁定 = 已知状态，再给一条长横幅是重复提示；只读态由工具区禁用 + 状态条体现。
    expect(readonlyBannerReason(readonlyReasonOf({ locked: true }))).toBeNull();
    // 回收站 / 云端已删除是数据事实，不说用户会以为丢稿 ⇒ 必须继续提示。
    expect(readonlyBannerReason(readonlyReasonOf({ trashed: true }))?.reason).toBe("trashed");
    expect(readonlyBannerReason(readonlyReasonOf({ cloudDeleted: true }))?.reason).toBe("cloud-deleted");
    expect(readonlyBannerReason(null)).toBeNull();
  });

  it("返回值已合并文案，调用方不需要再查表", () => {
    const reason = readonlyReasonOf({ trashed: true });
    expect(reason).toMatchObject({ reason: "trashed", action: "open-trash" });
    expect(reason?.title).toBe(READONLY_REASON_COPY.trashed.title);
  });
});

import { describe, expect, it } from "vitest";
import { missingBodyRecovery } from "./missingBody.js";

describe("缺正文文档的可恢复性", () => {
  it("已配置云 + 有同步基线 ⇒ cloud（优先云端，历史作兜底）", () => {
    expect(missingBodyRecovery({ cloudConfigured: true, hasSyncBase: true, historyCount: 3 })).toBe("cloud");
  });

  it("没有云配置 / 没有同步基线 ⇒ 退到 history（有快照）", () => {
    expect(missingBodyRecovery({ cloudConfigured: true, hasSyncBase: false, historyCount: 1 })).toBe("history");
    expect(missingBodyRecovery({ cloudConfigured: false, hasSyncBase: true, historyCount: 2 })).toBe("history");
  });

  it("两边都没有 ⇒ none（只能删除）", () => {
    expect(missingBodyRecovery({ cloudConfigured: false, hasSyncBase: false, historyCount: 0 })).toBe("none");
  });
});

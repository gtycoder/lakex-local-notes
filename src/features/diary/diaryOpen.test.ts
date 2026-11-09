import { afterEach, describe, expect, it, vi } from "vitest";
import { diaryOpenDatePort, diaryOpenErrorMessage, requestDiaryOpenDate } from "./diaryOpen";

/** `diary_open_date` 的渲染层端口：缺失要明确报 ipc-missing，日期非法要拒绝（不猜日期）。 */
const setBridge = (bridge: unknown) => {
  (globalThis as unknown as { window?: unknown }).window = { lakeNative: bridge };
};
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("diary_open_date 端口（片A 接线前的边界）", () => {
  it("未接线（无 window.lakeNative / 无方法）⇒ null 端口 + ipc-missing", async () => {
    expect(diaryOpenDatePort()).toBeNull();
    setBridge({});
    expect(diaryOpenDatePort()).toBeNull();
    const outcome = await requestDiaryOpenDate("2026-11-09");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("ipc-missing");
      expect(diaryOpenErrorMessage(outcome)).toContain("diary_open_date");
    }
  });

  it("日期键非法直接拒绝，不调用主进程", async () => {
    const call = vi.fn();
    setBridge({ diaryOpenDate: call });
    for (const bad of ["2026-13-01", "2026-02-30", "2026/11/09", "今天"]) {
      const outcome = await requestDiaryOpenDate(bad);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("invalid-date");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("camelCase 与 snake_case 两个键都认（preload 命名漂移不炸），透传规范化后的日期键", async () => {
    const camel = vi.fn(async () => ({ noteId: "n1", created: true, notebookId: "nb", duplicates: [] }));
    setBridge({ diaryOpenDate: camel });
    await expect(requestDiaryOpenDate("2026-11-09")).resolves.toMatchObject({ ok: true, result: { noteId: "n1" } });
    expect(camel).toHaveBeenCalledWith("2026-11-09");

    const snake = vi.fn(async () => ({ noteId: "n2", created: false, notebookId: "nb", duplicates: ["dup"] }));
    setBridge({ diary_open_date: snake });
    await expect(requestDiaryOpenDate("2026-11-09")).resolves.toMatchObject({ ok: true, result: { noteId: "n2", duplicates: ["dup"] } });
  });

  it("返回形状不对 / 抛错 ⇒ failed（不把脏结果当成功）", async () => {
    setBridge({ diaryOpenDate: async () => ({ created: true }) });
    const bad = await requestDiaryOpenDate("2026-11-09");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("failed");

    setBridge({ diaryOpenDate: async () => { throw new Error("事务回滚"); } });
    const thrown = await requestDiaryOpenDate("2026-11-09");
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.message).toContain("事务回滚");
  });
});

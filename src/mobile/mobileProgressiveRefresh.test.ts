import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const APP = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");
describe("首拉渐进展示（261026）", () => {
  it("同步的正文/应用阶段会节流刷新首页列表，结束后自然停止", () => {
    expect(APP).toContain("subscribeSyncProgress");
    expect(APP).toMatch(/p\.phase !== "bodies" && p\.phase !== "apply"/);
    expect(APP).toMatch(/refreshAll\(\)\.catch/);
    // 节流存在，避免每篇文档都重拉整表
    expect(APP).toContain("lastRefreshAt");
  });
});

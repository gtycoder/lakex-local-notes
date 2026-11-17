import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("renderer-ready", () => {
  it("隐藏主窗时 rAF 被暂停也必须通过定时器报到，不能只等 8s 空窗兜底", () => {
    expect(APP).toContain("const fallback = window.setTimeout(notifyReady, 250)");
    expect(APP).toContain("window.clearTimeout(fallback)");
  });
});

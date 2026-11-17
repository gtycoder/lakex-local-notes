import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIFECYCLE = readFileSync(new URL("./useDesktopLifecycle.ts", import.meta.url), "utf8");

describe("退出草稿必须捕获编辑器实时正文", () => {
  it("unmount 与 beforeunload 都优先 captureContent，不能只写 tab.content", () => {
    const matches = LIFECYCLE.match(/const content = captureContent\(tab\.noteId\) \?\? tab\.content;/g) ?? [];
    expect(matches).toHaveLength(2);
    expect((LIFECYCLE.match(/content: tab\.content/g) ?? [])).toHaveLength(0);
  });
});

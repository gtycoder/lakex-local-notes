import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./EditorTab.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("EditorTab 打开文档的 dirty 护栏", () => {
  it("初始化后的异步 contentchange 必须等真实用户操作才通知 onChange", () => {
    expect(SRC).toContain("let userContentIntent = false");
    expect(SRC).toContain("let initialBaseline = latestDocumentRef.current");
    expect(SRC).toContain("if (!userContentIntent && isUnchangedFromOpen()) return");
    expect(SRC).toContain("userContentIntent = true;");
    expect(SRC).toContain('document.addEventListener("pointerdown", armContentChange, true)');
    expect(SRC).toContain('document.addEventListener("keydown", armContentChange, true)');
    expect(SRC).toContain('host.addEventListener("beforeinput", armContentChange, true)');
  });

  it("基线比较失败时按真实变更处理，不能因判别异常静默丢内容", () => {
    expect(SRC).toContain("catch { return false; }");
  });
});

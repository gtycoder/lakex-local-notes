/**
 * `escapeId` 的单一来源 + 兜底行为测试（B1，261016）。
 *
 * 关键判据点：**CSS.escape 不可用时不能抛**——测试环境（node）就没有 `CSS` 全局，
 * 这也是原先三处各写一份 try/catch 的原因；收编后必须保住这条行为。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { escapeId } from "./cssEscape.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "dist-mobile", "dist-electron", ".git", "vendor"]);

/** 收集 src 下所有自有源码（排除本文件与 helper 本身）。 */
function scanFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) scanFiles(full, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") && e.name !== "cssEscape.ts") out.push(full);
  }
  return out;
}

type CssGlobal = { CSS?: unknown };
const realCss = (globalThis as CssGlobal).CSS;

afterEach(() => {
  (globalThis as CssGlobal).CSS = realCss;
});

describe("escapeId（单一来源 + 兜底）", () => {
  it("CSS.escape 可用时直接委托（不重复实现转义规则）", () => {
    const calls: string[] = [];
    (globalThis as CssGlobal).CSS = { escape: (value: string) => { calls.push(value); return "delegated:" + value; } };
    expect(escapeId('a"b')).toBe('delegated:a"b');
    expect(calls).toEqual(['a"b']);
  });

  it("CSS 不可用时退回「只转义双引号与反斜杠」（不抛）", () => {
    (globalThis as CssGlobal).CSS = undefined;
    expect(escapeId('a"b')).toBe('a\\"b');
    expect(escapeId("a\\b")).toBe("a\\\\b");
    expect(escapeId("plain-id-1")).toBe("plain-id-1");
  });

  it("源码级护栏：仓内不得再有裸的 CSS.escape() 调用（判据只留一份）", () => {
    const offenders: string[] = [];
    for (const file of scanFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/CSS\.escape\(/.test(text)) offenders.push(path.relative(SRC, file));
    }
    expect(
      offenders,
      "以下文件直接调了 CSS.escape（无兜底）：请改用 lib/cssEscape.ts 的 escapeId（B1 建的单一来源；\n" +
        "缺兜底时在某些环境会抛，调用点会静默失效）：\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("CSS.escape 抛错时同样走兜底（异常不泄漏给调用点）", () => {
    (globalThis as CssGlobal).CSS = { escape: () => { throw new Error("boom"); } };
    expect(escapeId('x"y')).toBe('x\\"y');
  });
});

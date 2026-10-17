/**
 * execEditorCommand 的回退判据（261017）：文档编辑器没有 .renderer 时，
 * 命令必须回退到实例的 .execCommand，否则移动端文档里所有 dock 命令静默失效。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { execEditorCommand } from "./execCommand";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

function fake(parts: Record<string, unknown>): LakeEditorInstance {
  return parts as unknown as LakeEditorInstance;
}

describe("execEditorCommand", () => {
  it("优先走 renderer.execCommand（小记实例形态）", () => {
    const calls: unknown[][] = [];
    const ed = fake({
      renderer: { execCommand: (...a: unknown[]) => { calls.push(a); return "renderer"; } },
      execCommand: () => "direct",
    });
    expect(execEditorCommand(ed, "bold")).toBe("renderer");
    expect(calls).toEqual([["bold"]]);
  });

  it("没有 renderer 时回退到实例 execCommand（文档编辑器形态）", () => {
    const calls: unknown[][] = [];
    const ed = fake({ execCommand: (...a: unknown[]) => { calls.push(a); return "direct"; } });
    expect(execEditorCommand(ed, "undo")).toBe("direct");
    expect(calls).toEqual([["undo"]]);
  });

  it("renderer 抛错时继续回退", () => {
    const ed = fake({
      renderer: { execCommand: () => { throw new Error("boom"); } },
      execCommand: () => "direct",
    });
    expect(execEditorCommand(ed, "bold")).toBe("direct");
  });

  it("参数原样透传且保留返回值（链接判定依赖返回值）", () => {
    const ed = fake({ execCommand: (...a: unknown[]) => a.slice(1) });
    expect(execEditorCommand(ed, "link", "https://x", true)).toEqual(["https://x", true]);
  });

  it("两者都不可用 / editor 为 null → undefined（不抛）", () => {
    expect(execEditorCommand(null, "bold")).toBeUndefined();
    expect(execEditorCommand(fake({}), "bold")).toBeUndefined();
  });
});

/**
 * 源码级护栏（261017）：移动端不得再直接写 `editor.renderer?.execCommand(...)`。
 * 文档编辑器的实例没有 .renderer ⇒ 直写会静默失效（用户报「撤销没反应」的根因）。
 */
describe("移动端命令入口唯一性（源码级）", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (name === "node_modules") continue;
      if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
      else if (!name.includes(".")) walk(p, out);
    }
    return out;
  };

  it("除 execCommand.ts / 测试外，src/mobile 不得出现 renderer?.execCommand", () => {
    const offenders = walk(ROOT)
      .filter((p) => !p.endsWith("execCommand.ts") && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
      .filter((p) => readFileSync(p, "utf8").includes("renderer?.execCommand"));
    expect(offenders.map((p) => path.relative(ROOT, p))).toEqual([]);
  });
});

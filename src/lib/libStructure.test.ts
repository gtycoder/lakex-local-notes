/**
 * `src/lib` 结构护栏（C3-3，261016）。
 *
 * ## 背景
 * `src/lib` 曾长期留着 **10 个「一行转发壳」**（`export * from "../core/x.js";`）—— 那是逻辑从 lib 搬到 core 之后
 * 留下的**兼容出口**。它们的实际危害不是"多几个文件"，而是**同一个函数有两个合法 import 路径**：
 * 新会话容易在 `lib/` 与 `core/` 各建一份，或改了 core 却以为 lib 那份才是实现。
 *
 * 261016 实测：这 10 个壳**零引用**（三种独立方法互相印证：路径解析脚本 / 全仓 grep / 逐名 grep），
 * 删除后 `tsc` 与全库 vitest 全绿 ⇒ 确属死文件。**同时纠正了 review 初稿的一处错判**：
 * 初稿写"每份都仍有消费者（quickNoteModel 16 处、tree 9 处）"，那是因为统计时把 `lib/` 与 `core/` 的
 * 引用**混在一起数**了。
 *
 * ## 本护栏守什么
 * `src/lib` 下**不得再出现**"整个文件只有一行 `export * from '../core/...'`"的转发壳。
 * 需要复用 core 的东西就**直接从 core 引**；`lib` 只放真正属于渲染层/平台适配的模块。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB = path.dirname(fileURLToPath(import.meta.url));

/** 去掉块注释与整行注释后，只剩一行 `export * from "../core/xxx"` 就算转发壳。 */
function isForwardingShim(file: string): boolean {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n")
    .trim();
  return /^export \* from "\.\.\/core\/[^"]+";?$/.test(code);
}

describe("src/lib 结构护栏（C3-3）", () => {
  it("不得再出现「一行转发 core」的兼容壳（要复用的东西直接从 core 引）", () => {
    const offenders = readdirSync(LIB)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => isForwardingShim(path.join(LIB, f)));
    expect(
      offenders,
      "以下 src/lib 文件只是把 core 原样转发（历史兼容壳）：\n  " + offenders.join("\n  ") +
        "\n请让调用方直接从 core 引，并删除该壳（261016 已清掉 10 个，别再长回来）",
    ).toEqual([]);
  });
});

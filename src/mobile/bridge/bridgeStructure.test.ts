/**
 * C3-5 结构护栏：bridge.ts 只做组合，域实现必须在 6 个域文件里。
 *
 * 为什么卡这个：bridge 是 lakeNative 契约的派生源，方法散回组合层会让契约面/互斥域护栏
 * （它们按对象字面量解析方法）逐份失效；也防止"临时加一个方法"绕过域归属。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const DOMAINS = [
  ["bridge/context.ts", "context"],
  ["bridge/assets.ts", "assetsDomain"],
  ["bridge/sync.ts", "syncDomain"],
  ["bridge/notes.ts", "notesDomain"],
  ["bridge/quickNotes.ts", "quickNotesDomain"],
  ["bridge/tree.ts", "treeDomain"],
] as const;

describe("bridge 组合层结构（C3-5）", () => {
  it("bridge.ts 只做组合：除 init 外不得再定义方法", () => {
    const lines = read("src/mobile/bridge.ts").split("\n");
    const methods = lines
      .map((l) => /^  (?:async )?([a-zA-Z_$][a-zA-Z0-9_$]*)\(/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(methods).toEqual(["init"]);
  });

  it("6 个域文件都存在，且都被 bridge.ts 展开", () => {
    const bridge = read("src/mobile/bridge.ts");
    for (const [file, exportName] of DOMAINS) {
      expect(read("src/mobile/" + file).length, file + " 不能为空").toBeGreaterThan(0);
      if (exportName !== "context") expect(bridge, "bridge.ts 必须展开 " + exportName).toContain("..." + exportName);
    }
  });
});

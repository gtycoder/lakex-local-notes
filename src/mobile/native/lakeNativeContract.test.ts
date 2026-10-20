/**
 * lakeNative 契约护栏（B2 单一来源）：声明的每个方法都必须真实存在。
 *
 * 旧实现是手写的 49 个箭头包装，方法数只靠人眼维持（实现本体 71 个方法、契约只暴露其中 47 个）。
 * 现在名字是单一来源，本测试卡住"声明了却不存在"。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAKE_NATIVE_BRIDGE_METHODS,
  LAKE_NATIVE_EXTRA_METHODS,
  LAKE_NATIVE_METHODS,
  buildLakeNative,
} from "./lakeNativeContract";

const read = (p: string): string => readFileSync(path.join(process.cwd(), p), "utf8");

/** 域模块（C3-5）：bridge 用 `...xxxDomain` 展开，方法名需从域文件里一起解析。 */
const DOMAIN_MODULES: Array<{ file: string; exportName: string }> = [
  { file: "src/mobile/bridge/assets.ts", exportName: "assetsDomain" },
  { file: "src/mobile/bridge/sync.ts", exportName: "syncDomain" },
  { file: "src/mobile/bridge/notes.ts", exportName: "notesDomain" },
  { file: "src/mobile/bridge/quickNotes.ts", exportName: "quickNotesDomain" },
  { file: "src/mobile/bridge/tree.ts", exportName: "treeDomain" },
];

function objectMethodNames(source: string, exportName: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => new RegExp("^export const " + exportName + " = \\{$").test(l));
  const names: string[] = [];
  if (start < 0) return names;
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === start) { depth = 1; continue; }
    const hit = /^  (?:async )?([a-zA-Z_$][a-zA-Z0-9_$]*)\(/.exec(line);
    if (hit && depth === 1) names.push(hit[1]);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  return names;
}

/** 解析 src/mobile/bridge.ts 的一级方法名 + 域模块展开的方法名。 */
function bridgeMethodNames(): string[] {
  const source = read("src/mobile/bridge.ts");
  const names = objectMethodNames(source, "bridge");
  for (const mod of DOMAIN_MODULES) {
    if (source.includes("..." + mod.exportName)) names.push(...objectMethodNames(read(mod.file), mod.exportName));
  }
  return names;
}

describe("lakeNative 调试契约", () => {
  it("bridge 侧每个名字都真的存在于 bridge 对象", () => {
    const actual = new Set(bridgeMethodNames());
    for (const name of LAKE_NATIVE_BRIDGE_METHODS) {
      expect(actual.has(name), `lakeNative 声明了 bridge 上不存在的 ${name}`).toBe(true);
    }
  });

  it("附加入口确实从对应模块导出", () => {
    const sources = read("src/mobile/native/nativeSqlite.ts") + read("src/mobile/native/nativeSqliteMigration.ts");
    for (const name of LAKE_NATIVE_EXTRA_METHODS) {
      expect(sources, `附加入口 ${name} 未在任何模块导出`).toContain(`export async function ${name}`);
    }
  });

  it("清单无重复，且计数固定（改契约必须显式改这里）", () => {
    expect(new Set(LAKE_NATIVE_METHODS).size).toBe(LAKE_NATIVE_METHODS.length);
    expect(LAKE_NATIVE_BRIDGE_METHODS.length).toBe(50); // 261020 +createBitable（CDP 造数/验收多维表编辑） // 261013 +syncQuickNote（保存并同步）/ +getCloudState（置灰判据）
    expect(LAKE_NATIVE_EXTRA_METHODS.length).toBe(2);
    expect(LAKE_NATIVE_METHODS.length).toBe(52);
  });

  it("派生结果 = 声明清单，且缺失即抛（不静默少一个方法）", () => {
    const bridge: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    for (const name of LAKE_NATIVE_BRIDGE_METHODS) bridge[name] = () => name;
    for (const name of LAKE_NATIVE_EXTRA_METHODS) extra[name] = () => name;
    expect(Object.keys(buildLakeNative({ bridge, extra })).sort()).toEqual([...LAKE_NATIVE_METHODS].sort());

    delete bridge[LAKE_NATIVE_BRIDGE_METHODS[0]];
    expect(() => buildLakeNative({ bridge, extra })).toThrow(/不存在的方法/);
  });

  it("派生时绑定正确来源（bridge 方法以 bridge 为 this，附加入口以 extra 为 this）", () => {
    const bridge: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    for (const name of LAKE_NATIVE_BRIDGE_METHODS) {
      bridge[name] = function (this: unknown) { return this === bridge; };
    }
    for (const name of LAKE_NATIVE_EXTRA_METHODS) {
      extra[name] = function (this: unknown) { return this === extra; };
    }
    const built = buildLakeNative({ bridge, extra }) as Record<string, () => boolean>;
    expect(built[LAKE_NATIVE_BRIDGE_METHODS[0]]()).toBe(true);
    expect(built[LAKE_NATIVE_EXTRA_METHODS[0]]()).toBe(true);
  });
});
